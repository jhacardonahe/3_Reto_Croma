import { croma } from '../croma/client.js';
import { entities as configuredEntities, GOODS_CONTRACT_TYPES, MIN_VEHICLE_PRICE } from '../config.js';
import { classifyFotonLine } from './classification.js';
import { estimateUnits, extractSpecs } from '../utils/estimate.js';
import type { ProcessSummary } from '../types.js';

/**
 * Retrospectiva: oportunidades de vehículos Foton que YA CERRARON (histórico).
 * A diferencia del monitoreo en vivo (que apunta a lo abierto), barre el histórico para
 * ver la demanda que ya pasó: qué licitó/adjudicó el sector.
 *
 * Diseño anti-throttling: NO hace llamadas de detalle. Clasifica por el `name` del resumen
 * y filtra por estado cerrado; solo gasta una llamada `processes-by-entity` por página por
 * entidad (barata, cacheada, rate-limited). Esto evita el 502/timeout masivo del sweep profundo.
 */
export interface RetrospectiveOptions {
  entityNits?: string[]; // por defecto: entidades de config
  fromDate?: string; // por defecto 2024-01-01
  toDate?: string;
  minPrice?: number; // piso de valor (default MIN_VEHICLE_PRICE)
  maxPages?: number; // tope de páginas por entidad (500 c/u; default 6)
  line?: string; // filtrar por línea Foton
  department?: string; // (no disponible en el resumen; se ignora salvo match por texto de entidad)
  keyword?: string; // palabra clave en objeto/entidad
}

export interface RetroOpportunity {
  entity: string | null;
  entity_nit: string | null;
  notice_uid: string;
  object: string;
  foton_line: string;
  value: number | null;
  status: string | null;
  published_date: string | null;
  void: boolean; // cerró sin adjudicar (desierto)
  url: string | null;
  estimated_quantity: number | null;
  estimated_unit_price: number | null;
  specs: string[];
}

export interface RetrospectiveResult {
  generated_at: string;
  window: { from: string; to: string };
  filters: { line: string | null; department: string | null; keyword: string | null };
  entities_scanned: number;
  pages_fetched: number;
  processes_seen: number;
  closed_opportunities: number;
  total_value: number;
  void_count: number;
  by_line: Record<string, { count: number; value: number }>;
  by_entity: Record<string, { name: string | null; count: number; value: number }>;
  opportunities: RetroOpportunity[];
}

