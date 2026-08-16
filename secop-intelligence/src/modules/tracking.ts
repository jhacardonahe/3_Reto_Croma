import { croma } from '../croma/client.js';
import { daysUntil } from '../utils/date.js';
import type { ContractTracking, ExecutionItem } from '../types.js';

/**
 * Seguimiento post-adjudicación de un contrato (brief §4.3):
 * ejecución %, retrasos, adiciones, garantías vigentes y un health-score 0..100.
 */
export async function trackContract(contractId: string): Promise<ContractTracking> {
  const res = await croma.contract(contractId);

  if (!res.found || !res.contract) {
    return emptyTracking(contractId);
  }
  const c = res.contract;

  const execPct = latestExecutionPercent(res.execution_items);
  const plannedEnd = c.end_date ?? null;
  const actualEnd = latestActualDelivery(res.execution_items);
  const isDelayed =
    isBehindSchedule(res.execution_items) ||
    (plannedEnd !== null && (daysUntil(plannedEnd) ?? 1) < 0 && (execPct ?? 0) < 100);

  const hasActiveGuarantee = res.guarantees.some(
    (g) => (g.status ?? '').toLowerCase().includes('vigente') || ((g.policy_end_date ?? '') && (daysUntil(g.policy_end_date) ?? -1) >= 0),
  );

  const alerts = {
    has_sanctions: false, // se enriquece vía sanctionsByProvider si se pasa el NIT del proveedor
    modifications_count: res.additions.length,
    has_delays: isDelayed,
    has_active_guarantee: hasActiveGuarantee,
  };

  // price_gap: valor adjudicado (contrato) vs. valor estimado del proceso (base_price).
  // El noticeUID del proceso viene embebido en la URL del contrato. Negativo = adjudicado
  // por debajo del estimado. En procesos multi-lote el estimado es del proceso completo.
  let estimatedProcessValue: number | null = null;
  let priceGap: number | null = null;
  const noticeUid = String(c.url ?? '').match(/noticeUID=(CO1\.NTC\.\d+)/i)?.[1] ?? null;
  if (noticeUid && c.value) {
    try {
      const proc = await croma.process(noticeUid);
      const base = proc.found ? proc.process?.base_price ?? null : null;
      if (base && base > 0) {
        estimatedProcessValue = base;
        priceGap = Math.round(((c.value - base) / base) * 1000) / 1000; // ratio, 3 decimales
      }
    } catch {
      /* no rompe el tracking si falla el proceso */
    }
  }

  return {
    contract_id: contractId,
    found: true,
    entity: c.entity ?? null,
    value: c.value ?? null,
    estimated_process_value: estimatedProcessValue,
    price_gap: priceGap,
    status: {
      contract_status: c.status ?? null,
      execution_percentage: execPct,
      planned_end_date: plannedEnd,
      actual_end_date: actualEnd,
      is_delayed: isDelayed,
    },
    alerts,
    additions: res.additions,
    guarantees: res.guarantees,
    execution_items: res.execution_items,
    health_score: healthScore(execPct, isDelayed, res.additions.length, hasActiveGuarantee),
  };
}

/** Enriquece el tracking con sanciones del proveedor. */
export async function trackContractWithSanctions(contractId: string, providerDocument: string): Promise<ContractTracking> {
  const tracking = await trackContract(contractId);
  if (!tracking.found) return tracking;
  const s = await croma.sanctionsByProvider(providerDocument).catch(() => null);
  if (s && s.count > 0) {
    tracking.alerts.has_sanctions = true;
    tracking.health_score = Math.max(0, tracking.health_score - 15);
  }
  return tracking;
}

function latestExecutionPercent(items: ExecutionItem[]): number | null {
  const vals = items.map((i) => i.actual_progress_percent).filter((v): v is number => typeof v === 'number');
  return vals.length ? Math.max(...vals) : null;
}

function latestActualDelivery(items: ExecutionItem[]): string | null {
  const dates = items.map((i) => i.actual_delivery_date).filter((d): d is string => !!d).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function isBehindSchedule(items: ExecutionItem[]): boolean {
  return items.some(
    (i) =>
      typeof i.expected_progress_percent === 'number' &&
      typeof i.actual_progress_percent === 'number' &&
      i.actual_progress_percent + 5 < i.expected_progress_percent,
  );
}

function healthScore(execPct: number | null, delayed: boolean, additions: number, activeGuarantee: boolean): number {
  let score = 60;
  if (execPct !== null) score = 40 + execPct * 0.4; // 40..80 según avance
  if (delayed) score -= 25;
  score -= Math.min(additions * 5, 20);
  if (activeGuarantee) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function emptyTracking(contractId: string): ContractTracking {
  return {
    contract_id: contractId,
    found: false,
    entity: null,
    value: null,
    estimated_process_value: null,
    price_gap: null,
    status: { contract_status: null, execution_percentage: null, planned_end_date: null, actual_end_date: null, is_delayed: false },
    alerts: { has_sanctions: false, modifications_count: 0, has_delays: false, has_active_guarantee: false },
    additions: [],
    guarantees: [],
    execution_items: [],
    health_score: 0,
  };
}
