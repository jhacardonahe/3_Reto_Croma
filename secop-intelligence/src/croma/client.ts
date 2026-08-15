import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import type {
  ContractResponse,
  ContractsByProviderResponse,
  ProcessResponse,
  ProcessesByEntityResponse,
  SanctionsResponse,
} from '../types.js';

/**
 * Cliente de la API de Croma (SECOP II). Habla el REST real de producción:
 *   POST {baseUrl}/co/secop/<endpoint>/v1  con  Authorization: Bearer <CROMA_API_KEY>
 *
 * Incluye: rate-limiting (<= N/min), retry con backoff exponencial, y caché en disco
 * para no reconsultar lo ya visto (brief §12).
 */
class RateLimiter {
  private timestamps: number[] = [];
  constructor(private maxPerMin: number) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter((t) => now - t < 60_000);
      if (this.timestamps.length < this.maxPerMin) {
        this.timestamps.push(now);
        return;
      }
      const waitMs = 60_000 - (now - this.timestamps[0]) + 50;
      await sleep(waitMs);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class CromaClient {
  private limiter = new RateLimiter(config.maxCallsPerMin);
  private readonly ttlMs = config.cacheTtlHours * 3_600_000;

  constructor(
    private apiKey = config.cromaApiKey,
    private baseUrl = config.cromaBaseUrl,
  ) {
    if (!existsSync(config.cacheDir)) mkdirSync(config.cacheDir, { recursive: true });
  }

  get hasKey(): boolean {
    return this.apiKey.trim().length > 0;
  }

  // --- Endpoints SECOP ------------------------------------------------------

  processesByEntity(document_number: string, from_date = '', to_date = '', page = 1) {
    return this.post<ProcessesByEntityResponse>('co/secop/processes-by-entity', {
      document_number,
      ...(from_date ? { from_date } : {}),
      ...(to_date ? { to_date } : {}),
      page,
    });
  }

  process(notice_uid: string) {
    return this.post<ProcessResponse>('co/secop/process', { notice_uid });
  }

  contractsByProvider(document_number: string, from_date = '', to_date = '', entity_nit = '', page = 1) {
    return this.post<ContractsByProviderResponse>('co/secop/contracts-by-provider', {
      document_number,
      ...(from_date ? { from_date } : {}),
      ...(to_date ? { to_date } : {}),
      ...(entity_nit ? { entity_nit } : {}),
      page,
    });
  }

  contract(contract_id: string) {
    return this.post<ContractResponse>('co/secop/contract', { contract_id });
  }

  sanctionsByProvider(document_number: string) {
    return this.post<SanctionsResponse>('co/secop/sanctions-by-provider', { document_number });
  }

  // --- HTTP con caché + rate-limit + retry ---------------------------------

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const cached = this.readCache<T>(path, body);
    if (cached !== null) return cached;

    if (!this.hasKey) {
      throw new CromaError(
        'Falta CROMA_API_KEY. Copia .env.example a .env y añade tu key (usecroma.com → Get API key).',
        401,
      );
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}/${path}/v1`;
    const maxAttempts = 4;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.limiter.acquire();
      try {
        const res = await fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }, 30_000);

        if (res.status === 429 || res.status >= 500) {
          throw new CromaError(`Croma respondió ${res.status}`, res.status);
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new CromaError(`Croma ${res.status}: ${text.slice(0, 200)}`, res.status);
        }

        const json = (await res.json()) as { data?: T } | T;
        // La API envuelve algunas respuestas en { status, data, cache_hit }.
        const data = (json as { data?: T }).data ?? (json as T);
        this.writeCache(path, body, data);
        return data;
      } catch (err) {
        lastErr = err;
        const status = err instanceof CromaError ? err.status : 0;
        const retryable = status === 429 || status >= 500 || status === 0;
        if (!retryable || attempt === maxAttempts) break;
        const backoff = 500 * 2 ** (attempt - 1) + Math.random() * 250;
        await sleep(backoff);
      }
    }
    throw lastErr instanceof Error ? lastErr : new CromaError('Fallo desconocido en Croma', 0);
  }

  // --- Caché en disco -------------------------------------------------------

  private cacheFile(path: string, body: Record<string, unknown>): string {
    const key = createHash('sha1').update(path + JSON.stringify(body)).digest('hex');
    return resolve(config.cacheDir, `${path.replace(/\//g, '_')}_${key}.json`);
  }

  private readCache<T>(path: string, body: Record<string, unknown>): T | null {
    const file = this.cacheFile(path, body);
    if (!existsSync(file)) return null;
    try {
      const { ts, data } = JSON.parse(readFileSync(file, 'utf8')) as { ts: number; data: T };
      if (Date.now() - ts > this.ttlMs) return null;
      return data;
    } catch {
      return null;
    }
  }

  private writeCache<T>(path: string, body: Record<string, unknown>, data: T): void {
    try {
      writeFileSync(this.cacheFile(path, body), JSON.stringify({ ts: Date.now(), data }));
    } catch {
      /* caché best-effort */
    }
  }
}

export class CromaError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'CromaError';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export const croma = new CromaClient();
