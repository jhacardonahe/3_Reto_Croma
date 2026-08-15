import { GENERAL_FILTER } from '../config.js';
import type { Classification } from '../types.js';

function norm(s: string): string {
  return (s ?? '').toLowerCase();
}

/** Pre-filtro barato: ¿el texto huele a vehículo? Evita gastar una llamada de detalle. */
export function passesGeneralFilter(text: string): boolean {
  const t = norm(text);
  return GENERAL_FILTER.some((k) => t.includes(k));
}

/**
 * Clasifica el texto de un proceso a una línea Foton.
 * Evaluación en orden jerárquico — first match wins (brief §4.1).
 */
export function classifyFotonLine(text: string): Classification {
  const t = norm(text);
  const has = (...ks: string[]) => ks.some((k) => t.includes(k));
  const isElectric = has('eléctrica', 'eléctrico', 'electrica', 'electrico');
  const isHybrid = has('hibrida', 'híbrida', 'hybrid', 'mhev');

  // 1. Camioneta eléctrica → NEW_ENERGY_PICKUP
  if (t.includes('camioneta') && isElectric) {
    return { line: 'NEW_ENERGY_PICKUP', confidence: 0.95, matched_on: 'camioneta + eléctrica' };
  }
  // 2. Camioneta híbrida → PICKUP_MHEV
  if (t.includes('camioneta') && isHybrid) {
    return { line: 'PICKUP_MHEV', confidence: 0.93, matched_on: 'camioneta + híbrida/MHEV' };
  }
  // 3. Camioneta diésel (sin eléctrica/híbrida) → PICKUP
  if (t.includes('camioneta') && has('diesel', 'diésel') && !isElectric) {
    return { line: 'PICKUP', confidence: 0.9, matched_on: 'camioneta + diesel' };
  }
  // 4. Tractocamión / carga pesada → HDT
  if (has('tractocamión', 'tractocamion', 'tractomula', 'cabezote')) {
    return { line: 'HDT', confidence: 0.88, matched_on: 'tractocamión' };
  }
  // 5. Camión (sin "camioneta") → LDT
  if (has('camión', 'camion', 'volqueta') && !t.includes('camioneta')) {
    return { line: 'LDT', confidence: 0.86, matched_on: 'camión' };
  }
  // 6. Vehículo eléctrico → NEW_ENERGY
  if (has('vehículo', 'vehiculo') && isElectric) {
    return { line: 'NEW_ENERGY', confidence: 0.85, matched_on: 'vehículo + eléctrico' };
  }
  // 7. Furgón / van / microbús → AUV_VAN
  if (has('furgón', 'furgon', 'van', 'microbus', 'microbús')) {
    return { line: 'AUV_VAN', confidence: 0.83, matched_on: 'furgón/van/microbús' };
  }
  // 8. Especiales
  if (has('ambulancia', 'blindado', 'bomberos')) {
    return { line: 'SPECIAL', confidence: 0.82, matched_on: 'vehículo especial' };
  }
  // 9. Camioneta genérica / SUV / pickup
  if (t.includes('camioneta') || has('suv', 'pick-up', 'pickup', 'doble cabina')) {
    return { line: 'PICKUP', confidence: 0.75, matched_on: 'camioneta/SUV/pickup genérico' };
  }
  return { line: 'UNKNOWN', confidence: 0 };
}