function fold(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// La puja YA terminó: adjudicado / seleccionado / celebrado / en ejecución / terminado /
// liquidado / cerrado / declarado desierto. (Lo contrario: publicado / en evaluación / borrador.)
const CLOSED = /seleccion|adjudic|celebr|ejecu|termin|liquid|cerrad|desiert/;
const VOID = /desiert/;

// Caché en memoria del BARRIDO completo (independiente de filtros). El sweep pagina varias
// entidades y es lo caro; los filtros de línea/keyword/depto se aplican después sobre el set
// cacheado ⇒ una vez tibio, cualquier combinación de filtros es instantánea. TTL 30 min.
const RESULT_TTL_MS = 30 * 60 * 1000;
const sweepCache = new Map<string, { at: number; rows: RetroOpportunity[]; processesSeen: number; pagesFetched: number }>();

async function collectClosedRows(targets: string[], fromDate: string, toDate: string, minPrice: number, maxPages: number) {
  const cacheKey = JSON.stringify({ targets, fromDate, toDate, minPrice, maxPages });
  const cached = sweepCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return cached;

  const rows: RetroOpportunity[] = [];
  let processesSeen = 0;
  let pagesFetched = 0;

  for (const nit of targets) {
    for (let page = 1; page <= maxPages; page++) {
      const res = await croma.processesByEntity(nit, fromDate, toDate, page).catch(() => null);
      if (!res) break;
      pagesFetched++;
      processesSeen += res.processes.length;
      for (const p of res.processes as ProcessSummary[]) {
        if (!p.notice_uid) continue;
        if ((p.base_price ?? 0) < minPrice) continue;
        const type = (p.contract_type ?? '').toLowerCase();
        if (!GOODS_CONTRACT_TYPES.some((t) => type.includes(t))) continue; // solo bienes
        const cls = classifyFotonLine(`${p.name ?? ''} ${p.contract_type ?? ''}`);
        if (cls.line === 'UNKNOWN') continue; // no mapea a línea Foton
        const st = fold(`${p.procedure_status ?? ''} ${p.phase ?? ''}`);
        if (!CLOSED.test(st)) continue; // solo las que YA cerraron
        rows.push({
          entity: p.entity,
          entity_nit: p.entity_nit ?? nit,
          notice_uid: p.notice_uid,
          object: p.name ?? '',
          foton_line: cls.line,
          value: p.base_price ?? null,
          status: p.procedure_status ?? p.phase ?? null,
          published_date: p.published_date ?? null,
          void: VOID.test(st),
          url: p.url ?? null,
          ...estimateUnits(p.name ?? null, p.base_price ?? null),
          specs: extractSpecs(p.name ?? null),
        });
      }
      if (!res.capped) break; // no hay más páginas
    }
  }

  // dedupe por notice_uid
  const seen = new Set<string>();
  const dedup = rows.filter((r) => (seen.has(r.notice_uid) ? false : (seen.add(r.notice_uid), true)));
  const entry = { at: Date.now(), rows: dedup, processesSeen, pagesFetched };
  sweepCache.set(cacheKey, entry);
  return entry;
}

export async function analyzeRetrospective(opts: RetrospectiveOptions = {}): Promise<RetrospectiveResult> {
  const fromDate = opts.fromDate ?? '2024-01-01';
  const toDate = opts.toDate ?? '';
  const minPrice = opts.minPrice ?? MIN_VEHICLE_PRICE;
  const maxPages = opts.maxPages ?? 6;
  const targets = opts.entityNits?.length ? opts.entityNits : configuredEntities.map((e) => e.nit);

  const swept = await collectClosedRows(targets, fromDate, toDate, minPrice, maxPages);
  const { processesSeen, pagesFetched } = swept;

  // filtros post-recolección (para el dashboard) sobre el set cacheado
  let dedup = swept.rows;
  if (opts.line) dedup = dedup.filter((r) => r.foton_line === opts.line);
  if (opts.keyword) dedup = dedup.filter((r) => fold(`${r.object} ${r.entity ?? ''}`).includes(fold(opts.keyword)));
  if (opts.department) dedup = dedup.filter((r) => fold(r.entity).includes(fold(opts.department)));

  dedup = [...dedup].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const byLine: RetrospectiveResult['by_line'] = {};
  const byEntity: RetrospectiveResult['by_entity'] = {};
  for (const r of dedup) {
    (byLine[r.foton_line] ??= { count: 0, value: 0 });
    byLine[r.foton_line].count++;
    byLine[r.foton_line].value += r.value ?? 0;
    const k = r.entity_nit ?? 'N/D';
    (byEntity[k] ??= { name: r.entity, count: 0, value: 0 });
    byEntity[k].count++;
    byEntity[k].value += r.value ?? 0;
  }

  const result: RetrospectiveResult = {
    generated_at: new Date().toISOString(),
    window: { from: fromDate, to: toDate || 'hoy' },
    filters: { line: opts.line || null, department: opts.department || null, keyword: opts.keyword || null },
    entities_scanned: targets.length,
    pages_fetched: pagesFetched,
    processes_seen: processesSeen,
    closed_opportunities: dedup.length,
    total_value: dedup.reduce((a, r) => a + (r.value ?? 0), 0),
    void_count: dedup.filter((r) => r.void).length,
    by_line: byLine,
    by_entity: byEntity,
    opportunities: dedup,
  };
  return result;
}
