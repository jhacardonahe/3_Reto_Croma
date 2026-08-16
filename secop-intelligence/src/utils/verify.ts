// Guard de citas determinista. Corre ANTES de emitir una oportunidad.
//
// Por qué existe en código y no en un prompt: el reto premia que Croma sea el
// MOTOR de datos, no un adorno. Si "cada dato viene de Croma" vive solo en la
// confianza, es una moneda al aire. Acá es mecánico: cada afirmación autoritativa
// de la oportunidad (valor, NIT, fechas, notice_uid) se compara contra el payload
// CRUDO que devolvió Croma para ese proceso. Cero llamadas a modelo.
//
// Qué NO verifica: los campos marcados "aprox., no oficial" (cantidad estimada,
// precio unitario, specs del texto). Esos son estimaciones derivadas del objeto,
// no hechos de Croma; el UI ya los rotula como aproximados y el guard no los toca.
// Es la misma distinción de agentsprint: lo que se afirma del mundo se cita; lo
// que se estima se rotula como estimación.

const TOLERANCIA = 0.02; // 2%: cubre redondeos de valor de catálogo/base_price.

export type CheckStatus = 'confirmed' | 'mismatch' | 'unverifiable';

export interface VerifyCheck {
  field: string; // clave técnica, p.ej. 'estimated_value'
  label: string; // etiqueta legible en español
  claimed: string | number | null; // lo que la oportunidad afirma
  source: string | number | null; // lo que trae la evidencia de Croma
  status: CheckStatus;
}

export interface Verification {
  ok: boolean;
  checked: number; // # de afirmaciones verificables (claim no nulo)
  confirmed: number; // # confirmadas contra Croma
  detail: string; // resumen legible en español
  checks: VerifyCheck[];
  source_ref: string | null; // notice_uid que ancla la cita
  source_url: string | null; // enlace SECOP a la fuente
}

/** Evidencia CRUDA de Croma para un proceso (campos ya resueltos de summary + header). */
export interface OpportunityEvidence {
  notice_uid: string | null;
  base_price?: number | null;
  entity_nit?: string | null;
  bid_deadline?: string | null;
  published_date?: string | null;
  url?: string | null;
}

/** Lo mínimo que el guard necesita leer de una oportunidad (subconjunto de OpportunityResult). */
export interface OpportunityClaims {
  notice_uid: string;
  entity_nit: string | null;
  estimated_value: number | null;
  closing_date: string | null;
  publication_date: string | null;
  secop_link: string | null;
}

function numMatch(a: number, b: number): boolean {
  if (a === b) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return true;
  return Math.abs(a - b) / base <= TOLERANCIA;
}

