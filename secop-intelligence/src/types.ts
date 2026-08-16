// Tipos del Sistema de Inteligencia SECOP.
// Los shapes de Croma están modelados sobre la respuesta REAL de la API
// (verificada en vivo el 2026-08-15) y la referencia oficial de SECOP - Croma API.

// ----------------------------------------------------------------------------
// Líneas de producto Foton
// ----------------------------------------------------------------------------
export type FotonLine =
  | 'NEW_ENERGY_PICKUP'
  | 'PICKUP_MHEV'
  | 'PICKUP'
  | 'LDT'
  | 'HDT'
  | 'NEW_ENERGY'
  | 'AUV_VAN'
  | 'SPECIAL'
  | 'UNKNOWN';

export interface Classification {
  line: FotonLine;
  confidence: number; // 0..1
  matched_on?: string; // término que disparó la clasificación (trazabilidad)
}

// ----------------------------------------------------------------------------
// Croma SECOP — respuestas (campos REALES; los ausentes se normalizan a null)
// ----------------------------------------------------------------------------

/** Resumen ligero devuelto por processes-by-entity. OJO: no trae descripción ni fecha de cierre. */
export interface ProcessSummary {
  notice_uid: string;
  process_id: string | null;
  reference: string | null;
  name: string | null; // a veces es solo un código interno de la entidad
  entity: string | null;
  entity_nit: string | null;
  modality: string | null;
  contract_type: string | null;
  base_price: number | null;
  phase: string | null;
  procedure_status: string | null;
  published_date: string | null; // yyyy-mm-dd
  url: string | null;
}

export interface ProcessesByEntityResponse {
  document_number: string;
  from_date: string | null;
  to_date: string | null;
  count: number;
  capped: boolean;
  processes: ProcessSummary[];
  pagination: Pagination;
}

export interface Pagination {
  total: number;
  page_size: number;
  total_pages: number;
  page: number;
}

/** Encabezado completo de un proceso (secop_process). Incluye descripción y cierre. */
export interface ProcessHeader {
  process_id?: string | null;
  portfolio_id?: string | null;
  reference?: string | null;
  name?: string | null;
  description?: string | null;
  entity?: string | null;
  entity_nit?: string | null;
  entity_department?: string | null;
  entity_city?: string | null;
  entity_order?: string | null;
  modality?: string | null;
  contract_type?: string | null;
  contract_subtype?: string | null;
  unspsc_code?: string | null;
  base_price?: number | null;
  phase?: string | null;
  procedure_status?: string | null;
  published_date?: string | null;
  last_published_date?: string | null;
  bid_deadline?: string | null; // fecha límite de recepción de ofertas
  awarded?: boolean | null;
  awarded_value?: number | null;
  award_count?: number | null;
  award_date?: string | null;
  contract_count?: number | null;
  url?: string | null;
  [k: string]: unknown;
}

export interface Award {
  provider?: string | null;
  provider_nit?: string | null;
  provider_code?: string | null;
  provider_department?: string | null;
  provider_city?: string | null;
  awarded_value?: number | null;
  award_date?: string | null;
}

export interface Contract {
  contract_id?: string | null;
  reference?: string | null;
  entity?: string | null;
  entity_nit?: string | null;
  provider?: string | null;
  provider_document?: string | null;
  provider_document_type?: string | null;
  is_sme?: boolean | null;
  is_group?: boolean | null;
  legal_rep_name?: string | null;
  status?: string | null;
  contract_type?: string | null;
  object?: string | null;
  modality?: string | null;
  value?: number | null;
  invoiced_value?: number | null;
  paid_value?: number | null;
  pending_execution_value?: number | null;
  pending_payment_value?: number | null;
  sign_date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  added_days?: number | null;
  duration?: number | null;
  [k: string]: unknown;
}

export interface ProcessResponse {
  found: boolean;
  notice_uid: string;
  process: ProcessHeader | null;
  awards: Award[];
  contracts: Contract[];
}

export interface ContractAddition {
  addition_id?: string | null;
  type?: string | null;
  description?: string | null;
  registered_date?: string | null;
}

export interface ContractGuarantee {
  insurer?: string | null;
  policy_number?: string | null;
  status?: string | null;
  policy_type?: string | null;
  value?: number | null;
  policy_end_date?: string | null;
}

