import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Baby,
  CheckCircle2,
  ClipboardList,
  Code2,
  Cpu,
  Database,
  Eye,
  FileCheck2,
  GitBranch,
  Lock,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";

interface Obligation {
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
  verified_by: string | null;
  closure_evidence: string | null;
}

interface AuditEvent {
  id: number;
  obligation_id: string | null;
  event_type: string;
  actor: string;
  summary: string;
  created_at: string;
}

interface TraceStep {
  node: string;
  execution?: "deterministic" | "agentic" | "deterministic_fallback";
  phi_exposed?: boolean;
  detail: string;
}

interface PrivacyReport {
  payload: Record<string, unknown>;
  redacted_fields: string[];
  permitted_fields: string[];
  phi_check_passed: boolean;
}

interface AiMetadata {
  mode: string;
  provider: string;
  model: string;
  fallback_reason: string | null;
}

interface HealthResponse {
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

interface PrototypeDemoProps {
  onBackToTutorial: () => void;
}

const FLOW_STEPS = [
  { step: 1, label: "Clinical Finding", desc: "FHIR / Malaffi HIE intake" },
  { step: 2, label: "Care-Gap Detection", desc: "Deterministic clinical rules" },
  { step: 3, label: "Obligation Passport", desc: "Auditable longitudinal record" },
  { step: 4, label: "Life-Stage Transition", desc: "Pregnancy & Postpartum events" },
  { step: 5, label: "UAE Firewall + AI", desc: "De-identified OpenRouter brief" },
  { step: 6, label: "Verified Closure", desc: "Clinician evidence sign-off" },
];

const DEFAULT_CLOSURE_EVIDENCE: Record<string, { clinician: string; evidence: string }> = {
  "OBL-101": {
    clinician: "Dr. Layla Al-Hashimi (OB-GYN)",
    evidence:
      "Repeat TSH 2.1 mIU/L verified; levothyroxine 50mcg initiated and documented in Malaffi HIE.",
  },
  "OBL-102": {
    clinician: "Dr. Mariam Al-Suwaidi (Postpartum OB-GYN)",
    evidence:
      "Postpartum MMR vaccine administered prior to discharge (Lot #MMR-2026-AE); recorded in Malaffi Immunization Registry.",
  },
};

const SYNTHETIC_FHIR_RECORDS: Record<string, Record<string, unknown>> = {
  "OBL-101": {
    resourceType: "Observation",
    id: "obs-tsh-2026-09",
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "3016-3",
          display: "Thyrotropin [Units/volume] in Serum or Plasma",
        },
      ],
    },
    subject: { reference: "Patient/PAT-AE-4092" },
    effectiveDateTime: "2026-09-14T09:30:00+04:00",
    valueQuantity: {
      value: 4.8,
      unit: "mIU/L",
      system: "http://unitsofmeasure.org",
      code: "m[IU]/L",
    },
    interpretation: [{ coding: [{ code: "H", display: "High" }] }],
    meta: { source: "urn:malaffi:hie:synthetic-preconception-lab" },
  },
  "OBL-102": {
    resourceType: "DiagnosticReport",
    id: "rep-rubella-2026-08",
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "25514-1",
          display: "Rubella virus IgG Ab [Presence] in Serum",
        },
      ],
    },
    subject: { reference: "Patient/PAT-AE-4092" },
    effectiveDateTime: "2026-08-22T11:15:00+04:00",
    conclusion:
      "Rubella IgG Non-Immune (<5 IU/mL). Recommend MMR immunization prior to pregnancy or postpartum.",
    meta: { source: "urn:malaffi:hie:synthetic-preconception-serology" },
  },
};

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-rose-100 text-rose-800 border-rose-200",
  HIGH: "bg-amber-100 text-amber-800 border-amber-200",
  MEDIUM: "bg-sky-100 text-sky-800 border-sky-200",
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-slate-100 text-slate-700",
  ESCALATED_FOR_REVIEW: "bg-rose-600 text-white",
  DEFERRED_TO_POSTPARTUM: "bg-indigo-100 text-indigo-800",
  VERIFIED_CLOSED: "bg-emerald-100 text-emerald-800",
};

