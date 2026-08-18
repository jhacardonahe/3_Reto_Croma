// EL LATIDO. Esto es lo que convierte el sistema en un agente: corre solo (systemd
// timer / n8n Schedule), compara contra la memoria y **habla primero** por Telegram.
//
//   npm run sweep                 # corrida real: barre, recuerda y notifica
//   npm run sweep -- --dry-run    # barre y muestra el mensaje, sin escribir ni enviar
//   npm run sweep -- --from 2026-08-01 --max-detail 60 --nits 800141397
//
// Contrato de salida (para el timer y para depurar):
//   0 = corrida sana (con o sin novedades)   1 = falló el barrido o el envío
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { runMonitoring } from '../modules/monitoring.js';
import { annotateNovelty, diffOpportunities, loadSeen, saveSeen, SEEN_FILE } from '../modules/seen.js';
import { buildDigest } from '../notify/digest.js';
import { sendTelegram, telegramConfigured } from '../notify/telegram.js';
import { daysAgo } from '../utils/date.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<number> {
  const dryRun = flag('dry-run');
  const now = new Date();

  const run = await runMonitoring({
    fromDate: arg('from') ?? daysAgo(config.sweep.windowDays),
    entityNits: arg('nits')?.split(',').map((s) => s.trim()).filter(Boolean),
    limit: arg('limit') ? Number(arg('limit')) : 50,
    minScore: arg('min-score') ? Number(arg('min-score')) : config.sweep.minScore,
    maxDetailLookups: arg('max-detail') ? Number(arg('max-detail')) : config.sweep.maxDetailLookups,
    detailConcurrency: arg('concurrency') ? Number(arg('concurrency')) : config.sweep.concurrency,
  });

  // Memoria: ¿qué de esto es realmente nuevo?
  const seen = loadSeen();
  const diff = diffOpportunities(run.opportunities, seen, now);
  annotateNovelty(run.opportunities, diff.novelty);

  console.log(`[${now.toISOString()}] barrido: ${run.entities_scanned} entidad(es) · ` +
    `${run.total_processed} procesos · ${run.detail_lookups} detalles (${run.failed_lookups} fallidos) · ` +
    `${run.opportunities.length} oportunidades`);
  console.log(`memoria: ${diff.counts.new} nueva(s) · ${diff.counts.changed} actualizada(s) · ` +
    `${diff.counts.known} ya conocida(s) · ${Object.keys(seen).length} en memoria`);

  const digest = buildDigest({
    run,
    novelty: diff.novelty,
    limit: config.sweep.digestLimit,
    dashboardUrl: config.publicBaseUrl || null,
  });

  if (dryRun) {
    console.log('\n--- dry-run: no se escribe memoria ni se envía a Telegram ---');
    console.log(digest ? `\n${digest.html}\n` : '\n(sin novedades → el agente calla)\n');
    return 0;
  }

  // Persistir SIEMPRE la corrida (el tablero lee esto aunque no haya novedades)...
  writeFileSync(resolve(config.cacheDir, 'opportunities.json'), JSON.stringify(run, null, 2));

  // ...y notificar ANTES de consumir la novedad: si el envío falla, la memoria no se
  // actualiza y la próxima corrida vuelve a intentarlo. Preferimos repetir un aviso a
  // perderlo en silencio.
  if (digest) {
    if (!telegramConfigured()) {
      console.warn(`${digest.count} novedad(es) SIN notificar: falta TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID`);
    } else {
      const sent = await sendTelegram(digest.html, digest.buttons);
      if (!sent.ok) {
        console.error(`Telegram falló: ${sent.error} — no se actualiza la memoria, se reintentará en el próximo latido`);
        return 1;
      }
      console.log(`Telegram: ${digest.count} novedad(es) enviadas en ${sent.sent} mensaje(s)`);
    }
  } else {
    console.log('sin novedades → el agente calla (y eso es lo correcto)');
  }

  saveSeen(diff.next, SEEN_FILE, now);
  console.log(`memoria guardada en ${SEEN_FILE}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Barrido falló:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
