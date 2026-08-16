import { defaultTaxonomy } from '../config.js';
import type { Classification, Taxonomy } from '../types.js';

/** Normaliza para comparar: minúsculas + sin tildes (robusto ante keywords con/sin acento). */
function norm(s: string): string {
  return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// --- Taxonomía activa -------------------------------------------------------
// Arranca en el preset Foton; el usuario puede reemplazarla en runtime (generada por IA
// desde una descripción del negocio) vía la API. La clasificación por proceso SIEMPRE es
// determinista y citable — solo cambian las REGLAS, no el mecanismo.
let active: Taxonomy = defaultTaxonomy;
export function getActiveTaxonomy(): Taxonomy {
  return active;
}
export function setActiveTaxonomy(t: Taxonomy): void {
  active = t;
}

/**
 * Clasifica un texto contra una taxonomía (determinista, first-match).
 * Una regla matchea si CADA grupo de `include` tiene ≥1 término presente (AND-de-ORs)
 * y NINGÚN término de `exclude` aparece. Sin taxonomía explícita usa la activa.
 */
export function classify(text: string, taxonomy: Taxonomy = active): Classification {
  const t = norm(text);
  for (const r of taxonomy.rules) {
    const includeOk = r.include.every((group) => group.some((k) => t.includes(norm(k))));
    if (!includeOk) continue;
    const excludeHit = (r.exclude ?? []).some((k) => t.includes(norm(k)));
    if (excludeHit) continue;
    return {
      line: r.line,
      confidence: r.confidence,
      matched_on: r.matched_on ?? r.include.map((g) => g[0]).join(' + '),
    };
  }
  return { line: 'UNKNOWN', confidence: 0 };
}

/** Pre-filtro barato: ¿el texto huele a algo de la taxonomía? Evita gastar una llamada de detalle. */
export function passesPrefilter(text: string, taxonomy: Taxonomy = active): boolean {
  const t = norm(text);
  return taxonomy.prefilter.some((k) => t.includes(norm(k)));
}

/** Categorías (líneas) declaradas por la taxonomía activa — para poblar los desplegables del UI. */
export function activeSegments(taxonomy: Taxonomy = active): string[] {
  return [...new Set(taxonomy.rules.map((r) => r.line))];
}

// --- Compatibilidad hacia atrás --------------------------------------------
// Los 6 módulos existentes (monitoreo, mercado, histórico, competencia, demo, eval)
// siguen llamando estos nombres; ahora resuelven contra la taxonomía ACTIVA.
export function classifyFotonLine(text: string): Classification {
  return classify(text, active);
}
export function passesGeneralFilter(text: string): boolean {
  return passesPrefilter(text, active);
}
