// Harness de evaluación del NÚCLEO determinista (clasificador + guard de citas).
//
// Por qué vale: casi ningún equipo de hackathon lleva evaluación. Correrla en vivo
// convierte "confíen en nosotros" en "mírenlo ustedes". Corre OFFLINE (sin
// CROMA_API_KEY) porque prueba la lógica determinista, no la red — igual que el
// harness de agentsprint, que inyecta el `responder` para probarse sin API key.
//
// Sale con código != 0 si algún caso falla → sirve de GATE antes de desplegar.
//
//   npm run eval
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyFotonLine } from '../modules/classification.js';
import { diffOpportunities, type SeenMap } from '../modules/seen.js';
import { fingerprint } from '../modules/seen.js';
import { buildDigest } from '../notify/digest.js';
import { verifyOpportunity } from '../utils/verify.js';
import type { MonitorRun } from '../modules/monitoring.js';
import type { Novelty } from '../modules/seen.js';
import type { OpportunityResult } from '../types.js';

interface ClassifyCase {
  id: string;
  kind: 'classify';
  object: string;
  expect_line: string;
  trap?: boolean;
  nota?: string;
}
interface GuardCase {
  id: string;
  kind: 'guard';
  claim_value: number;
  croma_value: number | null;
  expect_ok: boolean;
  trap?: boolean;
  nota?: string;
}
/** Estado del proceso tal como lo publica Croma, para las huellas de la memoria. */
interface StateSnapshot {
  phase: string;
  procedure_status: string;
  estimated_value: number | null;
  closing_date: string | null;
  days_to_close: number | null;
}
interface NoveltyCase {
  id: string;
  kind: 'novelty';
  prev: StateSnapshot | null;
  curr: StateSnapshot;
  expect: Novelty;
  trap?: boolean;
  nota?: string;
}
interface DigestCase {
  id: string;
  kind: 'digest';
  states: Novelty[];
  object?: string;
  expect_silence: boolean;
  expect_contains?: string[];
  expect_absent?: string[];
  trap?: boolean;
  nota?: string;
}
type Case = ClassifyCase | GuardCase | NoveltyCase | DigestCase;

/**
 * Oportunidad sintética con la forma real de `OpportunityResult`. El score se deriva
 * de los días para cierre a propósito: así el caso trampa "solo pasa el tiempo" mueve
 * score Y días, y comprueba que la huella de la memoria ignora ambos.
 */
function fakeOpportunity(state: StateSnapshot, index = 1, object = 'Camioneta 4x4 doble cabina'): OpportunityResult {
  const uid = `CO1.NTC.EVAL00${index}`;
  return {
    notice_uid: uid,
    entity_name: 'Entidad de prueba',
    entity_nit: '800141397',
    department: 'Bogotá',
    city: null,
    object,
    estimated_value: state.estimated_value,
    publication_date: '2026-08-01',
    closing_date: state.closing_date,
    days_to_close: state.days_to_close,
    foton_line: 'PICKUP',
    line_confidence: 0.9,
    estimated_quantity: null,
    estimated_unit_price: null,
    specs: [],
    scoring: {
      value_score: 30,
      urgency_score: (state.days_to_close ?? 0) < 14 ? 20 : 10,
      entity_score: 25,
      confidence_score: 13.5,
      total: (state.days_to_close ?? 0) < 14 ? 88.5 : 78.5,
    },
    alerts: [],
    secop_link: `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${uid}`,
    phase: state.phase,
    procedure_status: state.procedure_status,
    verification: verifyOpportunity(
      {
        notice_uid: uid,
        entity_nit: '800141397',
        estimated_value: state.estimated_value,
        closing_date: state.closing_date,
        publication_date: '2026-08-01',
        secop_link: null,
      },
      {
        notice_uid: uid,
        base_price: state.estimated_value,
        entity_nit: '800141397',
        bid_deadline: state.closing_date,
        published_date: '2026-08-01',
        url: null,
      },
    ),
  };
}

function runNovelty(c: NoveltyCase): { pass: boolean; got: string; detail: string } {
  const seen: SeenMap = {};
  if (c.prev) {
    const before = fakeOpportunity(c.prev);
    seen[before.notice_uid] = {
      hash: fingerprint(before),
      first_seen: '2026-08-01T00:00:00.000Z',
      last_seen: '2026-08-01T00:00:00.000Z',
      last_score: before.scoring.total,
    };
  }
  const current = fakeOpportunity(c.curr);
  const got = diffOpportunities([current], seen, new Date('2026-08-18T12:00:00.000Z')).novelty[current.notice_uid];
  return { pass: got === c.expect, got, detail: `esperado ${c.expect}, obtenido ${got}` };
}