export interface ExecutionItem {
  execution_type?: string | null;
  plan_name?: string | null;
  expected_delivery_date?: string | null;
  expected_progress_percent?: number | null;
  actual_delivery_date?: string | null;
  actual_progress_percent?: number | null;
  contract_status?: string | null;
}

export interface ContractResponse {
  found: boolean;
  contract_id: string;
  contract: Contract | null;
  additions: ContractAddition[];
  additions_capped: boolean;
  guarantees: ContractGuarantee[];
  guarantees_capped: boolean;
  execution_items: ExecutionItem[];
  execution_items_capped: boolean;
}

export interface Sanction {
  entity?: string | null;
  entity_nit?: string | null;
  resolution_number?: string | null;
  provider?: string | null;
  contract_number?: string | null;
  sanction_value?: number | null;
  published_date?: string | null;
  final_date?: string | null;
  url?: string | null;
}

export interface SanctionsResponse {
  document_number: string;
  count: number;
  capped: boolean;
  sanctions: Sanction[];
}

export interface ContractsByProviderResponse {
  document_number: string;
  entity_nit: string | null;
  from_date: string | null;
  to_date: string | null;
  count: number;
  capped: boolean;
  contracts: Contract[];
  pagination: Pagination;
}

// ----------------------------------------------------------------------------
// Dominio: oportunidades, scoring, alertas
// ----------------------------------------------------------------------------
export interface ScoreBreakdown {
  value_score: number; // 0..30
  urgency_score: number; // 0..20
  entity_score: number; // 0..25
  confidence_score: number; // 0..15
  total: number; // 0..100
}

export interface OpportunityResult {
  notice_uid: string;
  entity_name: string | null;
  entity_nit: string | null;
  department: string | null; // departamento de la entidad (para filtro geográfico)
  city: string | null;
  object: string; // descripción usada para clasificar
  estimated_value: number | null;
  publication_date: string | null;
  closing_date: string | null;
  days_to_close: number | null;
  foton_line: FotonLine;
  line_confidence: number;
  estimated_quantity: number | null; // cantidad estimada del texto (aprox., no oficial)
  estimated_unit_price: number | null; // valor estimado / cantidad
  specs: string[]; // especificaciones generales del texto (aprox., no oficial)
  scoring: ScoreBreakdown;
  alerts: string[];
  secop_link: string | null;
}

/** Contrato del competidor con cantidad/precio unitario ESTIMADOS del texto del objeto (aprox., no oficial). */
export interface CompetitorContract {
  contract_id: string | null;
  object: string | null;
  entity: string | null;
  entity_nit: string | null;
  value: number | null;
  line: FotonLine;
  sign_date: string | null;
  status: string | null;
  estimated_quantity: number | null;
  estimated_unit_price: number | null;
  specs: string[];
}

export interface CompetitorAnalysis {
  competitor_nit: string;
  competitor_name: string | null;
  period: { from_date: string | null; to_date: string | null };
  filters: {
    line: string | null;
    entity_nit: string | null;
    min_value: number | null;
    keyword: string | null;
  };
  statistics: {
    total_contracts: number;
    total_value: number;
    average_contract_value: number;
    price_gap: number | null;
  };
  by_line: Record<string, { contracts_won: number; total_value: number; average_price: number }>;
  top_entities: { entity: string | null; entity_nit: string | null; contracts: number; value: number }[];
  contracts: CompetitorContract[];
  sanctions_count: number;
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface ContractTracking {
  contract_id: string;
  found: boolean;
  entity: string | null;
  value: number | null;
  estimated_process_value: number | null; // base_price del proceso (valor estimado)
  price_gap: number | null; // (valor_contrato − estimado) / estimado; negativo = bajo el estimado
  status: {
    contract_status: string | null;
    execution_percentage: number | null;
    planned_end_date: string | null;
    actual_end_date: string | null;
    is_delayed: boolean;
  };
  alerts: {
    has_sanctions: boolean;
    modifications_count: number;
    has_delays: boolean;
    has_active_guarantee: boolean;
  };
  additions: ContractAddition[];
  guarantees: ContractGuarantee[];
  execution_items: ExecutionItem[];
  health_score: number; // 0..100
}
