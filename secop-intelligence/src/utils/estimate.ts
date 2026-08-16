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
