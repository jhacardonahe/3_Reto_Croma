import type { Request, Response } from 'express';
import { runMonitoring } from '../modules/monitoring.js';
import { analyzeCompetitor } from '../modules/competitive.js';
import { analyzeMarket } from '../modules/market.js';
import { analyzeRetrospective } from '../modules/retrospective.js';
import { getActiveTaxonomy, setActiveTaxonomy, activeSegments } from '../modules/classification.js';
import { generateTaxonomy, TaxonomyGenError } from '../modules/taxonomy-gen.js';
import { defaultTaxonomy } from '../config.js';
import type { Taxonomy } from '../types.js';
import { trackContract, trackContractWithSanctions } from '../modules/tracking.js';
import { opportunitiesToCsv } from '../utils/csv-export.js';
import { croma } from '../croma/client.js';
import { config, entities, competitors } from '../config.js';

function fail(res: Response, err: unknown): void {
  const status = (err as { status?: number }).status ?? 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: err instanceof Error ? err.message : 'Error desconocido',
  });
}

export async function getHealth(_req: Request, res: Response): Promise<void> {
  res.json({
    ok: true,
    croma_key_configured: croma.hasKey,
    base_url: config.cromaBaseUrl,
    entities: entities.length,
    competitors: competitors.length,
    usage: croma.getUsage(),
  });
}

/**
 * Cuota de la API de Croma: remaining/limit/reset por key (primaria y backup), tomado de
 * los headers X-RateLimit-* de la última respuesta. Alimenta la barra de capacidad de la UI.
 * Default Bucket = 100 requests/día por organización (docs.usecroma.com/rate-limits).
 */
export async function getUsage(_req: Request, res: Response): Promise<void> {
  res.json(croma.getUsage());
}

export async function getOpportunities(req: Request, res: Response): Promise<void> {
  try {
    const entityNits = parseList(req.query.entity_nits);
    const run = await runMonitoring({
      entityNits,
      fromDate: str(req.query.from_date),
      limit: num(req.query.limit) ?? 20,
      minScore: num(req.query.min_score),
      segments: parseList(req.query.segment ?? req.query.segments),
      department: str(req.query.department) || undefined,
      keyword: str(req.query.keyword) || undefined,
    });

    if (str(req.query.format) === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="opportunities.csv"');
      res.send(opportunitiesToCsv(run.opportunities));
      return;
    }
    res.json({
      timestamp: run.timestamp,
      total_processed: run.total_processed,
      total_filtered: run.total_prefiltered,
      detail_lookups: run.detail_lookups,
      failed_lookups: run.failed_lookups,
      total_count: run.opportunities.length,
      opportunities: run.opportunities,
    });
  } catch (err) {
    fail(res, err);
  }
}

/**
 * Igual que getOpportunities, pero transmite la corrida en vivo por SSE:
 * cada hito del pipeline (listar → pre-filtrar → detallar → clasificar → puntuar →
 * verificar) se emite como evento para el panel de trazabilidad. El evento final
 * `done` trae el payload completo con el que se pinta la tabla. Solo lectura.
 */
export async function streamOpportunities(req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx: no bufferizar el stream
  (res as unknown as { flushHeaders?: () => void }).flushHeaders?.();

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const run = await runMonitoring({
      entityNits: parseList(req.query.entity_nits),
      fromDate: str(req.query.from_date),
      limit: num(req.query.limit) ?? 20,
      minScore: num(req.query.min_score),
      segments: parseList(req.query.segment ?? req.query.segments),
      department: str(req.query.department) || undefined,
      keyword: str(req.query.keyword) || undefined,
      onEvent: (ev) => send('event', ev),
    });
    send('done', {
      timestamp: run.timestamp,
      total_processed: run.total_processed,
      total_filtered: run.total_prefiltered,
      detail_lookups: run.detail_lookups,
      failed_lookups: run.failed_lookups,
      total_count: run.opportunities.length,
      opportunities: run.opportunities,
    });
  } catch (err) {
    send('failed', { error: err instanceof Error ? err.message : 'Error desconocido' });
  } finally {
    res.end();
  }
}