function strMatch(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/**
 * Verifica una oportunidad contra la evidencia cruda de Croma.
 *
 * Regla dura (agentsprint AGENTS.md #1): una afirmación con valor no nulo cuya
 * fuente Croma es nula es un `mismatch` — se afirma algo que Croma no respalda.
 * Un `claim` nulo simplemente no se verifica (no se afirma nada).
 */
export function verifyOpportunity(opp: OpportunityClaims, ev: OpportunityEvidence): Verification {
  const checks: VerifyCheck[] = [];

  const push = (
    field: string,
    label: string,
    claimed: string | number | null,
    source: string | number | null,
    matched: (c: number | string, s: number | string) => boolean,
  ) => {
    let status: CheckStatus;
    if (claimed == null) status = 'unverifiable'; // no se afirma nada
    else if (source == null) status = 'mismatch'; // se afirma algo sin respaldo en Croma
    else status = matched(claimed, source) ? 'confirmed' : 'mismatch';
    checks.push({ field, label, claimed, source, status });
  };

  const numCmp = (c: number | string, s: number | string) => numMatch(Number(c), Number(s));
  const strCmp = (c: number | string, s: number | string) => strMatch(String(c), String(s));

  // Ancla: el notice_uid de la oportunidad DEBE ser el de la evidencia de Croma.
  push('notice_uid', 'Proceso (notice_uid)', opp.notice_uid, ev.notice_uid ?? null, strCmp);
  push('entity_nit', 'NIT de la entidad', opp.entity_nit, ev.entity_nit ?? null, strCmp);
  push('estimated_value', 'Valor estimado', opp.estimated_value, ev.base_price ?? null, numCmp);
  push('closing_date', 'Fecha de cierre', opp.closing_date, ev.bid_deadline ?? null, strCmp);
  push('publication_date', 'Fecha de publicación', opp.publication_date, ev.published_date ?? null, strCmp);

  const verificables = checks.filter((c) => c.status !== 'unverifiable');
  const confirmed = verificables.filter((c) => c.status === 'confirmed').length;
  const checked = verificables.length;
  const mismatches = verificables.filter((c) => c.status === 'mismatch');

  // El ancla es obligatoria: sin notice_uid confirmado no hay cita que valga.
  const anclaOk = checks.find((c) => c.field === 'notice_uid')?.status === 'confirmed';
  const ok = anclaOk && mismatches.length === 0 && checked > 0;

  let detail: string;
  if (!anclaOk) {
    detail = 'Sin ancla: el proceso no coincide con la evidencia de Croma.';
  } else if (mismatches.length > 0) {
    const campos = mismatches.map((c) => c.label).join(', ');
    detail = `${confirmed}/${checked} confirmados contra Croma · sin respaldo: ${campos}`;
  } else {
    detail = `${confirmed}/${checked} datos confirmados contra Croma`;
  }

  return {
    ok,
    checked,
    confirmed,
    detail,
    checks,
    source_ref: ev.notice_uid ?? null,
    source_url: opp.secop_link ?? ev.url ?? null,
  };
}

// ----------------------------------------------------------------------------
// Guard de agregados para el análisis de competidor.
//
// Aquí la afirmación no es "este valor está en Croma" sino "este AGREGADO
// (total_value, total_contracts, promedio) resume correctamente los contratos
// CRUDOS de Croma, y cada peso viene de un contrato con `contract_id` citable".
// Es la distinción de agentsprint: los números CALCULADOS se validan contra la
// salida de la herramienta, no contra el modelo. Recomponemos la suma nosotros
// mismos — si el agregado mostrado no cuadra con el recálculo, hay un bug y el
// guard lo canta. Y si algún contrato no trae `contract_id`, su valor entra al
// total sin fuente citable → se reporta como no anclado.
// ----------------------------------------------------------------------------

export interface AggregateVerification {
  ok: boolean;
  checked: number;
  confirmed: number;
  detail: string;
  checks: VerifyCheck[];
  anchored: number; // contratos con contract_id (fuente citable)
  total: number; // contratos contados
  source_refs: string[]; // muestra de contract_id que respaldan el agregado
}

export interface CompetitorClaims {
  total_value: number;
  total_contracts: number;
  average_contract_value: number;
  contracts: { contract_id: string | null; value: number | null }[]; // evidencia cruda de Croma
}

export function verifyCompetitor(claims: CompetitorClaims): AggregateVerification {
  const { contracts } = claims;
  const total = contracts.length;
  const anchored = contracts.filter((c) => c.contract_id != null && String(c.contract_id).trim() !== '').length;
  const recomputedSum = contracts.reduce((a, c) => a + (c.value ?? 0), 0);
  const recomputedAvg = total ? Math.round(recomputedSum / total) : 0;

  const checks: VerifyCheck[] = [
    {
      field: 'total_contracts',
      label: 'N.º de contratos',
      claimed: claims.total_contracts,
      source: total,
      status: claims.total_contracts === total ? 'confirmed' : 'mismatch',
    },
    {
      field: 'total_value',
      label: 'Valor total (suma)',
      claimed: claims.total_value,
      source: recomputedSum,
      status: numMatch(claims.total_value, recomputedSum) ? 'confirmed' : 'mismatch',
    },
    {
      field: 'average_contract_value',
      label: 'Valor promedio',
      claimed: claims.average_contract_value,
      source: recomputedAvg,
      status: numMatch(claims.average_contract_value, recomputedAvg) ? 'confirmed' : 'mismatch',
    },
    {
      field: 'anchoring',
      label: 'Contratos con ID Croma',
      claimed: total,
      source: anchored,
      status: anchored === total ? 'confirmed' : 'mismatch',
    },
  ];

  const confirmed = checks.filter((c) => c.status === 'confirmed').length;
  const checked = checks.length;
  const ok = confirmed === checked;

  let detail: string;
  if (total === 0) {
    detail = 'Sin contratos de Croma para este competidor con esos filtros.';
  } else if (ok) {
    detail = `${total} contratos citados (${anchored}/${total} con ID Croma) · suma verificada`;
  } else {
    const fallos = checks.filter((c) => c.status !== 'confirmed').map((c) => c.label).join(', ');
    detail = `${confirmed}/${checked} verificados · discrepancia: ${fallos}`;
  }

  const source_refs = contracts
    .map((c) => c.contract_id)
    .filter((id): id is string => id != null && String(id).trim() !== '')
    .slice(0, 5);

  return { ok, checked, confirmed, detail, checks, anchored, total, source_refs };
}
