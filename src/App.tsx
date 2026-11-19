import { useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Database,
  FileCheck2,
  GitBranch,
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
  detail: string;
}

interface HealthResponse {
  status: string;
  database: {
    provider: string;
    connected: boolean;
    detail: string;
  };
}

const FLOW_STEPS = [
  { step: 1, label: "Clinical Finding", desc: "FHIR / Malaffi HIE intake" },
  { step: 2, label: "Care-Gap Detection", desc: "Deterministic clinical rules" },
  { step: 3, label: "Obligation Passport", desc: "Auditable longitudinal record" },
  { step: 4, label: "Life-Stage Transition", desc: "Pregnancy event trigger" },
  { step: 5, label: "Agentic Coordination", desc: "LangGraph reassessment" },
  { step: 6, label: "Verified Closure", desc: "Clinician evidence sign-off" },
];

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

export default function App() {
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [agentSummary, setAgentSummary] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verifyTarget, setVerifyTarget] = useState<Obligation | null>(null);
  const [clinicianName, setClinicianName] = useState("Dr. Layla Al-Hashimi (OB-GYN)");
  const [closureEvidence, setClosureEvidence] = useState(
    "Repeat TSH 2.1 mIU/L verified; levothyroxine 50mcg initiated and documented in Malaffi HIE."
  );

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
      }
    } catch {
      setError("Unable to reach ReproBridge API. Start FastAPI or deploy on Vercel.");
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handlePregnancyTransition() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/transitions/pregnancy", { method: "POST" });
      if (!res.ok) throw new Error("Transition request failed");
      const data = await res.json();
      setObligations(data.obligations ?? []);
      setAuditEvents(data.audit_events ?? []);
      setAgentSummary(data.agent_summary ?? null);
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
      if (!res.ok) throw new Error("Verification failed");
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
  const hasTransitioned = obligations.some((o) => o.life_stage.startsWith("Antenatal"));
  const hasClosed = obligations.some((o) => o.status === "VERIFIED_CLOSED");
  const activeStep = hasClosed ? 6 : hasTransitioned ? 5 : 3;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-white">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">ReproBridge</h1>
              <p className="text-xs text-slate-500">
                Clinical Obligation Passport · Preconception-to-Pregnancy Continuity
              </p>
            </div>
          </div>

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
              ? "Neon PostgreSQL Connected"
              : "Synthetic Fallback Mode"}
          </span>
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

        {/* Patient Header & Actions */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Synthetic Patient Record
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-900">
              {patient?.patient_name ?? "Amina Al-Mansoori (Synthetic)"}{" "}
              <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                {patient?.patient_id ?? "PAT-AE-4092"}
              </span>
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Current Life Stage:{" "}
              <span className="font-medium text-teal-700">
                {patient?.life_stage ?? "Preconception"}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handlePregnancyTransition}
              disabled={loading || hasTransitioned}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {hasTransitioned ? "Pregnancy Transition Active" : "Trigger Pregnancy Transition"}
            </button>
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

        {/* LangGraph Orchestrator Summary & Node Trace */}
        {agentSummary && (
          <section className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
              <div className="w-full">
                <p className="font-semibold">LangGraph Care-Resolution Orchestrator</p>
                <p className="mt-0.5 text-teal-800">{agentSummary}</p>

                {trace.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {trace.map((step, idx) => (
                      <div key={step.node} className="flex items-center gap-2">
                        <div className="rounded-md border border-teal-200 bg-white px-2.5 py-1.5 text-xs">
                          <span className="font-mono font-semibold text-teal-700">
                            {step.node}
                          </span>
                          <p className="mt-0.5 text-slate-600">{step.detail}</p>
                        </div>
                        {idx < trace.length - 1 && (
                          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-teal-500" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
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

          {obligations.map((obl) => (
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

                {obl.status !== "VERIFIED_CLOSED" && (
                  <button
                    onClick={() => setVerifyTarget(obl)}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <FileCheck2 className="h-3.5 w-3.5" />
                    Clinician Verify & Close
                  </button>
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
          ))}
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
              <li key={ev.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
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
                <h3 id="verify-modal-title" className="mt-1 text-base font-semibold text-slate-900">
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
