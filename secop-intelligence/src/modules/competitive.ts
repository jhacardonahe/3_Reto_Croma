import { croma } from '../croma/client.js';
import { competitors } from '../config.js';
import { classifyFotonLine } from './classification.js';
import type { CompetitorAnalysis, Contract } from '../types.js';

export interface CompetitorOptions {
  fromDate?: string;
  toDate?: string;
  maxPages?: number; // páginas de 500 a recorrer (default 2)
}

/**
 * Perfil competitivo de un contratista (brief §4.2): consolida sus contratos
 * ganados, los agrupa por línea Foton (por el `object`) y suma sanciones.
 */
export async function analyzeCompetitor(nit: string, opts: CompetitorOptions = {}): Promise<CompetitorAnalysis> {
  const fromDate = opts.fromDate ?? '';
  const toDate = opts.toDate ?? '';
  const maxPages = opts.maxPages ?? 2;

  const all: Contract[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await croma.contractsByProvider(nit, fromDate, toDate, '', page);
    all.push(...res.contracts);
    if (!res.capped) break; // no hay más páginas
  }

  const totalValue = sum(all.map((c) => c.value ?? 0));
  const totalContracts = all.length;

  const byLine: CompetitorAnalysis['by_line'] = {};
  for (const c of all) {
    const line = classifyFotonLine(`${c.object ?? ''} ${c.contract_type ?? ''}`).line;
    const bucket = (byLine[line] ??= { contracts_won: 0, total_value: 0, average_price: 0 });
    bucket.contracts_won++;
    bucket.total_value += c.value ?? 0;
  }
  for (const b of Object.values(byLine)) {
    b.average_price = b.contracts_won ? Math.round(b.total_value / b.contracts_won) : 0;
  }

  // Top entidades que más lo contratan
  const byEntity = new Map<string, { entity: string | null; entity_nit: string | null; contracts: number; value: number }>();
  for (const c of all) {
    const key = c.entity_nit ?? c.entity ?? 'N/D';
    const e = byEntity.get(key) ?? { entity: c.entity ?? null, entity_nit: c.entity_nit ?? null, contracts: 0, value: 0 };
    e.contracts++;
    e.value += c.value ?? 0;
    byEntity.set(key, e);
  }
  const topEntities = [...byEntity.values()].sort((a, b) => b.value - a.value).slice(0, 5);

  const sanctions = await croma.sanctionsByProvider(nit).catch(() => ({ count: 0, sanctions: [] as never[] }));

  return {
    competitor_nit: nit,
    competitor_name: competitors.find((c) => c.nit === nit)?.name ?? null,
    period: { from_date: fromDate || null, to_date: toDate || null },
    statistics: {
      total_contracts: totalContracts,
      total_value: totalValue,
      average_contract_value: totalContracts ? Math.round(totalValue / totalContracts) : 0,
      price_gap: null, // requiere cruzar con el valor estimado del proceso (roadmap)
    },
    by_line: byLine,
    top_entities: topEntities,
    sanctions_count: sanctions.count ?? 0,
    trend: inferTrend(all),
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
