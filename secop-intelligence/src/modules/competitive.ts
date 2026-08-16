import { croma } from '../croma/client.js';
import { competitors } from '../config.js';
import { classifyFotonLine } from './classification.js';
import type { CompetitorAnalysis, CompetitorContract, Contract } from '../types.js';

export interface CompetitorOptions {
  fromDate?: string;
  toDate?: string;
  maxPages?: number; // páginas de 500 a recorrer (default 2)
  // --- filtros de la revisión de competencia ---
  line?: string; // categoría = línea Foton (PICKUP, LDT, ...)
  entityNit?: string; // entidad contratante
  minValue?: number; // valor mínimo del contrato (COP)
  keyword?: string; // palabra clave en el objeto (acento-insensible)
}

/** minúsculas + sin tildes, para comparar. */
function fold(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Nouns de vehículos para estimar cantidad desde el texto del objeto.
const VEH_NOUN = 'camionetas?|veh[ií]culos?|camiones?|cami[oó]n|vans?|furgones?|furg[oó]n|microbuses?|microb[uú]s|motocicletas?|pick[- ]?ups?|suv|autom[oó]viles?|autom[oó]vil|busetas?|buses?|volquetas?|ambulancias?';

/**
 * Estima cantidad de vehículos y precio unitario a partir del TEXTO del objeto
 * (ej. "LOTE 1: 5 CAMIONETAS..."). Es aproximado y NO oficial: SECOP no expone
 * cantidad ni precio unitario como dato estructurado (viven en los pliegos PDF).
 */
function estimateUnits(object: string | null, value: number | null): { estimated_quantity: number | null; estimated_unit_price: number | null } {
  // Capta "5 camionetas", "(5) vehículos", "Cinco (5) camionetas", "5) camiones".
  // Toma la cantidad TITULAR (máximo match) en vez de sumar, para no duplicar cuando
  // una misma compra se describe con dos sustantivos ("5 vehículos tipo camioneta").
  const re = new RegExp(`\\(?(\\d{1,4})\\)?\\s+(?:${VEH_NOUN})`, 'gi');
  let qty = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(object ?? '')) !== null) qty = Math.max(qty, Number(m[1]));
  if (qty > 0 && value) return { estimated_quantity: qty, estimated_unit_price: Math.round(value / qty) };
  return { estimated_quantity: qty > 0 ? qty : null, estimated_unit_price: null };
}

/**
 * Perfil competitivo de un contratista (brief §4.2): consolida sus contratos
 * ganados, los agrupa por línea Foton (por el `object`) y suma sanciones.
 * Soporta filtros: categoría (línea), período, entidad contratante, valor y palabra clave.
 */
export async function analyzeCompetitor(nit: string, opts: CompetitorOptions = {}): Promise<CompetitorAnalysis> {
  const fromDate = opts.fromDate ?? '';
  const toDate = opts.toDate ?? '';
  const maxPages = opts.maxPages ?? 2;
  const entityNit = opts.entityNit ?? '';

  const fetched: Contract[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await croma.contractsByProvider(nit, fromDate, toDate, entityNit, page);
    fetched.push(...res.contracts);
    if (!res.capped) break; // no hay más páginas
  }

  // Clasifica una vez y aplica los filtros de la revisión.
  const enriched = fetched.map((c) => ({ c, line: classifyFotonLine(`${c.object ?? ''} ${c.contract_type ?? ''}`).line }));
  const all = enriched.filter(({ c, line }) => {
    if (opts.line && line !== opts.line) return false;
    if (opts.minValue && (c.value ?? 0) < opts.minValue) return false;
    if (opts.keyword && !fold(`${c.object ?? ''} ${c.entity ?? ''}`).includes(fold(opts.keyword))) return false;
    return true;
  });

  const totalValue = sum(all.map(({ c }) => c.value ?? 0));
  const totalContracts = all.length;

  const byLine: CompetitorAnalysis['by_line'] = {};
  for (const { c, line } of all) {
    const bucket = (byLine[line] ??= { contracts_won: 0, total_value: 0, average_price: 0 });
    bucket.contracts_won++;
    bucket.total_value += c.value ?? 0;
  }
  for (const b of Object.values(byLine)) {
    b.average_price = b.contracts_won ? Math.round(b.total_value / b.contracts_won) : 0;
  }

  // Top entidades que más lo contratan
  const byEntity = new Map<string, { entity: string | null; entity_nit: string | null; contracts: number; value: number }>();
  for (const { c } of all) {
    const key = c.entity_nit ?? c.entity ?? 'N/D';
    const e = byEntity.get(key) ?? { entity: c.entity ?? null, entity_nit: c.entity_nit ?? null, contracts: 0, value: 0 };
    e.contracts++;
    e.value += c.value ?? 0;
    byEntity.set(key, e);
  }
  const topEntities = [...byEntity.values()].sort((a, b) => b.value - a.value).slice(0, 5);

  // Detalle de contratos (con cantidad/unitario ESTIMADOS del texto del objeto).
  const contracts: CompetitorContract[] = all
    .map(({ c, line }) => ({
      contract_id: c.contract_id ?? null,
      object: c.object ?? null,
      entity: c.entity ?? null,
      entity_nit: c.entity_nit ?? null,
      value: c.value ?? null,
      line,
      sign_date: c.sign_date ?? null,
      status: c.status ?? null,
      ...estimateUnits(c.object ?? null, c.value ?? null),
    }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 50);

  const sanctions = await croma.sanctionsByProvider(nit).catch(() => ({ count: 0, sanctions: [] as never[] }));

  return {
    competitor_nit: nit,
    competitor_name: competitors.find((c) => c.nit === nit)?.name ?? null,
    period: { from_date: fromDate || null, to_date: toDate || null },
    filters: {
      line: opts.line || null,
      entity_nit: entityNit || null,
      min_value: opts.minValue ?? null,
      keyword: opts.keyword || null,
    },
    statistics: {
      total_contracts: totalContracts,
      total_value: totalValue,
      average_contract_value: totalContracts ? Math.round(totalValue / totalContracts) : 0,
      price_gap: null, // requiere cruzar con el valor estimado del proceso (roadmap)
    },
    by_line: byLine,
    top_entities: topEntities,
    contracts,
    sanctions_count: sanctions.count ?? 0,
    trend: inferTrend(all.map(({ c }) => c)),
  };
}

function inferTrend(contracts: Contract[]): CompetitorAnalysis['trend'] {
  const byYear = new Map<number, number>();
  for (const c of contracts) {
    const y = c.sign_date ? Number(c.sign_date.slice(0, 4)) : NaN;
    if (!Number.isNaN(y)) byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  const years = [...byYear.keys()].sort();
  if (years.length < 2) return 'stable';
  const first = byYear.get(years[0]) ?? 0;
  const last = byYear.get(years[years.length - 1]) ?? 0;
  if (last > first * 1.2) return 'increasing';
  if (last < first * 0.8) return 'decreasing';
  return 'stable';
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}
