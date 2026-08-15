import type { OpportunityResult } from '../types.js';

export interface AlertRule {
  id: string;
  name: string;
  condition: {
    min_value?: number;
    max_days_to_close?: number;
    foton_lines?: string[];
    min_entity_score?: number;
  };
  severity: 'high' | 'medium' | 'low';
}

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: 'high_value', name: 'Oportunidad de alto valor', condition: { min_value: 200_000_000 }, severity: 'high' },
  { id: 'urgent_close', name: 'Cierre urgente (< 14 días)', condition: { max_days_to_close: 14 }, severity: 'high' },
  { id: 'repeated_buyer', name: 'Entidad con historial de compra', condition: { min_entity_score: 15 }, severity: 'medium' },
  { id: 'new_energy_segment', name: 'Segmento NEW ENERGY (estratégico)', condition: { foton_lines: ['NEW_ENERGY', 'NEW_ENERGY_PICKUP'] }, severity: 'high' },
  { id: 'pickup_mhev', name: 'Línea PICKUP MHEV (híbrida)', condition: { foton_lines: ['PICKUP_MHEV'] }, severity: 'medium' },
];

/** Devuelve los ids de reglas que dispara una oportunidad. */
export function evaluateAlerts(opp: OpportunityResult, rules: AlertRule[] = DEFAULT_ALERT_RULES): string[] {
  const fired: string[] = [];
  for (const rule of rules) {
    const c = rule.condition;
    if (c.min_value !== undefined && (opp.estimated_value ?? 0) < c.min_value) continue;
    if (c.max_days_to_close !== undefined && !(opp.days_to_close !== null && opp.days_to_close <= c.max_days_to_close)) continue;
    if (c.foton_lines !== undefined && !c.foton_lines.includes(opp.foton_line)) continue;
    if (c.min_entity_score !== undefined && opp.scoring.entity_score < c.min_entity_score) continue;
    fired.push(rule.id);
  }
  return fired;
}
