import type { Classification, ScoreBreakdown } from '../types.js';

export interface ScoreInputs {
  estimatedValue: number | null;
  daysToClose: number | null;
  entityPurchaseFrequency: number; // # de procesos relevantes vistos de la entidad
  classification: Classification;
}

/**
 * Score de oportunidad 0..100 (brief §9). Cuatro componentes ponderados:
 *   valor (30) + urgencia (20) + entidad (25) + confianza de clasificación (15).
 */
export function calculateOpportunityScore(i: ScoreInputs): ScoreBreakdown {
  const value = i.estimatedValue ?? 0;
  const value_score = Math.min((value / 500_000_000) * 30, 30);

  let urgency_score = 10;
  if (i.daysToClose !== null) {
    if (i.daysToClose < 0) urgency_score = 0; // ya cerró
    else if (i.daysToClose < 14) urgency_score = 20;
    else if (i.daysToClose < 30) urgency_score = 15;
    else urgency_score = 10;
  }

  const f = i.entityPurchaseFrequency;
  const entity_score = f > 2 ? 25 : f > 1 ? 15 : 5;

  const confidence_score = i.classification.confidence * 15;

  const total = Math.min(round2(value_score + urgency_score + entity_score + confidence_score), 100);
  return {
    value_score: round2(value_score),
    urgency_score,
    entity_score,
    confidence_score: round2(confidence_score),
    total,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
