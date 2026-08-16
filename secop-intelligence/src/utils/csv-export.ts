import type { OpportunityResult } from '../types.js';

function esc(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Exporta oportunidades a CSV (brief §nice-to-have). */
export function opportunitiesToCsv(opps: OpportunityResult[]): string {
  const headers = [
    'notice_uid', 'entity_name', 'entity_nit', 'department', 'object', 'estimated_value',
    'estimated_quantity', 'estimated_unit_price', 'specs',
    'publication_date', 'closing_date', 'days_to_close', 'foton_line',
    'line_confidence', 'total_score', 'alerts', 'secop_link',
  ];
  const rows = opps.map((o) =>
    [
      o.notice_uid, o.entity_name, o.entity_nit, o.department, o.object, o.estimated_value,
      o.estimated_quantity, o.estimated_unit_price, o.specs.join('|'),
      o.publication_date, o.closing_date, o.days_to_close, o.foton_line,
      o.line_confidence, o.scoring.total, o.alerts.join('|'), o.secop_link,
    ].map(esc).join(','),
  );
  return [headers.join(','), ...rows].join('\n');
}
