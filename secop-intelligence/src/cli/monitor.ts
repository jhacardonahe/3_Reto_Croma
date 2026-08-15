// CLI de monitoreo: corre una pasada y guarda el resultado en data/cache/opportunities.json
// Uso: npm run monitor  [-- --from 2026-08-01 --limit 50 --nits 890980040,890905211]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { runMonitoring } from '../modules/monitoring.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const run = await runMonitoring({
    fromDate: arg('from'),
    entityNits: arg('nits')?.split(',').map((s) => s.trim()).filter(Boolean),
    limit: arg('limit') ? Number(arg('limit')) : 50,
    minScore: arg('min-score') ? Number(arg('min-score')) : undefined,
  });

  const out = resolve(config.cacheDir, 'opportunities.json');
  writeFileSync(out, JSON.stringify(run, null, 2));

  console.log(`Entidades escaneadas : ${run.entities_scanned}`);
  console.log(`Procesos vistos      : ${run.total_processed}`);
  console.log(`Pre-filtrados        : ${run.total_prefiltered}`);
  console.log(`Llamadas de detalle  : ${run.detail_lookups} (fallidas: ${run.failed_lookups})`);
  console.log(`Oportunidades (top)  : ${run.opportunities.length}`);
  console.log(`\nGuardado en: ${out}`);
  for (const o of run.opportunities.slice(0, 10)) {
    console.log(`  [${o.scoring.total.toFixed(1)}] ${o.foton_line}  ${o.entity_name}  —  ${o.object.slice(0, 60)}`);
  }
}

main().catch((err) => {
  console.error('Error en monitoreo:', err instanceof Error ? err.message : err);
  process.exit(1);
});
