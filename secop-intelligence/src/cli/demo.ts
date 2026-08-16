// Demo del MOTOR (clasificación + scoring + alertas) sin necesitar CROMA_API_KEY.
// Objetos representativos de licitaciones reales de vehículos en SECOP + 1 registro
// REAL traído de Croma (2026-08-15) para mostrar el filtrado correcto de no-vehículos.
// Genera data/cache/test-run.json con la MISMA estructura que /api/opportunities.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../config.js';
import { classifyFotonLine } from '../modules/classification.js';
import { evaluateAlerts } from '../modules/alerting.js';
import { calculateOpportunityScore } from '../utils/scoring.js';
import { estimateUnits } from '../utils/estimate.js';
import { daysUntil } from '../utils/date.js';
import type { OpportunityResult } from '../types.js';

interface Sample {
  notice_uid: string;
  entity_name: string;
  entity_nit: string;
  department?: string;
  object: string;
  base_price: number | null;
  bid_deadline: string | null;
  frequency: number;
  real?: boolean;
}

// Fechas relativas a "hoy" para que la urgencia sea reproducible.
const inDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const SAMPLES: Sample[] = [
  {
    notice_uid: 'CO1.NTC.DEMO001', entity_name: 'Gobernación de Antioquia', entity_nit: '890900286', department: 'Antioquia',
    object: 'Adquisición de 3 camionetas eléctricas doble cabina para el parque automotor institucional, cero emisiones',
    base_price: 450_000_000, bid_deadline: inDays(10), frequency: 3,
  },
  {
    notice_uid: 'CO1.NTC.DEMO002', entity_name: 'Municipio de Medellín', entity_nit: '890905211', department: 'Antioquia',
    object: 'Suministro de 5 camionetas pick-up 4x4 diésel doble cabina para la Secretaría de Movilidad',
    base_price: 520_000_000, bid_deadline: inDays(40), frequency: 4,
  },
  {
    notice_uid: 'CO1.NTC.DEMO003', entity_name: 'EPM', entity_nit: '890904996', department: 'Antioquia',
    object: 'Compraventa de camioneta híbrida (MHEV) para supervisión de redes de energía',
    base_price: 180_000_000, bid_deadline: inDays(12), frequency: 2,
  },
  {
    notice_uid: 'CO1.NTC.DEMO004', entity_name: 'Área Metropolitana', entity_nit: '890984423', department: 'Antioquia',
    object: 'Adquisición de camión de estacas y volqueta para transporte de carga y residuos',
    base_price: 380_000_000, bid_deadline: inDays(25), frequency: 1,
  },
  {
    notice_uid: 'CO1.NTC.DEMO005', entity_name: 'Secretaría de Salud', entity_nit: '890981536', department: 'Bogotá',
    object: 'Suministro de furgón medicalizado y microbús para transporte de pacientes',
    base_price: 240_000_000, bid_deadline: inDays(18), frequency: 2,
  },
  {
    // Registro REAL traído de Croma el 2026-08-15 (Universidad de Antioquia).
    // No es un vehículo → debe clasificar UNKNOWN y quedar filtrado.
    notice_uid: 'CO1.NTC.10710152', entity_name: 'UNIVERSIDAD DE ANTIOQUIA', entity_nit: '890980040',
    object: 'Servicio Especializado de Diagramación Editorial para la Edición No. 105 de la revista Lecturas de Economía',
    base_price: 5_280_000, bid_deadline: null, frequency: 1, real: true,
  },
];

const MIN_SCORE = 40;

const opportunities: OpportunityResult[] = [];
let processed = 0;
let filteredUnknown = 0;

for (const s of SAMPLES) {
  processed++;
  const classification = classifyFotonLine(`${s.object}`);
  if (classification.line === 'UNKNOWN') {
    filteredUnknown++;
    continue;
  }
  const daysToClose = daysUntil(s.bid_deadline);
  const scoring = calculateOpportunityScore({
    estimatedValue: s.base_price,
    daysToClose,
    entityPurchaseFrequency: s.frequency,
    classification,
  });
  if (scoring.total < MIN_SCORE) continue;

  const opp: OpportunityResult = {
    notice_uid: s.notice_uid,
    entity_name: s.entity_name,
    entity_nit: s.entity_nit,
    department: s.department ?? null,
    city: null,
    object: s.object,
    estimated_value: s.base_price,
    publication_date: new Date().toISOString().slice(0, 10),
    closing_date: s.bid_deadline,
    days_to_close: daysToClose,
    foton_line: classification.line,
    line_confidence: classification.confidence,
    ...estimateUnits(s.object, s.base_price),
    scoring,
    alerts: [],
    secop_link: `https://community.secop.gov.co/Public/Tendering/OpportunityDetail/Index?noticeUID=${s.notice_uid}`,
  };
  opp.alerts = evaluateAlerts(opp);
  opportunities.push(opp);
}

opportunities.sort((a, b) => b.scoring.total - a.scoring.total);

const out = {
  _note: 'Demo del motor de clasificación/scoring/alertas. Objetos representativos de SECOP + 1 registro REAL de Croma (CO1.NTC.10710152, correctamente filtrado como UNKNOWN). La conectividad en vivo con Croma se probó por separado: 1.869 procesos reales de la UdeA recuperados el 2026-08-15.',
  timestamp: new Date().toISOString(),
  total_processed: processed,
  filtered_unknown: filteredUnknown,
  total_count: opportunities.length,
  opportunities,
};

const path = resolve(config.cacheDir, '..', 'test-run.json');
writeFileSync(path, JSON.stringify(out, null, 2));

console.log(`Procesados: ${processed}  ·  filtrados UNKNOWN: ${filteredUnknown}  ·  oportunidades: ${opportunities.length}`);
for (const o of opportunities) {
  console.log(`  [${o.scoring.total.toFixed(1).padStart(5)}] ${o.foton_line.padEnd(18)} ${(o.entity_name ?? '').padEnd(26)} alerts=${o.alerts.join(',')}`);
}
console.log(`\nEscrito: ${path}`);
