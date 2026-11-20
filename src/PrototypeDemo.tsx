import { useEffect, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Baby,
  Bot,
  CheckCircle2,
  ClipboardList,
  Code2,
  Cpu,
  Database,
  Eye,
  FileCheck2,
  GitBranch,
  Info,
  Lock,
  Pause,
  Play,
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

const TRACE_NODE_META: Record<
  string,
  { title: string; accent: string; badge: string }
> = {
  detect_open_obligations: {
    title: "Detect Open Obligations",
    accent: "border-t-teal-500",
    badge: "bg-teal-100 text-teal-800",
  },
  evaluate_life_stage_transition: {
    title: "Evaluate Transition Rules",
    accent: "border-t-sky-500",
    badge: "bg-sky-100 text-sky-800",
  },
  apply_uae_privacy_firewall: {
    title: "UAE Privacy Firewall",
    accent: "border-t-indigo-500",
    badge: "bg-indigo-100 text-indigo-800",
  },
  synthesize_coordination_brief: {
    title: "Synthesize Handoff Brief",
    accent: "border-t-purple-500",
    badge: "bg-purple-100 text-purple-800",
  },
};

function formatExecutionLabel(execution?: string): { label: string; className: string } {
  if (execution === "agentic") {
    return {
      label: "Agentic",
      className: "border-purple-200 bg-purple-50 text-purple-800",
    };
  }
  if (execution === "deterministic_fallback") {
    return {
      label: "Fallback",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "Deterministic",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  };
}

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

const INTERIM_TIPS: Record<string, { title: string; body: string }[]> = {
  pregnancy: [
    {
      title: "UAE PHI Privacy Firewall Active",
      body: "Deterministic clinical rules run first inside the UAE boundary. Patient names, IDs, and raw HIE notes are stripped before OpenRouter receives an ephemeral case token.",
    },
    {
      title: "Clinical Safety Rule · First-Trimester TSH",
      body: "Preconception TSH of 4.8 mIU/L exceeds the first-trimester target (<2.5 mIU/L). AI never diagnoses or prescribes — it only drafts the OB-GYN handoff checklist for clinician sign-off.",
    },
    {
      title: "Live-Vaccine Contraindication Guard",
      body: "Rubella MMR is a live-attenuated vaccine contraindicated during pregnancy. ReproBridge preserves the obligation and locks closure until postpartum delivery.",
    },
  ],
  postpartum: [
    {
      title: "Postpartum Wake-Up Rule",
      body: "Delivery lifts the pregnancy live-vaccine contraindication, automatically reactivating deferred OBL-102 as URGENT for pre-discharge MMR immunization.",
    },
    {
      title: "Assistive AI Only · Zero Autonomous Closure",
      body: "OpenRouter drafts a de-identified postpartum discharge handoff while Neon Postgres enforces clinician evidence verification before any obligation can close.",
    },
  ],
};

function parseStreamedSections(raw: string): { summary: string; handoff: string } {
  const trimmed = raw.trim();
  if (trimmed.includes("HANDOFF:")) {
    const [before, after] = trimmed.split("HANDOFF:", 2);
    return {
      summary: before.replace(/^SUMMARY:\s*/i, "").trim(),
      handoff: after.trim(),
    };
  }
  return {
    summary: trimmed.replace(/^SUMMARY:\s*/i, "").trim(),
    handoff: "",
  };
}

export default function PrototypeDemo({ onBackToTutorial }: PrototypeDemoProps) {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [agentSummary, setAgentSummary] = useState<string | null>(null);
  const [specialistHandoff, setSpecialistHandoff] = useState<string | null>(null);
  const [aiMetadata, setAiMetadata] = useState<AiMetadata | null>(null);
  const [privacyReport, setPrivacyReport] = useState<PrivacyReport | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [expandedFhirId, setExpandedFhirId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingPhase, setStreamingPhase] = useState<string | null>(null);
  const [streamingRawText, setStreamingRawText] = useState("");
  const [streamingModel, setStreamingModel] = useState<string | null>(null);
  const [activeTransitionKind, setActiveTransitionKind] = useState<"pregnancy" | "postpartum">("pregnancy");
  const [tipIndex, setTipIndex] = useState(0);
  const [tipsPaused, setTipsPaused] = useState(false);
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
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!isStreaming || tipsPaused) return;
    const tips = INTERIM_TIPS[activeTransitionKind];
    const timer = window.setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [isStreaming, tipsPaused, activeTransitionKind]);

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
    const kind = endpoint.includes("postpartum") ? "postpartum" : "pregnancy";
    setActiveTransitionKind(kind);
    setTipIndex(0);
    setLoading(true);
    setIsStreaming(true);
    setStreamingPhase("Running deterministic clinical rules & UAE PHI firewall…");
    setStreamingRawText("");
    setStreamingModel(null);
    setAgentSummary(null);
    setSpecialistHandoff(null);
    setAiMetadata(null);
    setError(null);

    try {
      const res = await fetch(`${endpoint}/stream`, {
        method: "POST",
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.detail || `Transition request failed (HTTP ${res.status})`
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      const handleEventBlock = (block: string) => {
        const lines = block.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (dataLines.length === 0) return;
        const payload = JSON.parse(dataLines.join("\n"));

        if (eventName === "deterministic_complete") {
          setObligations(payload.obligations ?? []);
          setAuditEvents(payload.audit_events ?? []);
          setPrivacyReport(payload.privacy_report ?? null);
          setTrace(payload.trace ?? []);
          setStreamingPhase("UAE Firewall verified (0 PHI) · Streaming OpenRouter synthesis…");
        } else if (eventName === "token") {
          accumulated += payload.delta ?? "";
          setStreamingRawText(accumulated);
          if (payload.model) setStreamingModel(payload.model);
          setStreamingPhase("Streaming de-identified clinician handoff tokens…");
        } else if (eventName === "complete") {
          setObligations(payload.obligations ?? []);
          setAuditEvents(payload.audit_events ?? []);
          setAgentSummary(payload.agent_summary ?? null);
          setSpecialistHandoff(payload.specialist_handoff ?? null);
          setAiMetadata(payload.ai_metadata ?? null);
          setPrivacyReport(payload.privacy_report ?? null);
          setTrace(payload.trace ?? []);
          setStreamingPhase(null);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          if (block.trim()) handleEventBlock(block);
        }
      }
      if (buffer.trim()) handleEventBlock(buffer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setLoading(false);
      setIsStreaming(false);
      setStreamingPhase(null);
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

  const parsedStream = parseStreamedSections(streamingRawText);
  const displaySummary = agentSummary ?? (isStreaming ? parsedStream.summary : null);
  const displayHandoff = specialistHandoff ?? (isStreaming ? parsedStream.handoff : null);
  const currentTip = INTERIM_TIPS[activeTransitionKind][tipIndex] ?? INTERIM_TIPS.pregnancy[0];
  const showHarnessPanel = isStreaming || Boolean(agentSummary);
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
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
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
          </div>

          {!isPostpartum && (
            <div
              role="note"
              className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${
                isAntenatal && obligations.some((o) => o.id === "OBL-101" && o.status !== "VERIFIED_CLOSED")
                  ? "border-amber-200 bg-amber-50/80 text-amber-950"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {isAntenatal && obligations.some((o) => o.id === "OBL-101" && o.status !== "VERIFIED_CLOSED") ? (
                <>
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <p>
                    <span className="font-semibold text-amber-900">
                      Before triggering Postpartum:
                    </span>{" "}
                    <span className="font-mono font-medium">OBL-101</span> (antenatal TSH follow-up) is still open. You can verify &amp; close it below first, or proceed — Postpartum Transition will carry{" "}
                    <span className="font-mono">OBL-101</span> forward for 6-week reassessment, reactivate deferred{" "}
                    <span className="font-mono">OBL-102</span> (MMR) as <span className="font-semibold">URGENT</span>, and call external assistive AI (OpenRouter) with <span className="font-semibold">0 PHI</span> to draft a handoff for clinician sign-off.
                  </p>
                </>
              ) : isAntenatal ? (
                <>
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                  <p>
                    <span className="font-semibold text-slate-900">
                      Postpartum Transition Notice:
                    </span>{" "}
                    Runs deterministic postpartum rules (lifting the pregnancy live-vaccine contraindication and reactivating{" "}
                    <span className="font-mono">OBL-102</span> as <span className="font-semibold">URGENT</span>), strips all UAE PHI, and calls OpenRouter solely to draft an assistive OB-GYN handoff pending clinician approval.
                  </p>
                </>
              ) : (
                <>
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                  <p>
                    <span className="font-semibold text-slate-900">
                      Hybrid AI &amp; Safety Notice:
                    </span>{" "}
                    Triggering a life-stage transition executes deterministic clinical rules in Neon Postgres first, strips all UAE PHI via the Privacy Firewall, and uses external assistive AI (OpenRouter) only to draft a de-identified clinician handoff — never to diagnose, prescribe, or close obligations.
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        {/* Hybrid LangGraph Orchestrator Summary, Live Streaming, Micro-Interactions & UAE Privacy Firewall */}
        {showHarnessPanel && (
          <section
            aria-live="polite"
            aria-busy={isStreaming}
            className="space-y-4 rounded-xl border border-teal-200 bg-teal-50 p-5 text-sm text-teal-950"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                {/* Floating agent avatar that reacts while thinking/streaming */}
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                    isStreaming
                      ? "rb-float-avatar border-teal-300 bg-teal-600 text-white shadow-xs"
                      : "border-teal-200 bg-white text-teal-700"
                  }`}
                >
                  {isStreaming ? (
                    <Bot className="h-4.5 w-4.5" />
                  ) : (
                    <ShieldAlert className="h-4 w-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">
                      Hybrid Care-Resolution Harness (Deterministic Rules + OpenRouter Synthesis)
                    </p>
                    {isStreaming && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-medium text-teal-800">
                        <progress
                          aria-label="Synthesizing clinical handoff"
                          className="rb-spinner"
                        />
                        <span>{streamingPhase ?? "Synthesizing…"}</span>
                        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                          <span className="rb-typing-dot h-1 w-1 rounded-full bg-teal-600" />
                          <span
                            className="rb-typing-dot h-1 w-1 rounded-full bg-teal-600"
                            style={{ animationDelay: "0.2s" }}
                          />
                          <span
                            className="rb-typing-dot h-1 w-1 rounded-full bg-teal-600"
                            style={{ animationDelay: "0.4s" }}
                          />
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Streamed summary text OR skeleton loader */}
                  {displaySummary ? (
                    <p className="mt-1.5 leading-relaxed text-teal-900">
                      {displaySummary}
                      {isStreaming && !displayHandoff && (
                        <span className="rb-stream-caret" aria-hidden="true" />
                      )}
                    </p>
                  ) : (
                    <div className="mt-2.5 space-y-2" aria-label="Loading coordination summary">
                      <div className="rb-shimmer h-3.5 w-full rounded" />
                      <div className="rb-shimmer h-3.5 w-4/5 rounded" />
                    </div>
                  )}
                </div>
              </div>

              {(aiMetadata || streamingModel) && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-white px-2.5 py-1 font-mono text-[11px] font-medium text-teal-800">
                  <Cpu className="h-3 w-3" />
                  {aiMetadata
                    ? `${aiMetadata.provider} · ${aiMetadata.model}`
                    : `openrouter · ${streamingModel}`}
                </span>
              )}
            </div>

            {/* Interim Context: Clinical Disclaimer & Educational Tip while streaming */}
            {isStreaming && (
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/90 px-3.5 py-2.5 text-xs text-amber-950">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="font-semibold text-amber-900">
                      While you wait · {currentTip.title}
                    </p>
                    <p className="mt-0.5 leading-relaxed text-amber-900/90">
                      {currentTip.body}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setTipsPaused((p) => !p)}
                  className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-50"
                >
                  {tipsPaused ? (
                    <>
                      <Play className="h-3 w-3" />
                      Resume tips
                    </>
                  ) : (
                    <>
                      <Pause className="h-3 w-3" />
                      Pause tips
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Specialist Handoff — streamed live or skeleton loader */}
            {displayHandoff ? (
              <div className="rounded-lg border border-teal-200 bg-white p-3.5 text-xs text-slate-700">
                <p className="font-semibold uppercase tracking-wider text-teal-700">
                  Draft Specialist Handoff (Pending Clinician Approval)
                </p>
                <p className="mt-1.5 whitespace-pre-line leading-relaxed">
                  {displayHandoff}
                  {isStreaming && <span className="rb-stream-caret" aria-hidden="true" />}
                </p>
              </div>
            ) : isStreaming ? (
              <div
                className="rounded-lg border border-teal-200 bg-white p-3.5 text-xs"
                aria-label="Drafting specialist handoff"
              >
                <p className="font-semibold uppercase tracking-wider text-teal-700">
                  Draft Specialist Handoff (Streaming from OpenRouter…)
                </p>
                <div className="mt-2.5 space-y-2">
                  <div className="rb-shimmer h-3 w-11/12 rounded" />
                  <div className="rb-shimmer h-3 w-3/4 rounded" />
                  <div className="rb-shimmer h-3 w-5/6 rounded" />
                </div>
              </div>
            ) : null}

            {trace.length > 0 && (
              <div className="rb-trace-grid">
                {trace.map((step, idx) => {
                  const meta = TRACE_NODE_META[step.node] ?? {
                    title: step.node.replaceAll("_", " "),
                    accent: "border-t-teal-500",
                    badge: "bg-teal-100 text-teal-800",
                  };
                  const exec = formatExecutionLabel(step.execution);

                  return (
                    <article
                      key={step.node}
                      title={step.node}
                      className={`rb-trace-card rounded-xl border border-slate-200/90 border-t-2 ${meta.accent} bg-white p-3.5 text-xs shadow-xs`}
                    >
                      <header className="flex items-start justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${meta.badge}`}
                          >
                            {idx + 1}
                          </span>
                          <h4 className="font-semibold leading-snug text-slate-900">
                            {meta.title}
                          </h4>
                        </div>
                        {idx < 3 && (
                          <ArrowRight
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400"
                            aria-hidden="true"
                          />
                        )}
                      </header>

                      <p className="leading-relaxed text-slate-600">{step.detail}</p>

                      <footer className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${exec.className}`}
                        >
                          {exec.label}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                          <Lock className="h-2.5 w-2.5" />
                          0 PHI
                        </span>
                      </footer>
                    </article>
                  );
                })}
                {isStreaming && trace.length === 3 && (
                  <article
                    title="synthesize_coordination_brief"
                    className="rb-trace-card rounded-xl border border-dashed border-purple-300 border-t-2 border-t-purple-500 bg-white/90 p-3.5 text-xs shadow-xs"
                  >
                    <header className="flex items-center gap-2 min-w-0">
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 font-mono text-[11px] font-bold text-purple-800">
                        4
                      </span>
                      <h4 className="font-semibold leading-snug text-slate-900">
                        Synthesize Handoff Brief
                      </h4>
                    </header>

                    <div className="space-y-1.5">
                      <div className="rb-shimmer h-2.5 w-full rounded" />
                      <div className="rb-shimmer h-2.5 w-4/5 rounded" />
                    </div>

                    <footer className="flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-800">
                        <progress aria-label="Streaming brief" className="rb-spinner" />
                        Streaming…
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                        <Lock className="h-2.5 w-2.5" />
                        0 PHI
                      </span>
                    </footer>
                  </article>
                )}
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

          {initialLoading && obligations.length === 0 && (
            <div className="space-y-4" aria-label="Loading clinical obligations">
              {[0, 1].map((idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                >
                  <div className="flex items-center gap-2">
                    <div className="rb-shimmer h-4 w-16 rounded" />
                    <div className="rb-shimmer h-5 w-16 rounded-full" />
                    <div className="rb-shimmer h-5 w-20 rounded-full" />
                  </div>
                  <div className="rb-shimmer mt-3 h-5 w-2/3 rounded" />
                  <div className="rb-shimmer mt-2 h-3.5 w-full rounded" />
                  <div className="rb-shimmer mt-1.5 h-3.5 w-5/6 rounded" />
                </div>
              ))}
            </div>
          )}

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
