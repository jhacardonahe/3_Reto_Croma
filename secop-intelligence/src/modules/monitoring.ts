import { croma } from '../croma/client.js';
import { entities as configuredEntities, type EntityConfig, GOODS_CONTRACT_TYPES, MIN_VEHICLE_PRICE } from '../config.js';
import { classifyFotonLine } from './classification.js';
import { evaluateAlerts } from './alerting.js';
import { calculateOpportunityScore } from '../utils/scoring.js';
import { estimateUnits, extractSpecs } from '../utils/estimate.js';
import { daysUntil, daysAgo } from '../utils/date.js';
import type { OpportunityResult, ProcessSummary } from '../types.js';

export interface MonitorOptions {
  entityNits?: string[]; // por defecto: las de config
  fromDate?: string; // por defecto: hoy - 7 días
  toDate?: string;
  limit?: number; // top N a devolver (default 50)
  minScore?: number; // umbral (default 40)
  maxDetailLookups?: number; // tope de llamadas de detalle por corrida (control de costo)
  // --- filtros de búsqueda (opcionales) ---
  segments?: string[]; // filtrar por línea Foton (p.ej. ['PICKUP_MHEV','NEW_ENERGY'])
  department?: string; // filtrar por departamento de la entidad (acento-insensible, substring)
  keyword?: string; // filtrar por palabra clave en objeto/entidad (acento-insensible)
}

/** Normaliza para comparar: minúsculas + sin tildes. */
function fold(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export interface MonitorRun {
  timestamp: string;
  from_date: string;
  entities_scanned: number;
  total_processed: number;
  total_prefiltered: number;
  detail_lookups: number;
  failed_lookups: number;
  opportunities: OpportunityResult[];
}

/**
 * Corrida de monitoreo end-to-end (brief §10).
 * 1) lista procesos por entidad, 2) pre-filtro barato por texto del resumen,
 * 3) detalle de los candidatos (para descripción + fecha de cierre),
 * 4) clasifica a línea Foton, 5) puntúa, 6) alertas, 7) top-N ordenado.
 */
export async function runMonitoring(opts: MonitorOptions = {}): Promise<MonitorRun> {
  const fromDate = opts.fromDate ?? daysAgo(7);
  const toDate = opts.toDate ?? '';
  const limit = opts.limit ?? 50;
  const minScore = opts.minScore ?? 40;
  const maxDetail = opts.maxDetailLookups ?? 60;

  const targets: EntityConfig[] = opts.entityNits?.length
    ? opts.entityNits.map((nit) => configuredEntities.find((e) => e.nit === nit) ?? { nit, name: nit, type: 'unknown', priority: 'medium' as const })
    : configuredEntities;

  let totalProcessed = 0;
  let detailLookups = 0;
  let failedLookups = 0;
  const candidates: { summary: ProcessSummary; entity: EntityConfig; frequency: number }[] = [];

  for (const entity of targets) {
    const res = await croma.processesByEntity(entity.nit, fromDate, toDate);
    totalProcessed += res.processes.length;

    // frecuencia = # de procesos relevantes de la entidad en la ventana (proxy de "comprador recurrente")
    const relevant = res.processes.filter(isCandidateVehicleProcess);
    for (const p of relevant) candidates.push({ summary: p, entity, frequency: relevant.length });
  }

  const opportunities: OpportunityResult[] = [];
  for (const cand of candidates) {
    if (detailLookups >= maxDetail) break;

    // Detalle para obtener descripción + fecha de cierre (el resumen no las trae).
    // Un fallo puntual de Croma (502/timeout) no debe abortar toda la corrida: se salta.
    detailLookups++;
    let header: Awaited<ReturnType<typeof croma.process>>['process'] = null;
    try {
      const detail = await croma.process(cand.summary.notice_uid);
      header = detail.found ? detail.process : null;
    } catch (err) {
      failedLookups++;
      continue;
    }

    const object =
      header?.description ??
      cand.summary.name ??
      `${cand.summary.contract_type ?? ''} ${cand.summary.reference ?? ''}`.trim();

    const classification = classifyFotonLine(`${object} ${cand.summary.contract_type ?? ''}`);
    if (classification.line === 'UNKNOWN') continue;

    // --- filtros de búsqueda (post-detalle, sobre datos ya resueltos) ---
    if (opts.segments?.length && !opts.segments.includes(classification.line)) continue;
    const department = header?.entity_department ?? null;
    const city = header?.entity_city ?? null;
    if (opts.department && !fold(department).includes(fold(opts.department))) continue;
    if (opts.keyword) {
      const hay = fold(`${object} ${cand.summary.entity ?? ''} ${department ?? ''} ${city ?? ''}`);
      if (!hay.includes(fold(opts.keyword))) continue;
    }

    const estimatedValue = header?.base_price ?? cand.summary.base_price ?? null;
    const closingDate = header?.bid_deadline ?? null;
    const daysToClose = daysUntil(closingDate);

    const scoring = calculateOpportunityScore({
      estimatedValue,
      daysToClose,
      entityPurchaseFrequency: cand.frequency,
      classification,
    });
    if (scoring.total < minScore) continue;

    const opp: OpportunityResult = {
      notice_uid: cand.summary.notice_uid,
      entity_name: cand.summary.entity ?? cand.entity.name,
      entity_nit: cand.summary.entity_nit ?? cand.entity.nit,
      department,
      city,
      object,
      estimated_value: estimatedValue,
      publication_date: cand.summary.published_date ?? header?.published_date ?? null,
      closing_date: closingDate,
      days_to_close: daysToClose,
      foton_line: classification.line,
      line_confidence: classification.confidence,
      ...estimateUnits(object, estimatedValue),
      specs: extractSpecs(object),
      scoring,
      alerts: [],
      secop_link: cand.summary.url ?? header?.url ?? null,
    };
    opp.alerts = evaluateAlerts(opp);
    opportunities.push(opp);
  }

  opportunities.sort(
    (a, b) =>
      b.scoring.total - a.scoring.total ||
      (b.estimated_value ?? 0) - (a.estimated_value ?? 0) ||
      (a.days_to_close ?? Infinity) - (b.days_to_close ?? Infinity),
  );

  return {
    timestamp: new Date().toISOString(),
    from_date: fromDate,
    entities_scanned: targets.length,
    total_processed: totalProcessed,
    total_prefiltered: candidates.length,
    detail_lookups: detailLookups,
    failed_lookups: failedLookups,
    opportunities: opportunities.slice(0, limit),
  };
}

/**
 * Pre-filtro barato a nivel de resumen: ¿este proceso PODRÍA ser una compra de vehículo?
 * El resumen no trae descripción, así que filtramos por tipo de contrato (bienes) y precio.
 * Los descartados aquí no gastan una llamada de detalle a Croma.
 */
function isCandidateVehicleProcess(p: ProcessSummary): boolean {
  if (!p.notice_uid) return false; // algunos procesos de SECOP vienen sin noticeUID → no se pueden detallar
  const type = (p.contract_type ?? '').toLowerCase();
  const isGoods = GOODS_CONTRACT_TYPES.some((t) => type.includes(t));
  const priceOk = (p.base_price ?? 0) >= MIN_VEHICLE_PRICE;
  return isGoods && priceOk;
}