export async function postCompetitorAnalysis(req: Request, res: Response): Promise<void> {
  try {
    const nit = String(req.body?.competitor_nit ?? '').trim();
    if (!nit) {
      res.status(400).json({ error: 'competitor_nit es obligatorio' });
      return;
    }
    const period = req.body?.period ?? {};
    const b = req.body ?? {};
    const minValueRaw = b.min_value ?? b.filters?.min_value;
    const analysis = await analyzeCompetitor(nit, {
      fromDate: (b.from_date ?? period.from_date) || undefined,
      toDate: (b.to_date ?? period.to_date) || undefined,
      line: (b.line ?? b.filters?.line) || undefined,
      entityNit: (b.entity_nit ?? b.filters?.entity_nit) || undefined,
      minValue: minValueRaw != null && minValueRaw !== '' ? Number(minValueRaw) : undefined,
      keyword: (b.keyword ?? b.filters?.keyword) || undefined,
    });
    res.json(analysis);
  } catch (err) {
    fail(res, err);
  }
}

/** Inteligencia de mercado por sector: cómo compran las entidades (todos los proveedores). */
export async function getMarket(req: Request, res: Response): Promise<void> {
  try {
    const analysis = await analyzeMarket({
      entityNits: parseList(req.query.entity_nits),
      fromDate: str(req.query.from_date) || undefined,
      toDate: str(req.query.to_date) || undefined,
      line: str(req.query.line ?? req.query.segment) || undefined,
      department: str(req.query.department) || undefined,
      keyword: str(req.query.keyword) || undefined,
      maxDetailLookups: num(req.query.max_detail),
    });
    res.json(analysis);
  } catch (err) {
    fail(res, err);
  }
}

/** Retrospectiva: oportunidades de vehículos Foton que YA CERRARON (histórico 2024→hoy). */
export async function getRetrospective(req: Request, res: Response): Promise<void> {
  try {
    const result = await analyzeRetrospective({
      entityNits: parseList(req.query.entity_nits),
      fromDate: str(req.query.from_date) || undefined,
      toDate: str(req.query.to_date) || undefined,
      minPrice: num(req.query.min_price),
      maxPages: num(req.query.max_pages),
      line: str(req.query.line ?? req.query.segment) || undefined,
      department: str(req.query.department) || undefined,
      keyword: str(req.query.keyword) || undefined,
    });
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
}

// --- Taxonomía dinámica (categorías definidas por el usuario) ---------------

/** Taxonomía activa + segmentos (para poblar los desplegables del dashboard). */
export async function getTaxonomy(_req: Request, res: Response): Promise<void> {
  const tax = getActiveTaxonomy();
  res.json({ taxonomy: tax, segments: activeSegments(tax), ai_available: config.anthropicApiKey.trim().length > 0 });
}

/** Segmentos (líneas) de la taxonomía activa. */
export async function getSegments(_req: Request, res: Response): Promise<void> {
  res.json({ segments: activeSegments() });
}

/** Genera una taxonomía desde una descripción del negocio (IA). NO la activa: es para previsualizar. */
export async function postGenerateTaxonomy(req: Request, res: Response): Promise<void> {
  try {
    const description = String(req.body?.description ?? '').trim();
    const taxonomy = await generateTaxonomy(description);
    res.json({ taxonomy, segments: activeSegments(taxonomy) });
  } catch (err) {
    const status = err instanceof TaxonomyGenError ? err.status : 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: err instanceof Error ? err.message : 'Error generando la taxonomía',
    });
  }
}

/** Activa una taxonomía (la generada/editada, o cualquiera válida). Vuelve a compilarse en caliente. */
export async function postSetTaxonomy(req: Request, res: Response): Promise<void> {
  try {
    const tax = req.body?.taxonomy as Taxonomy | undefined;
    if (!tax || !Array.isArray(tax.rules) || tax.rules.length === 0 || !Array.isArray(tax.prefilter)) {
      res.status(400).json({ error: 'Taxonomía inválida: requiere prefilter[] y rules[] no vacíos.' });
      return;
    }
    setActiveTaxonomy(tax);
    res.json({ ok: true, taxonomy: getActiveTaxonomy(), segments: activeSegments() });
  } catch (err) {
    fail(res, err);
  }
}

/** Restablece la taxonomía al preset Foton por defecto. */
export async function postResetTaxonomy(_req: Request, res: Response): Promise<void> {
  setActiveTaxonomy(defaultTaxonomy);
  res.json({ ok: true, taxonomy: getActiveTaxonomy(), segments: activeSegments() });
}

export async function getContractTracking(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.contract_id;
    const providerDoc = str(req.query.provider_document);
    const tracking = providerDoc ? await trackContractWithSanctions(id, providerDoc) : await trackContract(id);
    res.json(tracking);
  } catch (err) {
    fail(res, err);
  }
}

// --- helpers de parseo de query --------------------------------------------
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function num(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v !== undefined ? n : undefined;
}
function parseList(v: unknown): string[] | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}
