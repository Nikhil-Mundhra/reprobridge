export interface Obligation {
  id: string;
  patient_id: string;
  patient_name: string;
  life_stage: string;
  title: string;
  rationale: string;
  evidence_source: string;
  rule_version: string;
  owner: string;
  status: string;
  priority: string;
  parent_obligation_id?: string | null;
  trigger_event_date?: string | null;
  due_window_start?: string | null;
  due_window_end?: string | null;
  due_label?: string | null;
  closure_policy?: string | null;
  protocol_code?: string | null;
  source_quote?: string | null;
  source_note_date?: string | null;
  source_facility?: string | null;
  source_doc_id?: string | null;
  review_state?: string | null;
  relevance_confirmed_by?: string | null;
  dismissed_by?: string | null;
  dismissed_reason?: string | null;
  reopened_by?: string | null;
  reopened_reason?: string | null;
  days_remaining?: number | null;
  verified_by: string | null;
  closure_evidence: string | null;
}

export interface AuditEvent {
  id: number;
  obligation_id: string | null;
  event_type: string;
  actor: string;
  summary: string;
  created_at: string;
}

export interface TraceStep {
  node: string;
  execution?: "deterministic" | "agentic" | "deterministic_fallback";
  phi_exposed?: boolean;
  detail: string;
}

export interface PrivacyReport {
  payload: Record<string, unknown>;
  redacted_fields: string[];
  permitted_fields: string[];
  phi_check_passed: boolean;
}

export interface AiMetadata {
  mode: string;
  provider: string;
  model: string;
  fallback_reason: string | null;
}

export interface ClinicalEvidence {
  id: string;
  obligation_id: string;
  fhir_resource_type: string;
  code_display: string;
  result_value: string;
  reference_range: string | null;
  source_facility: string;
  accession_id: string;
  clinician_suggestion: string;
  summary_note: string;
  evidence_date?: string | null;
  status?: string | null;
  recorded_at: string;
}

export interface ParsedImportRow {
  title: string;
  rationale: string;
  priority: string;
  life_stage: string;
  owner: string;
  evidence_source: string;
  incoming_evidence_result?: string;
}

export interface HealthResponse {
  status: string;
  residency_policy?: string;
  ai_provider?: {
    provider: string;
    configured: boolean;
    model: string;
  };
  database: {
    provider: string;
    connected: boolean;
    branch?: string;
    pooled?: boolean;
    detail: string;
  };
}

export interface PrototypeDemoProps {
  onBackToTutorial: () => void;
  initialPatientId?: string;
  initialReconciliation?: ReconciledClinicalContext | null;
  initialTransitionResult?: ReconciliationTransitionSeed | null;
  onOpenPatientSearch?: () => void;
}

export interface FacilityStage {
  stageIndex: 0 | 1 | 2;
  dayTag: string;
  facility: string;
  emrSystem: string;
}

export interface SafetyBlockInfo {
  detail: string;
  status: number;
  ruleVersion: string;
}

export interface PatientCohortSummary {
  patient_id: string;
  patient_name: string;
  age_sex: string;
  clinical_track: string;
  facility_a: string;
  facility_b: string;
  life_stage: string;
  total_obligations: number;
  open_count: number;
  urgent_count: number;
  deferred_count: number;
  closed_count: number;
}

export interface CohortTotals {
  total_patients: number;
  total_open: number;
  total_urgent: number;
  total_deferred: number;
  total_closed: number;
}

export interface ExplanationFieldVerification {
  verified: boolean;
  checked_fields: string[];
  discrepancies: string[];
  authoritative_snapshot: {
    status: string;
    owner: string;
    days_remaining: number | null;
    closure_policy: string;
  };
}

export interface ObligationExplanationResponse {
  obligation_id: string;
  headline: string;
  explanation: string;
  key_points: string[];
  disclaimer: string;
  ai_metadata: AiMetadata;
  privacy_report: PrivacyReport;
  field_verification?: ExplanationFieldVerification;
  audit_events?: AuditEvent[];
}

export interface ReconciliationQuestion {
  id: string;
  category: string;
  question: string;
  data_shows: string;
  options: string[];
  placeholder: string;
}

export interface ReconciliationQuestionnaireResponse {
  patient_id: string;
  context_note: string;
  questions: ReconciliationQuestion[];
  disclaimer: string;
  ai_metadata: AiMetadata;
  privacy_report: PrivacyReport;
}

export interface ReconciledClinicalContext {
  patient_id: string;
  reconciled_stage: string;
  pregnancy_stage_answer: string;
  medications_answer: string;
  scenario_answer: string;
  additional_info: string;
  clinician_name: string;
  reconciled_at: string;
  transition_triggered: string | null;
}

export interface ReconciliationTransitionSeed {
  event_type: string;
  agent_summary: string;
  specialist_handoff: string;
  ai_metadata: AiMetadata;
  privacy_report: PrivacyReport;
  trace: TraceStep[];
  obligations: Obligation[];
  audit_events: AuditEvent[];
  patients?: PatientCohortSummary[];
  cohort_totals?: CohortTotals;
}

export interface ReconciliationOnboardingResult {
  patientId: string;
  reconciliation: ReconciledClinicalContext;
  transitionResult?: ReconciliationTransitionSeed | null;
}

export interface ObligationPassport {
  protocol: string;
  credential_type:
    | "ReproBridgeObligationPassport"
    | "ReproBridgeClosureAttestation"
    | "ReproBridgeReopenAttestation"
    | string;
  residency_policy: string;
  zero_hospital_sharing: boolean;
  issuer: string;
  issued_at: string;
  claims: {
    obligation_id: string;
    case_token: string;
    life_stage: string;
    clinical_category: string;
    rule_version: string;
    status: string;
    priority: string;
    closure_policy: string;
    review_state: string;
    owner_role: string;
    days_remaining?: number | null;
    due_label?: string | null;
    source_note_sha256: string;
    raw_chart_bytes_shared: number;
    source_quote_excerpt?: string;
    reopen_reason_excerpt?: string;
  };
  signature: {
    alg: string;
    key_id: string;
    value: string;
  };
  smart_health_link: string;
}

export interface PassportVerificationResult {
  valid: boolean;
  tampered: boolean;
  verification_mode: string;
  hospital_a_api_calls: number;
  raw_chart_exposed: boolean;
  detail: string;
  verified_claims: ObligationPassport["claims"] | null;
}