function runDigest(c: DigestCase): { pass: boolean; got: string; detail: string } {
  const opportunities = c.states.map((_, i) => fakeOpportunity(
    { phase: 'Presentación de oferta', procedure_status: 'Convocado', estimated_value: 500_000_000, closing_date: '2026-09-10', days_to_close: 20 },
    i + 1,
    c.object,
  ));
  const novelty: Record<string, Novelty> = {};
  opportunities.forEach((o, i) => { novelty[o.notice_uid] = c.states[i]; });

  const run: MonitorRun = {
    timestamp: '2026-08-18T12:00:00.000Z',
    from_date: '2026-08-11',
    entities_scanned: 6,
    total_processed: 500,
    total_prefiltered: 40,
    detail_lookups: 40,
    failed_lookups: 0,
    opportunities,
  };
  const digest = buildDigest({ run, novelty, limit: 5, dashboardUrl: null });

  if (c.expect_silence) {
    return { pass: digest === null, got: digest === null ? 'silencio' : 'habló', detail: digest === null ? 'sin novedades → null' : 'emitió mensaje sin novedades' };
  }
  if (!digest) return { pass: false, got: 'silencio', detail: 'esperaba mensaje y no lo hubo' };

  const missing = (c.expect_contains ?? []).filter((needle) => !digest.html.includes(needle));
  const leaked = (c.expect_absent ?? []).filter((needle) => digest.html.includes(needle));
  const pass = missing.length === 0 && leaked.length === 0;
  const problems = [
    missing.length ? `falta: ${missing.join(', ')}` : '',
    leaked.length ? `sin escapar: ${leaked.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  return { pass, got: `${digest.count} novedad(es)`, detail: pass ? `mensaje con ${digest.count} novedad(es), citas OK` : problems };
}

const C = { ok: '\x1b[92m', bad: '\x1b[91m', dim: '\x1b[90m', trap: '\x1b[95m', reset: '\x1b[0m' };

function runClassify(c: ClassifyCase): { pass: boolean; got: string; detail: string } {
  const got = classifyFotonLine(c.object).line;
  return { pass: got === c.expect_line, got, detail: `esperado ${c.expect_line}, obtenido ${got}` };
}

function runGuard(c: GuardCase): { pass: boolean; got: string; detail: string } {
  const v = verifyOpportunity(
    { notice_uid: 'A', entity_nit: '1', estimated_value: c.claim_value, closing_date: null, publication_date: null, secop_link: null },
    { notice_uid: 'A', base_price: c.croma_value, entity_nit: '1' },
  );
  return { pass: v.ok === c.expect_ok, got: `ok=${v.ok}`, detail: v.detail };
}

function main(): number {
  const path = resolve(process.cwd(), 'data/golden.json');
  const doc = JSON.parse(readFileSync(path, 'utf8')) as { cases: Case[] };
  const cases = doc.cases;

  let passed = 0;
  let failedTraps = 0;
  const failures: string[] = [];

  console.log(`\nEval del núcleo determinista · ${cases.length} casos · ${path}\n`);
  for (const c of cases) {
    const r =
      c.kind === 'classify' ? runClassify(c)
      : c.kind === 'guard' ? runGuard(c)
      : c.kind === 'novelty' ? runNovelty(c)
      : runDigest(c);
    const isTrap = 'trap' in c && c.trap;
    const mark = r.pass ? `${C.ok}PASA${C.reset}` : `${C.bad}FALLA${C.reset}`;
    const tag = isTrap ? `${C.trap}[trampa]${C.reset} ` : '';
    console.log(`  ${mark}  ${c.id.padEnd(28)} ${tag}${C.dim}${r.detail}${C.reset}`);
    if (r.pass) passed++;
    else {
      failures.push(c.id);
      if (isTrap) failedTraps++;
    }
  }

  const total = cases.length;
  console.log('\n' + '─'.repeat(64));
  console.log(`Resultado: ${passed}/${total} pasan` + (failures.length ? `  ·  fallan: ${failures.join(', ')}` : ''));
  if (failedTraps > 0) {
    console.log(`${C.bad}⚠ ${failedTraps} TRAMPA(S) NO DETECTADA(S): el sistema afirmaría algo que no debe.${C.reset}`);
  }
  const ok = passed === total;
  console.log(ok ? `${C.ok}VEREDICTO: núcleo LISTO${C.reset}\n` : `${C.bad}VEREDICTO: ${total - passed} caso(s) con falla${C.reset}\n`);
  return ok ? 0 : 1;
}

process.exit(main());