export default function PrototypeDemo({ onBackToTutorial }: PrototypeDemoProps) {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [agentSummary, setAgentSummary] = useState<string | null>(null);
  const [specialistHandoff, setSpecialistHandoff] = useState<string | null>(null);
  const [aiMetadata, setAiMetadata] = useState<AiMetadata | null>(null);
  const [privacyReport, setPrivacyReport] = useState<PrivacyReport | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [expandedFhirId, setExpandedFhirId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verifyTarget, setVerifyTarget] = useState<Obligation | null>(null);
  const [clinicianName, setClinicianName] = useState("Dr. Layla Al-Hashimi (OB-GYN)");
  const [closureEvidence, setClosureEvidence] = useState("");

  async function loadData() {
    try {
      setError(null);
      const [hRes, oRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/obligations"),
      ]);
      if (hRes.ok) setHealth(await hRes.json());
      if (oRes.ok) {
        const data = await oRes.json();
        setObligations(data.obligations ?? []);
        setAuditEvents(data.audit_events ?? []);
      } else {
        setError(`ReproBridge API returned HTTP ${oRes.status} while loading obligations.`);
      }
    } catch {
      setError("Unable to reach ReproBridge API. Start FastAPI or deploy on Vercel.");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function openVerifyModal(obl: Obligation) {
    const preset = DEFAULT_CLOSURE_EVIDENCE[obl.id] ?? {
      clinician: "Dr. Layla Al-Hashimi (OB-GYN)",
      evidence: "Clinical follow-up completed and verified in Malaffi HIE.",
    };
    setClinicianName(preset.clinician);
    setClosureEvidence(preset.evidence);
    setVerifyTarget(obl);
  }

  async function runTransition(
    endpoint: "/api/transitions/pregnancy" | "/api/transitions/postpartum"
  ) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.detail || `Transition request failed (HTTP ${res.status})`
        );
      }
      const data = await res.json();
      setObligations(data.obligations ?? []);
      setAuditEvents(data.audit_events ?? []);
      setAgentSummary(data.agent_summary ?? null);
      setSpecialistHandoff(data.specialist_handoff ?? null);
      setAiMetadata(data.ai_metadata ?? null);
      setPrivacyReport(data.privacy_report ?? null);
      setTrace(data.trace ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!verifyTarget) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/obligations/${verifyTarget.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinician_name: clinicianName,
          closure_evidence: closureEvidence,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || "Verification failed");
      }
      setVerifyTarget(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    setLoading(true);
    setAgentSummary(null);
    setSpecialistHandoff(null);
    setAiMetadata(null);
    setPrivacyReport(null);
    setShowPayload(false);
    setExpandedFhirId(null);
    setTrace([]);
    setError(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setObligations(data.obligations ?? []);
        setAuditEvents(data.audit_events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  const patient = obligations[0];
  const isPostpartum = obligations.some((o) => o.life_stage === "Postpartum");
  const isAntenatal =
    !isPostpartum && obligations.some((o) => o.life_stage.startsWith("Antenatal"));
  const currentLifeStage = isPostpartum
    ? "Postpartum"
    : isAntenatal
      ? "Antenatal (Trimester 1)"
      : (patient?.life_stage ?? "Preconception");
  const hasClosed = obligations.some((o) => o.status === "VERIFIED_CLOSED");
  const activeStep = hasClosed ? 6 : isAntenatal || isPostpartum ? 5 : 3;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToTutorial}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Tutorial
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">ReproBridge</h1>
              <p className="text-xs text-slate-500">
                Clinical Obligation Passport · Preconception → Antenatal → Postpartum Continuity
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              <Lock className="h-3.5 w-3.5" />
              UAE PHI Local-Only
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                health?.database.connected
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
              title={health?.database.detail}
            >
              <Database className="h-3.5 w-3.5" />
              {health?.database.connected
                ? `Neon Postgres (${health.database.branch ?? "production"})`
                : "Synthetic Fallback Mode"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {/* 6-Step Care Continuity Flow */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            End-to-End Care-Continuity Flow
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {FLOW_STEPS.map((item) => {
              const completed = item.step <= activeStep;
              return (
                <div
                  key={item.step}
                  className={`rounded-lg border p-2.5 text-xs transition ${
                    completed
                      ? "border-teal-200 bg-teal-50/70 text-teal-950"
                      : "border-slate-100 bg-slate-50 text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>Step {item.step}</span>
                    {completed && <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />}
                  </div>
                  <p className="mt-1 font-medium">{item.label}</p>
                  <p className="mt-0.5 text-[11px] opacity-80">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Patient Header & Life-Stage Transition Actions */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Synthetic Patient Record (Stored in Neon / UAE Boundary)
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-900">
              {patient?.patient_name ?? "Amina Al-Mansoori (Synthetic)"}{" "}
              <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                {patient?.patient_id ?? "PAT-AE-4092"}
              </span>
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Current Life Stage:{" "}
              <span className="font-medium text-teal-700">{currentLifeStage}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {!isAntenatal && !isPostpartum && (
              <button
                onClick={() => runTransition("/api/transitions/pregnancy")}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                Trigger Pregnancy Transition
              </button>
            )}
            {isAntenatal && (
              <button
                onClick={() => runTransition("/api/transitions/postpartum")}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
              >
                <Baby className="h-4 w-4" />
                Trigger Postpartum Transition
              </button>
            )}
            <button
              onClick={handleReset}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset Demo
            </button>
          </div>
        </section>

        {/* Hybrid LangGraph Orchestrator Summary, Node Trace & UAE Privacy Firewall */}
        {agentSummary && (
          <section className="space-y-4 rounded-xl border border-teal-200 bg-teal-50 p-5 text-sm text-teal-950">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                <div>
                  <p className="font-semibold">
                    Hybrid Care-Resolution Harness (Deterministic Rules + OpenRouter Synthesis)
                  </p>
                  <p className="mt-1 text-teal-900">{agentSummary}</p>
                </div>
              </div>
              {aiMetadata && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-white px-2.5 py-1 font-mono text-[11px] font-medium text-teal-800">
                  <Cpu className="h-3 w-3" />
                  {aiMetadata.provider} · {aiMetadata.model}
                </span>
              )}
            </div>

            {specialistHandoff && (
              <div className="rounded-lg border border-teal-200 bg-white p-3.5 text-xs text-slate-700">
                <p className="font-semibold uppercase tracking-wider text-teal-700">
                  Draft Specialist Handoff (Pending Clinician Approval)
                </p>
                <p className="mt-1.5 whitespace-pre-line leading-relaxed">
                  {specialistHandoff}
                </p>
              </div>
            )}

            {trace.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {trace.map((step, idx) => (
                  <div
                    key={step.node}
                    className="flex flex-col justify-between rounded-lg border border-teal-200 bg-white p-3 text-xs"
                  >
                    <div>
                      <span className="font-mono font-semibold text-teal-800">
                        {idx + 1}. {step.node}
                      </span>
                      <span
                        className={`mt-1 block w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          step.execution === "agentic"
                            ? "bg-purple-100 text-purple-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {step.execution ?? "deterministic"}
                      </span>
                      <p className="mt-1.5 text-slate-600">{step.detail}</p>
                    </div>
                    {idx < trace.length - 1 && (
                      <div className="mt-2 flex justify-end text-teal-400">
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {privacyReport && (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-indigo-900">
                    <Lock className="h-3.5 w-3.5" />
                    UAE Data Residency Firewall — Zero PHI Sent Outside UAE
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPayload((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-800 hover:bg-indigo-50"
                  >
                    <Eye className="h-3 w-3" />
                    {showPayload ? "Hide AI Payload" : "Inspect Exact AI Payload"}
                  </button>
                </div>

                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="font-medium text-indigo-800">
                      Kept in Neon Postgres / UAE (Redacted):
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-indigo-700">
                      {privacyReport.redacted_fields.join(", ")}
                    </p>
                  </div>
                  <div>
                    <p className="font-medium text-emerald-800">
                      Permitted to OpenRouter (De-identified Only):
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-emerald-700">
                      {privacyReport.permitted_fields.join(", ")}
                    </p>
                  </div>
                </div>

                {showPayload && (
                  <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 font-mono text-[11px] text-emerald-300">
                    {JSON.stringify(privacyReport.payload, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </section>
        )}

        {/* Clinical Obligation Passport */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Clinical Obligation Passport ({obligations.length})
            </h3>
          </div>

          {obligations.map((obl) => {
            const fhirRecord = SYNTHETIC_FHIR_RECORDS[obl.id];
            const isFhirOpen = expandedFhirId === obl.id;

            return (
              <article
                key={obl.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{obl.id}</span>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          PRIORITY_STYLES[obl.priority] ?? "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {obl.priority}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[obl.status] ?? "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {obl.status}
                      </span>
                    </div>
                    <h4 className="mt-2 text-base font-semibold text-slate-900">
                      {obl.title}
                    </h4>
                  </div>

                  {obl.status === "DEFERRED_TO_POSTPARTUM" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800">
                      <Lock className="h-3.5 w-3.5" />
                      Contraindicated in Pregnancy — Auto-Queued for Postpartum
                    </span>
                  ) : (
                    obl.status !== "VERIFIED_CLOSED" && (
                      <button
                        onClick={() => openVerifyModal(obl)}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" />
                        Clinician Verify & Close
                      </button>
                    )
                  )}
                </div>

                <p className="mt-3 text-sm leading-relaxed text-slate-600">{obl.rationale}</p>

                <dl className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:grid-cols-3">
                  <div>
                    <dt className="font-medium text-slate-400">Evidence Source</dt>
                    <dd className="mt-0.5 font-mono text-slate-700">{obl.evidence_source}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Rule Version</dt>
                    <dd className="mt-0.5 font-mono text-slate-700">{obl.rule_version}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Care Owner</dt>
                    <dd className="mt-0.5 text-slate-700">{obl.owner}</dd>
                  </div>
                </dl>

                {fhirRecord && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedFhirId(isFhirOpen ? null : obl.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900"
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      {isFhirOpen
                        ? "Hide HL7 FHIR R4 Source Record"
                        : "Inspect HL7 FHIR R4 Source Record"}
                    </button>
                    {isFhirOpen && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-sky-200">
                        {JSON.stringify(fhirRecord, null, 2)}
                      </pre>
                    )}
                  </div>
                )}

                {obl.verified_by && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div>
                      <span className="font-semibold">Verified by {obl.verified_by}:</span>{" "}
                      {obl.closure_evidence}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        {/* Auditable Governance Log */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Auditable Governance Log ({auditEvents.length})
            </h3>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 text-xs">
            {auditEvents.map((ev) => (
              <li
                key={ev.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2.5"
              >
                <div>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                    {ev.event_type}
                  </span>
                  <span className="ml-2 font-medium text-slate-800">{ev.actor}</span>
                  <p className="mt-1 text-slate-600">{ev.summary}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400">
                  {new Date(ev.created_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/* Human-in-the-Loop Clinician Verification Modal */}
      {verifyTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="verify-modal-title"
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Evidence-Verified Care Closure
                </p>
                <h3
                  id="verify-modal-title"
                  className="mt-1 text-base font-semibold text-slate-900"
                >
                  {verifyTarget.id}: {verifyTarget.title}
                </h3>
              </div>
              <button
                onClick={() => setVerifyTarget(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmVerify} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Authorized Clinician
                </label>
                <input
                  type="text"
                  required
                  value={clinicianName}
                  onChange={(e) => setClinicianName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Supporting Clinical Evidence (Required for Closure)
                </label>
                <textarea
                  rows={3}
                  required
                  value={closureEvidence}
                  onChange={(e) => setClosureEvidence(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVerifyTarget(null)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <FileCheck2 className="h-4 w-4" />
                  Approve & Verify Closure
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
