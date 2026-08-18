// Construcción del mensaje que recibe el KAM — PURO (sin red, sin reloj, sin disco),
// para poder evaluarlo en `npm run eval` como cualquier otra pieza del núcleo.
//
// Dos decisiones de producto:
//  1. **Digest, no goteo**: un mensaje por corrida con el top-N de novedades. Un
//     mensaje por oportunidad hace que el bot se silencie el primer día.
//  2. **La cita viaja con el dato**: cada oportunidad lleva su `notice_uid` y el chip
//     del guard de citas. El canal cambia; el estándar de "nada afirmado sin fuente"
//     no.
import type { MonitorRun } from '../modules/monitoring.js';
import type { Novelty } from '../modules/seen.js';
import type { OpportunityResult } from '../types.js';
import { escapeHtml, type TelegramButton } from './telegram.js';

export interface DigestInput {
  run: MonitorRun;
  novelty: Record<string, Novelty>;
  /** Cuántas oportunidades detallar en el mensaje (el resto se resume en una línea). */
  limit?: number;
  /** URL pública del dashboard, para el botón "abrir tablero". */
  dashboardUrl?: string | null;
}

export interface Digest {
  html: string;
  buttons: TelegramButton[];
  /** Novedades incluidas (nuevas + actualizadas). 0 ⇒ no hay nada que contar. */
  count: number;
}

const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export function formatCop(value: number | null): string {
  return value == null ? 'sin publicar' : COP.format(value);
}

/** Chip del guard de citas, en el mismo lenguaje que el dashboard. */
export function verificationChip(o: OpportunityResult): string {
  const { ok, confirmed, checked } = o.verification;
  return ok ? `✓ ${confirmed}/${checked} verificado` : `⚠ ${confirmed}/${checked} parcial`;
}

function closingLine(o: OpportunityResult): string {
  if (o.closing_date == null) return 'cierre sin publicar';
  if (o.days_to_close == null) return `cierra ${o.closing_date}`;
  if (o.days_to_close < 0) return `cerró ${o.closing_date}`;
  return `cierra ${o.closing_date} · ${o.days_to_close} día${o.days_to_close === 1 ? '' : 's'}`;
}

/**
 * Arma el digest de una corrida. Devuelve `null` cuando no hay NADA nuevo:
 * el silencio es la respuesta correcta y es lo que hace que el bot siga siendo creíble.
 */
export function buildDigest({ run, novelty, limit = 5, dashboardUrl }: DigestInput): Digest | null {
  const fresh = run.opportunities.filter((o) => {
    const state = novelty[o.notice_uid] ?? 'new';
    return state === 'new' || state === 'changed';
  });
  if (fresh.length === 0) return null;

  const nuevas = fresh.filter((o) => (novelty[o.notice_uid] ?? 'new') === 'new').length;
  const actualizadas = fresh.length - nuevas;

  const head =
    `🚨 <b>SECOP · ${fresh.length} novedad${fresh.length === 1 ? '' : 'es'}</b>\n` +
    `${nuevas} nueva${nuevas === 1 ? '' : 's'} · ${actualizadas} actualizada${actualizadas === 1 ? '' : 's'}` +
    ` · ${run.entities_scanned} entidad${run.entities_scanned === 1 ? '' : 'es'} barrida${run.entities_scanned === 1 ? '' : 's'}`;

  const shown = fresh.slice(0, limit);
  const blocks = shown.map((o) => {
    const tag = (novelty[o.notice_uid] ?? 'new') === 'new' ? '🆕' : '♻️';
    const lines = [
      `${tag} <b>${escapeHtml(o.foton_line)}</b> · score <b>${o.scoring.total.toFixed(1)}</b>`,
      `🏛 ${escapeHtml(o.entity_name ?? o.entity_nit ?? 'entidad sin nombre')}`,
      `📄 ${escapeHtml(o.object.slice(0, 160))}`,
      `💰 ${escapeHtml(formatCop(o.estimated_value))} · ⏳ ${escapeHtml(closingLine(o))}`,
      `🔗 <code>${escapeHtml(o.notice_uid)}</code> · ${escapeHtml(verificationChip(o))}`,
    ];
    if (o.alerts.length) lines.push(`⚡ ${escapeHtml(o.alerts.join(' · '))}`);
    if (o.secop_link) lines.push(`<a href="${escapeHtml(o.secop_link)}">Ver en SECOP II</a>`);
    return lines.join('\n');
  });

  const rest = fresh.length - shown.length;
  const tail = [
    rest > 0 ? `…y ${rest} más en el tablero.` : '',
    `<i>Datos de Croma · ${run.detail_lookups} consulta${run.detail_lookups === 1 ? '' : 's'} de detalle` +
      `${run.failed_lookups ? ` · ${run.failed_lookups} fallida${run.failed_lookups === 1 ? '' : 's'}` : ''}</i>`,
  ].filter(Boolean);

  const buttons: TelegramButton[] = [];
  if (dashboardUrl) buttons.push({ text: '📊 Abrir tablero', url: dashboardUrl });
  const top = shown[0];
  if (top?.secop_link) buttons.push({ text: '📄 Ver la #1 en SECOP', url: top.secop_link });

  return {
    html: [head, ...blocks, ...tail].join('\n\n'),
    buttons,
    count: fresh.length,
  };
}
