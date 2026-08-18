import { croma } from '../croma/client.js';
import { entities as configuredEntities, type EntityConfig, GOODS_CONTRACT_TYPES, MIN_VEHICLE_PRICE } from '../config.js';
import { classifyFotonLine } from './classification.js';
import { evaluateAlerts } from './alerting.js';
import { calculateOpportunityScore } from '../utils/scoring.js';
import { estimateUnits, extractSpecs } from '../utils/estimate.js';
import { verifyOpportunity } from '../utils/verify.js';
import { daysUntil, daysAgo } from '../utils/date.js';
import type { OpportunityResult, ProcessSummary } from '../types.js';

export interface MonitorOptions {
  entityNits?: string[]; // por defecto: las de config
  fromDate?: string; // por defecto: hoy - 7 días
  toDate?: string;
  limit?: number; // top N a devolver (default 50)
  minScore?: number; // umbral (default 40)
  maxDetailLookups?: number; // tope de llamadas de detalle por corrida (control de costo)
  detailConcurrency?: number; // llamadas de detalle en vuelo a la vez (default 5)
  // --- filtros de búsqueda (opcionales) ---
  segments?: string[]; // filtrar por línea Foton (p.ej. ['PICKUP_MHEV','NEW_ENERGY'])
  department?: string; // filtrar por departamento de la entidad (acento-insensible, substring)
  keyword?: string; // filtrar por palabra clave en objeto/entidad (acento-insensible)
  // Telemetría de trazabilidad: se llama en cada hito para alimentar el panel en vivo.
  // Es puramente observacional — no altera el resultado de la corrida.
  onEvent?: (ev: MonitorEvent) => void;
}

/**
 * Eventos de trazabilidad emitidos durante la corrida (para el panel lateral en vivo).
 * Cada uno cuenta QUÉ hizo el pipeline y CON QUÉ evidencia de Croma — nada inventado.
 */
