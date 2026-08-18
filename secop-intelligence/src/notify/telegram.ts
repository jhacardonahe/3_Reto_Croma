// Emisor de Telegram — el canal por el que el agente HABLA PRIMERO.
//
// Sin dependencias: la Bot API es un POST JSON y `fetch` es nativo en Node 18+.
// Añadir grammY/telegraf solo tendría sentido si conversáramos desde aquí; la
// conversación la atiende el agente de n8n (n8n/asesor-telegram.workflow.json).
//
// Regla de oro de este módulo: **notificar nunca puede tumbar el barrido**. Todo
// error se captura y se reporta como valor de retorno; no se lanza.
import { config } from '../config.js';

/** Botón de teclado inline. Solo URL: no requiere backend que atienda callbacks. */
export interface TelegramButton {
  text: string;
  url: string;
}

export interface SendResult {
  ok: boolean;
  sent: number; // nº de mensajes efectivamente enviados (un texto largo se parte)
  error?: string;
}

/** Límite duro de la Bot API por mensaje. */
const MAX_LEN = 4096;

export const telegramConfigured = (): boolean =>
  config.telegram.token.length > 0 && config.telegram.chatId.length > 0;

/** Escapa el subconjunto HTML que acepta Telegram (`parse_mode: HTML`). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Parte un mensaje largo por saltos de línea sin romper etiquetas a la mitad
 * (cortamos siempre en frontera de línea, y nuestras etiquetas nunca cruzan líneas).
 */
export function splitMessage(text: string, maxLen = MAX_LEN): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = line.slice(0, maxLen);
    } else {
      current = candidate.slice(0, maxLen);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Envía un mensaje al chat configurado. Los botones se adjuntan al ÚLTIMO trozo
 * (es el que queda a la vista del usuario).
 */
export async function sendTelegram(
  html: string,
  buttons: TelegramButton[] = [],
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  if (!telegramConfigured()) {
    return { ok: false, sent: 0, error: 'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no configurados' };
  }

  const chunks = splitMessage(html);
  let sent = 0;
  for (const [i, chunk] of chunks.entries()) {
    const isLast = i === chunks.length - 1;
    const body: Record<string, unknown> = {
      chat_id: config.telegram.chatId,
      text: chunk,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    // Máx. 2 botones por fila para que no se corten en móvil.
    if (isLast && buttons.length) body.reply_markup = { inline_keyboard: chunkBy(buttons, 2) };

    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${config.telegram.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { ok: false, sent, error: `Telegram ${res.status}: ${detail.slice(0, 200)}` };
      }
      sent++;
    } catch (err) {
      return { ok: false, sent, error: err instanceof Error ? err.message : 'fallo de red' };
    }
  }
  return { ok: true, sent };
}

function chunkBy<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
