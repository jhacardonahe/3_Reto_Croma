// Memoria de barrido — lo que convierte una corrida suelta en un AGENTE.
//
// Sin esto, cada corrida re-clasifica el mundo entero y no distingue lo nuevo de lo
// ya visto: el bot mandaría las mismas 3 oportunidades cada 6 horas y el KAM lo
// silenciaría el primer día.
//
// Idea (tomada de `detect.ts` de Centinela, ver COMPARATIVA-CENTINELA.md): la memoria
// NO es una lista de "vistos", es un HASH DE ESTADO por proceso. Así un proceso vuelve
// a entrar cuando cambia de fase (convocatoria → adjudicado) o cuando la entidad
// corrige el valor o mueve el cierre — que es justo cuando hay información nueva que
// contarle a alguien.
//
// El hash EXCLUYE a propósito el score y los días para cierre: ambos cambian solos con
// el paso del tiempo y marcarían todo como "actualizado" cada día.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import type { OpportunityResult } from '../types.js';

/** Estado de una oportunidad frente a lo que el agente ya había visto. */
export type Novelty = 'new' | 'changed' | 'known';

export interface SeenEntry {
  hash: string; // huella de estado (ver `fingerprint`)
  first_seen: string; // ISO — la primera vez que el agente la vio
  last_seen: string; // ISO — la última corrida que la encontró
  last_score: number;
}

export type SeenMap = Record<string, SeenEntry>;

export interface SeenDiff {
  novelty: Record<string, Novelty>; // notice_uid → estado
  next: SeenMap; // mapa a persistir tras esta corrida
  counts: { new: number; changed: number; known: number };
}

/** Ruta del mapa persistido (junto al caché de Croma, mismo ciclo de vida). */
export const SEEN_FILE = resolve(config.cacheDir, 'seen.json');

/** Se olvidan los procesos que llevan este tiempo sin aparecer (el archivo no crece sin fin). */
export const RETENTION_DAYS = 120;

/**
 * Huella de los campos cuyo cambio significa "vuelve a mirar esto".
 * Fase y estado del procedimiento vienen crudos de Croma; valor y cierre son los datos
 * que el guard de citas ya verifica.
 */
export function fingerprint(o: OpportunityResult): string {
  const parts = [
    o.phase ?? '',
    o.procedure_status ?? '',
    o.estimated_value ?? '',
    o.closing_date ?? '',
    o.foton_line,
  ].join('|');
  return createHash('sha1').update(parts).digest('hex').slice(0, 16);
}

/**
 * Compara las oportunidades de esta corrida contra la memoria. PURA: no toca disco ni
 * reloj (el `now` se inyecta) para poder evaluarla en el harness.
 *
 * Devuelve el estado por proceso y el mapa siguiente — pero NO lo escribe: solo el
 * barrido (`npm run sweep`) persiste. Así el dashboard puede pintar el chip "NUEVO"
 * cuantas veces quiera sin consumir la novedad que el agente aún no ha notificado.
 */
export function diffOpportunities(
  opportunities: readonly OpportunityResult[],
  seen: SeenMap,
  now: Date = new Date(),
): SeenDiff {
  const iso = now.toISOString();
  const next: SeenMap = { ...seen };
  const novelty: Record<string, Novelty> = {};
  const counts = { new: 0, changed: 0, known: 0 };

  for (const o of opportunities) {
    const hash = fingerprint(o);
    const previous = seen[o.notice_uid];
    const state: Novelty = !previous ? 'new' : previous.hash === hash ? 'known' : 'changed';

    novelty[o.notice_uid] = state;
    counts[state]++;
    next[o.notice_uid] = {
      hash,
      first_seen: previous?.first_seen ?? iso,
      last_seen: iso,
      last_score: o.scoring.total,
    };
  }

  return { novelty, next, counts };
}

/** Marca cada oportunidad con su estado (mutación in-place, el objeto ya es nuestro). */
export function annotateNovelty(
  opportunities: OpportunityResult[],
  novelty: Record<string, Novelty>,
): OpportunityResult[] {
  for (const o of opportunities) o.novelty = novelty[o.notice_uid] ?? 'new';
  return opportunities;
}

/** Descarta lo que lleva más de `RETENTION_DAYS` sin verse. Pura. */
export function pruneSeen(map: SeenMap, now: Date = new Date()): SeenMap {
  const cutoff = now.getTime() - RETENTION_DAYS * 86_400_000;
  const out: SeenMap = {};
  for (const [uid, entry] of Object.entries(map)) {
    const ts = Date.parse(entry.last_seen);
    if (!Number.isFinite(ts) || ts >= cutoff) out[uid] = entry;
  }
  return out;
}

/** Lee la memoria. Un archivo corrupto o ausente arranca vacío: el agente nunca se cae por esto. */
export function loadSeen(file = SEEN_FILE): SeenMap {
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { seen?: SeenMap };
    return parsed.seen ?? {};
  } catch {
    return {};
  }
}

/** Persiste la memoria ya podada. */
export function saveSeen(map: SeenMap, file = SEEN_FILE, now: Date = new Date()): void {
  const seen = pruneSeen(map, now);
  writeFileSync(file, JSON.stringify({ updated_at: now.toISOString(), seen }, null, 2));
}