export type MonitorEvent =
  | { type: 'stage'; key: string; status: 'running' | 'done'; note?: string }
  | { type: 'entity'; nit: string; name: string; processes: number; relevant: number }
  | { type: 'counts'; total_processed: number; total_prefiltered: number }
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'opportunity';
      notice_uid: string;
      foton_line: string;
      entity_name: string | null;
      score: number;
      verification: { ok: boolean; confirmed: number; checked: number; detail: string; source_ref: string | null };
    }
  | { type: 'summary'; detail_lookups: number; failed_lookups: number; verified: number; partial: number; emitted: number };

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
  const emit = opts.onEvent ?? (() => {});

  const targets: EntityConfig[] = opts.entityNits?.length
    ? opts.entityNits.map((nit) => configuredEntities.find((e) => e.nit === nit) ?? { nit, name: nit, type: 'unknown', priority: 'medium' as const })
    : configuredEntities;

  let totalProcessed = 0;
  let detailLookups = 0;
  let failedLookups = 0;
  const candidates: { summary: ProcessSummary; entity: EntityConfig; frequency: number }[] = [];

  emit({ type: 'stage', key: 'list', status: 'running', note: `${targets.length} entidad(es)` });
  for (const entity of targets) {
    const res = await croma.processesByEntity(entity.nit, fromDate, toDate);
    totalProcessed += res.processes.length;

    // frecuencia = # de procesos relevantes de la entidad en la ventana (proxy de "comprador recurrente")
    const relevant = res.processes.filter(isCandidateVehicleProcess);
    for (const p of relevant) candidates.push({ summary: p, entity, frequency: relevant.length });
    emit({ type: 'entity', nit: entity.nit, name: entity.name, processes: res.processes.length, relevant: relevant.length });
  }
  emit({ type: 'stage', key: 'list', status: 'done' });
  emit({ type: 'counts', total_processed: totalProcessed, total_prefiltered: candidates.length });
  emit({ type: 'stage', key: 'prefilter', status: 'done', note: `${candidates.length} candidato(s)` });
  emit({ type: 'stage', key: 'detail', status: 'running', note: `${candidates.length} por detallar` });

  let verified = 0;
  let partial = 0;
  const opportunities: OpportunityResult[] = [];

  // Resuelve UN candidato: detalle Croma → clasifica → filtra → puntúa → guard de citas.
  // Muta el estado compartido (opportunities/verified/partial/failedLookups) tras el await;
  // es seguro porque JS es monohilo: las mutaciones ocurren de forma síncrona al reanudar.
  async function processCandidate(cand: { summary: ProcessSummary; entity: EntityConfig; frequency: number }): Promise<void> {
    // Detalle para obtener descripción + fecha de cierre (el resumen no las trae).
    // Un fallo puntual de Croma (502/timeout) no debe abortar toda la corrida: se salta.
    let header: Awaited<ReturnType<typeof croma.process>>['process'] = null;
    try {
      const detail = await croma.process(cand.summary.notice_uid);
      header = detail.found ? detail.process : null;
    } catch (err) {
      failedLookups++;
      return;
    }

    const object =
      header?.description ??
      cand.summary.name ??
      `${cand.summary.contract_type ?? ''} ${cand.summary.reference ?? ''}`.trim();

    const classification = classifyFotonLine(`${object} ${cand.summary.contract_type ?? ''}`);
    if (classification.line === 'UNKNOWN') return;

    // --- filtros de búsqueda (post-detalle, sobre datos ya resueltos) ---
    if (opts.segments?.length && !opts.segments.includes(classification.line)) return;
    const department = header?.entity_department ?? null;
    const city = header?.entity_city ?? null;
    if (opts.department && !fold(department).includes(fold(opts.department))) return;
    if (opts.keyword) {
      const hay = fold(`${object} ${cand.summary.entity ?? ''} ${department ?? ''} ${city ?? ''}`);
      if (!hay.includes(fold(opts.keyword))) return;
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
    if (scoring.total < minScore) return;

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
      // Crudos de Croma: alimentan la huella de la memoria de barrido (modules/seen.ts).
      phase: cand.summary.phase ?? null,
      procedure_status: cand.summary.procedure_status ?? null,
      // Guard de citas: se calcula aquí, donde vive la evidencia cruda de Croma
      // (summary + header). Traza cada dato afirmado a su origen antes de emitir.
      verification: verifyOpportunity(
        {
          notice_uid: cand.summary.notice_uid,
          entity_nit: cand.summary.entity_nit ?? cand.entity.nit,
          estimated_value: estimatedValue,
          closing_date: closingDate,
          publication_date: cand.summary.published_date ?? header?.published_date ?? null,
          secop_link: cand.summary.url ?? header?.url ?? null,
        },
        {
          notice_uid: cand.summary.notice_uid,
          base_price: header?.base_price ?? cand.summary.base_price ?? null,
          // el NIT consultado es la clave con que Croma devolvió este proceso → es fuente válida
          entity_nit: cand.summary.entity_nit ?? header?.entity_nit ?? cand.entity.nit,
          bid_deadline: header?.bid_deadline ?? null,
          published_date: cand.summary.published_date ?? header?.published_date ?? null,
          url: cand.summary.url ?? header?.url ?? null,
        },
      ),
    };
    opp.alerts = evaluateAlerts(opp);
    opportunities.push(opp);
    if (opp.verification.ok) verified++;
    else partial++;
    emit({
      type: 'opportunity',
      notice_uid: opp.notice_uid,
      foton_line: opp.foton_line,
      entity_name: opp.entity_name,
      score: opp.scoring.total,
      verification: {
        ok: opp.verification.ok,
        confirmed: opp.verification.confirmed,
        checked: opp.verification.checked,
        detail: opp.verification.detail,
        source_ref: opp.verification.source_ref,
      },
    });
  }

  // Fase de detalle PARALELIZADA con concurrencia acotada. El RateLimiter del cliente
  // garantiza el techo por minuto aunque haya varias llamadas en vuelo, así que la
  // corrección se mantiene y la corrida en frío es ~concurrencia veces más rápida.
  // El tope `maxDetail` se RESERVA de forma atómica (síncrona, antes del await) para no
  // pasarse; el orden de los eventos deja de ser determinista (el panel los pinta como
  // llegan), lo cual es aceptable.
  const concurrency = Math.max(1, opts.detailConcurrency ?? 5);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      // reserva atómica: sin await entre el check del tope y el ++ (monohilo ⇒ indivisible)
      if (detailLookups >= maxDetail || cursor >= candidates.length) return;
      const cand = candidates[cursor++];
      detailLookups++;
      emit({ type: 'progress', done: detailLookups, total: candidates.length });
      await processCandidate(cand);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  emit({ type: 'stage', key: 'detail', status: 'done' });
  emit({ type: 'stage', key: 'classify', status: 'done' });
  emit({ type: 'stage', key: 'score', status: 'done' });
  emit({ type: 'stage', key: 'verify', status: 'done', note: `${verified} con cita completa` });
  emit({
    type: 'summary',
    detail_lookups: detailLookups,
    failed_lookups: failedLookups,
    verified,
    partial,
    emitted: opportunities.length,
  });

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
