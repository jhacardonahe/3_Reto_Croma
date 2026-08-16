import { croma } from '../croma/client.js';
import { entities as configuredEntities, GOODS_CONTRACT_TYPES, MIN_VEHICLE_PRICE } from '../config.js';
import { classifyFotonLine } from './classification.js';
import { estimateUnits, extractSpecs } from '../utils/estimate.js';
import type { FotonLine, MarketAnalysis, MarketContract, ProcessSummary } from '../types.js';

export interface MarketOptions {
  entityNits?: string[]; // por defecto: entidades compradoras de config
  fromDate?: string;
  toDate?: string;
  line?: string; // sector/categoría (línea Foton)
  department?: string; // departamento de la entidad
  keyword?: string; // palabra clave en el objeto
  maxDetailLookups?: number; // tope de detalles por corrida (control de costo/rate-limit)
}

function fold(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Caché en memoria del resultado ensamblado (el sweep es caro por el rate-limit de
// Croma). La primera corrida puebla; las siguientes (incluido el demo) se sirven al
// instante. TTL 30 min. Clave por los parámetros que cambian el barrido/filtro.
const RESULT_TTL_MS = 30 * 60 * 1000;
const resultCache = new Map<string, { at: number; data: MarketAnalysis }>();

// Estados que indican que el proceso YA fue adjudicado → su detalle trae contratos
// (proveedor + valor). Los procesos "en evaluación/publicado" aún no tienen contratos.
const AWARDED_STATUS = ['seleccion', 'adjudic', 'celebr', 'ejecu', 'termin', 'liquid'];

/** ¿este resumen de proceso PODRÍA ser una compra de vehículo? (barato, sin gastar detalle). */
function isVehicleGoods(p: ProcessSummary): boolean {
  if (!p.notice_uid) return false;
  const type = (p.contract_type ?? '').toLowerCase();
  const isGoods = GOODS_CONTRACT_TYPES.some((t) => type.includes(t));
  return isGoods && (p.base_price ?? 0) >= MIN_VEHICLE_PRICE;
}

/** Además de ser vehículo, el proceso debe estar adjudicado para traer contratos con proveedor. */
function isAwardedVehicle(p: ProcessSummary): boolean {
  if (!isVehicleGoods(p)) return false;
  const st = fold(`${p.procedure_status ?? ''} ${p.phase ?? ''}`);
  return AWARDED_STATUS.some((s) => st.includes(s));
}

/**
 * Inteligencia de MERCADO por sector: reformula la revisión de competencia.
 * En vez de partir del NIT de UNA empresa, barre las ENTIDADES compradoras,
 * recoge TODOS los contratos de vehículos adjudicados (todos los proveedores) y
 * agrega el mercado por sector (línea Foton), por entidad y por proveedor.
 * Filtros: sector/categoría, departamento, período y palabra clave.
 */
export async function analyzeMarket(opts: MarketOptions = {}): Promise<MarketAnalysis> {
  const fromDate = opts.fromDate ?? '';
  const toDate = opts.toDate ?? '';
  const maxDetail = opts.maxDetailLookups ?? 18;
  const targetNits = opts.entityNits?.length ? opts.entityNits : configuredEntities.map((e) => e.nit);

  const cacheKey = JSON.stringify({ targetNits, fromDate, toDate, line: opts.line ?? '', department: opts.department ?? '', keyword: opts.keyword ?? '', maxDetail });
  const cached = resultCache.get(cacheKey);
  if (cached && Date.now() - cached.at < RESULT_TTL_MS) return cached.data;

  let processesSeen = 0;
  let detailLookups = 0;
  const rows: MarketContract[] = [];
  const seenContract = new Set<string>();

  // Reparte el presupuesto de detalles entre entidades (breadth), para que todas
  // contribuyan y no se agote en la primera (que puede tener muchas motos/embarcaciones).
  const perEntity = Math.max(6, Math.ceil(maxDetail / targetNits.length));

  outer: for (const nit of targetNits) {
    const res = await croma.processesByEntity(nit, fromDate, toDate).catch(() => null);
    if (!res) continue;
    const candidates = res.processes.filter(isAwardedVehicle);
    processesSeen += res.processes.length;

    let entityLookups = 0;
    for (const cand of candidates) {
      if (detailLookups >= maxDetail) break outer;
      if (entityLookups >= perEntity) break;
      detailLookups++;
      entityLookups++;
      const detail = await croma.process(cand.notice_uid).catch(() => null);
      if (!detail || !detail.found) continue;
      const department = (detail.process?.entity_department as string | undefined) ?? null;
      const city = (detail.process?.entity_city as string | undefined) ?? null;

      for (const c of detail.contracts ?? []) {
        const id = c.contract_id ?? '';
        if (id && seenContract.has(id)) continue;
        if (id) seenContract.add(id);
        const line = classifyFotonLine(`${c.object ?? ''} ${c.contract_type ?? ''}`).line;
        if (line === 'UNKNOWN') continue;
        rows.push({
          contract_id: c.contract_id ?? null,
          notice_uid: cand.notice_uid,
          entity: c.entity ?? detail.process?.entity ?? cand.entity ?? null,
          entity_nit: c.entity_nit ?? nit,
          department,
          city,
          provider: c.provider ?? null,
          provider_nit: c.provider_document ?? null,
          object: c.object ?? null,
          value: c.value ?? null,
          line,
          sign_date: c.sign_date ?? null,
          status: c.status ?? null,
          ...estimateUnits(c.object ?? null, c.value ?? null),
          specs: extractSpecs(c.object ?? null),
        });
      }
    }
  }

  // Filtros post-recolección.
  const filtered = rows.filter((r) => {
    if (opts.line && r.line !== opts.line) return false;
    if (opts.department && !fold(r.department).includes(fold(opts.department))) return false;
    if (opts.keyword && !fold(`${r.object ?? ''} ${r.entity ?? ''} ${r.provider ?? ''}`).includes(fold(opts.keyword))) return false;
    return true;
  });

  // Agregados.
  const byCategory: MarketAnalysis['by_category'] = {};
  for (const r of filtered) {
    const b = (byCategory[r.line] ??= { contracts: 0, total_value: 0, estimated_units: 0, average_unit_price: null });
    b.contracts++;
    b.total_value += r.value ?? 0;
    b.estimated_units += r.estimated_quantity ?? 0;
  }
  for (const b of Object.values(byCategory)) {
    b.average_unit_price = b.estimated_units > 0 ? Math.round(b.total_value / b.estimated_units) : null;
  }

  const byEntity = aggregate(filtered, (r) => r.entity_nit ?? r.entity ?? 'N/D', (r) => ({ entity: r.entity, entity_nit: r.entity_nit, department: r.department }));
  const byProvider = aggregate(filtered, (r) => r.provider_nit ?? r.provider ?? 'N/D', (r) => ({ provider: r.provider, provider_nit: r.provider_nit }));

  const totalValue = filtered.reduce((a, r) => a + (r.value ?? 0), 0);
  const estimatedUnits = filtered.reduce((a, r) => a + (r.estimated_quantity ?? 0), 0);

  const result: MarketAnalysis = {
    filters: {
      line: opts.line || null,
      department: opts.department || null,
      keyword: opts.keyword || null,
      from_date: fromDate || null,
      to_date: toDate || null,
    },
    totals: {
      entities_scanned: targetNits.length,
      processes_seen: processesSeen,
      detail_lookups: detailLookups,
      contracts: filtered.length,
      total_value: totalValue,
      estimated_units: estimatedUnits,
      providers: byProvider.length,
    },
    by_category: byCategory,
    by_entity: byEntity.slice(0, 8),
    by_provider: byProvider.slice(0, 8),
    contracts: filtered.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 60),
  };
  resultCache.set(cacheKey, { at: Date.now(), data: result });
  return result;
}

function aggregate<T extends Record<string, unknown>>(
  rows: MarketContract[],
  keyOf: (r: MarketContract) => string,
  metaOf: (r: MarketContract) => T,
): (T & { contracts: number; value: number; categories: FotonLine[] })[] {
  const map = new Map<string, T & { contracts: number; value: number; categories: Set<FotonLine> }>();
  for (const r of rows) {
    const k = keyOf(r);
    const e = map.get(k) ?? { ...metaOf(r), contracts: 0, value: 0, categories: new Set<FotonLine>() };
    e.contracts++;
    e.value += r.value ?? 0;
    e.categories.add(r.line);
    map.set(k, e);
  }
  return [...map.values()]
    .map((e) => ({ ...e, categories: [...e.categories] }))
    .sort((a, b) => b.value - a.value);
}
