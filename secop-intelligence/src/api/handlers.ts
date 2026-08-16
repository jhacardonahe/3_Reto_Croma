import type { Request, Response } from 'express';
import { runMonitoring } from '../modules/monitoring.js';
import { analyzeCompetitor } from '../modules/competitive.js';
import { analyzeMarket } from '../modules/market.js';
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
  });
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
