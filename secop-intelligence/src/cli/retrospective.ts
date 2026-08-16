// CLI retrospectivo: oportunidades de vehículos Foton que YA CERRARON (2024 → hoy).
// La lógica vive en src/modules/retrospective.ts (compartida con el endpoint /api/retrospective).
// Uso: npm run retro [-- --from 2024-01-01 --to 2026-08-16 --nits 800141397,... --min-price 30000000 --line PICKUP]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { analyzeRetrospective } from '../modules/retrospective.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const out = await analyzeRetrospective({
    fromDate: arg('from'),
    toDate: arg('to'),
    minPrice: arg('min-price') ? Number(arg('min-price')) : undefined,
    maxPages: arg('max-pages') ? Number(arg('max-pages')) : undefined,
    entityNits: arg('nits')?.split(',').map((s) => s.trim()).filter(Boolean),
    line: arg('line'),
  });

  const file = resolve(config.cacheDir, 'retrospective.json');
  writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`\nRETROSPECTIVA de oportunidades CERRADAS  ·  ${out.window.from} → ${out.window.to}`);
  console.log(`Entidades: ${out.entities_scanned} · páginas: ${out.pages_fetched} · procesos vistos: ${out.processes_seen}`);
  console.log(`Oportunidades cerradas (Foton-relevantes): ${out.closed_opportunities}  ·  valor total: $${(out.total_value / 1e9).toFixed(2)}B  ·  desiertas: ${out.void_count}`);
  console.log(`\nPor línea Foton:`);
  for (const [line, v] of Object.entries(out.by_line).sort((a, b) => b[1].value - a[1].value))
    console.log(`  ${line.padEnd(18)} ${String(v.count).padStart(3)}  $${(v.value / 1e9).toFixed(2)}B`);
  console.log(`\nTop 15 por valor:`);
  for (const r of out.opportunities.slice(0, 15))
    console.log(`  $${String(r.value ?? 0).padStart(12)}  ${r.foton_line.padEnd(16)} ${(r.status ?? '').slice(0, 12).padEnd(12)} ${(r.entity ?? '').slice(0, 22).padEnd(22)} ${r.object.slice(0, 46)}`);
  console.log(`\nGuardado en: ${file}`);
}

main().catch((err) => {
  console.error('Error en retrospectiva:', err instanceof Error ? err.message : err);
  process.exit(1);
});
