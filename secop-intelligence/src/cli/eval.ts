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
import { verifyOpportunity } from '../utils/verify.js';

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
type Case = ClassifyCase | GuardCase;

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
    const r = c.kind === 'classify' ? runClassify(c) : runGuard(c);
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
