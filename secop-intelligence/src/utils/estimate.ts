// Estimación de unidades y precio unitario a partir del TEXTO del objeto.
// SECOP NO expone cantidad ni precio unitario como dato estructurado (viven en los
// pliegos/anexos PDF), así que esto es APROXIMADO y NO oficial. Se usa igual en
// oportunidades (valor estimado del proceso) y en contratos de competidores.

const VEH_NOUN =
  'camionetas?|veh[ií]culos?|camiones?|cami[oó]n|vans?|furgones?|furg[oó]n|microbuses?|microb[uú]s|motocicletas?|pick[- ]?ups?|suv|autom[oó]viles?|autom[oó]vil|busetas?|buses?|volquetas?|ambulancias?';

export interface UnitEstimate {
  estimated_quantity: number | null;
  estimated_unit_price: number | null;
}

/**
 * Extrae la cantidad TITULAR de vehículos del objeto (ej. "Cinco (5) camionetas",
 * "5 vehículos", "(3) camiones") y deriva el precio unitario = valor / cantidad.
 * Toma el máximo match (no suma) para no duplicar cuando una misma compra se
 * describe con dos sustantivos ("5 vehículos tipo camioneta").
 */
export function estimateUnits(object: string | null | undefined, value: number | null | undefined): UnitEstimate {
  const re = new RegExp(`\\(?(\\d{1,4})\\)?\\s+(?:${VEH_NOUN})`, 'gi');
  let qty = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(object ?? '')) !== null) qty = Math.max(qty, Number(m[1]));
  if (qty > 0 && value) return { estimated_quantity: qty, estimated_unit_price: Math.round(value / qty) };
  return { estimated_quantity: qty > 0 ? qty : null, estimated_unit_price: null };
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Extrae ESPECIFICACIONES GENERALES del texto del objeto (aprox., no oficial):
 * tracción, combustible, carrocería, blindaje, uso y cilindraje. Las specs
 * detalladas viven en los pliegos PDF, fuera de la API de SECOP.
 */
export function extractSpecs(object: string | null | undefined): string[] {
  const t = fold(object ?? '');
  const specs: string[] = [];
  const add = (s: string) => { if (!specs.includes(s)) specs.push(s); };

  // Tracción
  if (/\b4\s*x\s*4\b/.test(t)) add('4x4');
  else if (/\b4\s*x\s*2\b/.test(t)) add('4x2');
  // Combustible / energía
  if (/electric/.test(t)) add('eléctrica');
  if (/hibrid|mhev/.test(t)) add('híbrida');
  if (/diesel/.test(t)) add('diésel');
  if (/gasolina/.test(t)) add('gasolina');
  if (/\bgnv\b|gas natural/.test(t)) add('GNV');
  // Carrocería / tipo
  if (/doble cabina/.test(t)) add('doble cabina');
  if (/platon/.test(t)) add('platón');
  if (/furgon/.test(t)) add('furgón');
  if (/\bvan\b|\bvans\b/.test(t)) add('van');
  if (/microbus/.test(t)) add('microbús');
  if (/\bsuv\b/.test(t)) add('SUV');
  // Blindaje (con nivel si aparece)
  if (/blindad|blindaj/.test(t)) {
    const niv = t.match(/nivel\s+(iii\s*a|iii|iv|ii|i)\b/);
    add(niv ? `blindaje nivel ${niv[1].replace(/\s+/g, '').toUpperCase()}` : 'blindada');
  }
  // Uso institucional
  if (/uniformad/.test(t)) add('uniformada');
  // Cilindraje / motor
  const cc = t.match(/(\d{3,4})\s*cc\b/);
  if (cc) add(`${cc[1]}cc`);
  const lit = t.match(/(\d[.,]\d)\s*(?:l\b|litros)/);
  if (lit) add(`${lit[1].replace(',', '.')}L`);

  return specs;
}
