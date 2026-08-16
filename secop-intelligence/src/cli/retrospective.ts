// CLI retrospectivo: oportunidades de vehículos Foton que YA CERRARON (2024 → hoy).
// A diferencia del monitoreo en vivo (que apunta a lo abierto), esto barre el histórico
// para ver la demanda que ya pasó: qué compró/licitó el sector y Foton no capturó en vivo.
//
// Diseño anti-throttling: NO hace llamadas de detalle. Clasifica por el `name` del resumen
// (que suele traer "ADQUISICIÓN ... CAMIONETAS ...") y filtra por estado cerrado. Solo gasta
// una llamada `processes-by-entity` por página por entidad (barato, cacheado, rate-limited).
//
// Uso: npm run retro [-- --from 2024-01-01 --to 2026-08-16 --nits 800141397,... --min-price 30000000]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config, entities as configuredEntities, GOODS_CONTRACT_TYPES, MIN_VEHICLE_PRICE } from '../config.js';
import { croma } from '../croma/client.js';
import { classifyFotonLine } from '../modules/classification.js';
import { estimateUnits, extractSpecs } from '../utils/estimate.js';
import type { ProcessSummary } from '../types.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function fold(s: string | null | undefined): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// La puja YA terminó: adjudicado / seleccionado / celebrado / en ejecución / terminado /
// liquidado / cerrado / declarado desierto. (Lo contrario: publicado / en evaluación / borrador.)
const CLOSED = /seleccion|adjudic|celebr|ejecu|termin|liquid|cerrad|desiert/;
const VOID = /desiert/; // subtipo: cerró sin adjudicar

async function main(): Promise<void> {
  const fromDate = arg('from') ?? '2024-01-01';
  const toDate = arg('to') ?? '';
  const minPrice = arg('min-price') ? Number(arg('min-price')) : MIN_VEHICLE_PRICE;
  const maxPages = arg('max-pages') ? Number(arg('max-pages')) : 6; // tope por entidad (500 c/u)
  const nits = arg('nits')?.split(',').map((s) => s.trim()).filter(Boolean);
  const targets = nits?.length ? nits : configuredEntities.map((e) => e.nit);

  const rows: {
    entity: string | null; entity_nit: string | null; notice_uid: string;
    object: string; foton_line: string; value: number | null; status: string | null;
    published_date: string | null; void: boolean; url: string | null;
    estimated_quantity: number | null; specs: string[];
  }[] = [];
  let totalSeen = 0;
  let pagesFetched = 0;

  for (const nit of targets) {
    for (let page = 1; page <= maxPages; page++) {
      const res = await croma.processesByEntity(nit, fromDate, toDate, page).catch(() => null);
      if (!res) break;
      pagesFetched++;
      totalSeen += res.processes.length;
      for (const p of res.processes as ProcessSummary[]) {
        if (!p.notice_uid) continue;
        if ((p.base_price ?? 0) < minPrice) continue;
        // pre-filtro barato de bienes (evita servicios de mantenimiento)
        const type = (p.contract_type ?? '').toLowerCase();
        if (!GOODS_CONTRACT_TYPES.some((t) => type.includes(t))) continue;
        const cls = classifyFotonLine(`${p.name ?? ''} ${p.contract_type ?? ''}`);
        if (cls.line === 'UNKNOWN') continue; // no mapea a línea Foton
        const st = fold(`${p.procedure_status ?? ''} ${p.phase ?? ''}`);
        if (!CLOSED.test(st)) continue; // solo las que YA cerraron
        rows.push({
          entity: p.entity, entity_nit: p.entity_nit ?? nit, notice_uid: p.notice_uid,
          object: p.name ?? '', foton_line: cls.line, value: p.base_price ?? null,
          status: p.procedure_status ?? p.phase ?? null, published_date: p.published_date ?? null,
          void: VOID.test(st), url: p.url ?? null,
          ...estimateUnits(p.name ?? null, p.base_price ?? null), specs: extractSpecs(p.name ?? null),
        });
      }
      if (!res.capped) break; // no hay más páginas
    }
  }

  // dedupe por notice_uid (una oportunidad = un proceso)
  const seen = new Set<string>();
  const dedup = rows.filter((r) => (seen.has(r.notice_uid) ? false : (seen.add(r.notice_uid), true)));
  dedup.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const byLine: Record<string, { count: number; value: number }> = {};
  const byEntity: Record<string, { name: string | null; count: number; value: number }> = {};
  for (const r of dedup) {
    (byLine[r.foton_line] ??= { count: 0, value: 0 });
    byLine[r.foton_line].count++; byLine[r.foton_line].value += r.value ?? 0;
    const k = r.entity_nit ?? 'N/D';
    (byEntity[k] ??= { name: r.entity, count: 0, value: 0 });
    byEntity[k].count++; byEntity[k].value += r.value ?? 0;
  }
  const totalValue = dedup.reduce((a, r) => a + (r.value ?? 0), 0);
  const voidCount = dedup.filter((r) => r.void).length;

  const out = {
    generated_at: new Date().toISOString(),
    window: { from: fromDate, to: toDate || 'hoy' },
    entities_scanned: targets.length, pages_fetched: pagesFetched, processes_seen: totalSeen,
    closed_opportunities: dedup.length, total_value: totalValue, void_count: voidCount,
    by_line: byLine, by_entity: byEntity, opportunities: dedup,
  };
  const file = resolve(config.cacheDir, 'retrospective.json');
  writeFileSync(file, JSON.stringify(out, null, 2));

  console.log(`\nRETROSPECTIVA de oportunidades CERRADAS  ·  ${fromDate} → ${toDate || 'hoy'}`);
  console.log(`Entidades: ${targets.length} · páginas: ${pagesFetched} · procesos vistos: ${totalSeen}`);
  console.log(`Oportunidades cerradas (Foton-relevantes): ${dedup.length}  ·  valor total: $${(totalValue / 1e9).toFixed(2)}B  ·  desiertas: ${voidCount}`);
  console.log(`\nPor línea Foton:`);
  for (const [line, v] of Object.entries(byLine).sort((a, b) => b[1].value - a[1].value))
    console.log(`  ${line.padEnd(18)} ${String(v.count).padStart(3)}  $${(v.value / 1e9).toFixed(2)}B`);
  console.log(`\nTop 15 por valor:`);
  for (const r of dedup.slice(0, 15))
    console.log(`  $${String((r.value ?? 0)).padStart(12)}  ${r.foton_line.padEnd(16)} ${(r.status ?? '').slice(0, 12).padEnd(12)} ${(r.entity ?? '').slice(0, 22).padEnd(22)} ${r.object.slice(0, 46)}`);
  console.log(`\nGuardado en: ${file}`);
}

main().catch((err) => {
  console.error('Error en retrospectiva:', err instanceof Error ? err.message : err);
  process.exit(1);
});
