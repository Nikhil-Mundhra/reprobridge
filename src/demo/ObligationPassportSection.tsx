import { useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Code2,
  FileCheck2,
  FileText,
  GitBranch,
  Lock,
  Send,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { getDefaultDocIdForObligation } from "../ClinicalDocumentsDrawer";
import ClinicalMetricVisualizer from "./ClinicalMetricVisualizer";
import {
  SYNTHETIC_FHIR_RECORDS,
} from "./constants";
import { formatClosurePolicyLabel, getUrgentDueChip } from "./helpers";
import type { Obligation, SafetyBlockInfo } from "./types";

function getPlainStatusBadge(obl: Obligation): { label: string; className: string } {
  if (obl.status === "VERIFIED_CLOSED") {
    return {
      label: "Verified & Closed",
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    };
  }
  if (obl.status === "DEFERRED_TO_POSTPARTUM") {
    return {
      label: "Deferred until Postpartum",
      className: "border-indigo-200 bg-indigo-50 text-indigo-800",
    };
  }
  if (obl.status === "ESCALATED_FOR_REVIEW") {
    return {
      label: "Urgent · Specialist Review",
      className: "border-rose-200 bg-rose-50 text-rose-800",
    };
  }
  if (obl.priority === "HIGH") {
    return {
      label: "High Priority · Open",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "Open Follow-up",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  };
}

function getTransitionDiff(
  obl: Obligation,
  urgentDue: string | null
): { before: string; after: string; reason: string | null } | null {
  if (obl.life_stage === "Preconception" && obl.status === "OPEN") {
    return null;
  }

  const isImmuneOrHpv =
    obl.rule_version.startsWith("RB-IMMUNE-") || obl.rule_version.startsWith("RB-HPV-");

  if (obl.status === "DEFERRED_TO_POSTPARTUM") {
    return {
      before: "Preconception · Medium · Open",
      after: `${obl.life_stage} · High · Deferred until Postpartum`,
      reason:
        "Priority elevated from MEDIUM to HIGH so pre-discharge postpartum immunization is locked onto the delivery checklist.",
    };
  }

  if (obl.status === "ESCALATED_FOR_REVIEW") {
    return {
      before: isImmuneOrHpv ? "Deferred in Pregnancy" : "Preconception · High · Open",
      after: `${obl.life_stage} · Urgent · Escalated${urgentDue ? ` (${urgentDue})` : ""}`,
      reason: null,
    };
  }

  if (obl.status === "VERIFIED_CLOSED") {
    return {
      before: "Open Clinical Gap",
      after: `${obl.life_stage} · Verified Closed`,
      reason: null,
    };
  }

  return {
    before: "Preconception · Open",
    after: `${obl.life_stage} · Active Care Plan`,
    reason: null,
  };
}

interface ObligationPassportSectionProps {
  obligations: Obligation[];
  initialLoading: boolean;
  loading: boolean;
  testingSafetyId: string | null;
  safetyBlockFeedback: Record<string, SafetyBlockInfo>;
  onDismissSafetyBlock: (oblId: string) => void;
  onTestSafetyGuard: (obl: Obligation) => void;
  onOpenVerifyModal: (obl: Obligation) => void;
  onOpenFhirExport: () => void;
  onOpenIntakeModal: () => void;
  onOpenClinicalDocument: (docId: string) => void;
  onExplainObligation: (obl: Obligation) => void;
  explainingId?: string | null;
}

export default function ObligationPassportSection({
  obligations,
  initialLoading,
  loading,
  testingSafetyId,
  safetyBlockFeedback,
  onDismissSafetyBlock,
  onTestSafetyGuard,
  onOpenVerifyModal,
  onOpenFhirExport,
  onOpenIntakeModal,
  onOpenClinicalDocument,
  onExplainObligation,
  explainingId,
}: ObligationPassportSectionProps) {
  const [expandedFhirId, setExpandedFhirId] = useState<string | null>(null);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Clinical Obligation Passport ({obligations.length})
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenFhirExport}
            disabled={obligations.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-medium text-indigo-800 shadow-xs transition hover:bg-indigo-50 disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            EMR Write-Back (FHIR R4)
          </button>
          <button
            type="button"
            onClick={onOpenIntakeModal}
            className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-medium text-teal-800 shadow-xs transition hover:bg-teal-50"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Import Table / Add Finding
          </button>
        </div>
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
        const urgentDue = getUrgentDueChip(obl);
        const safetyBlock = safetyBlockFeedback[obl.id];
        const statusBadge = getPlainStatusBadge(obl);
        const transitionDiff = getTransitionDiff(obl, urgentDue);
        const closurePolicyLabel = formatClosurePolicyLabel(obl.closure_policy);
        const dueWindowText =
          obl.due_window_start && obl.due_window_end
            ? `${obl.due_window_start} → ${obl.due_window_end}`
            : obl.due_window_end
              ? `By ${obl.due_window_end}`
              : null;

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
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadge.className}`}
                  >
                    {statusBadge.label}
                  </span>
                  {urgentDue && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-rose-800">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {urgentDue}
                    </span>
                  )}
                  {obl.parent_obligation_id && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-mono text-[10px] font-medium text-teal-800">
                      Linked ← {obl.parent_obligation_id}
                    </span>
                  )}
                  {obl.protocol_code && (
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-600">
                      {obl.protocol_code}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-slate-400">
                    {obl.status}
                  </span>
                </div>
                <h4 className="mt-2 text-base font-semibold text-slate-900">
                  {obl.title}
                </h4>
                {(closurePolicyLabel || dueWindowText) && obl.status !== "VERIFIED_CLOSED" && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                    {closurePolicyLabel && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50/80 px-2 py-0.5 font-medium text-amber-900">
                        <ShieldAlert className="h-3 w-3 shrink-0 text-amber-700" aria-hidden="true" />
                        {closurePolicyLabel}
                      </span>
                    )}
                    {dueWindowText && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[10px] text-slate-700">
                        <Clock className="h-3 w-3 shrink-0 text-slate-500" aria-hidden="true" />
                        Window: {dueWindowText}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {obl.status === "DEFERRED_TO_POSTPARTUM" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800">
                    <Lock className="h-3.5 w-3.5" />
                    Contraindicated in Pregnancy — Auto-Queued for Postpartum
                  </span>
                  <button
                    type="button"
                    onClick={() => onTestSafetyGuard(obl)}
                    disabled={testingSafetyId === obl.id || loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                    title="Demonstrate the deterministic HTTP 409 safety guard blocking premature closure during pregnancy"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                    {testingSafetyId === obl.id ? "Testing Guard…" : "Test Safety Guard"}
                  </button>
                </div>
              ) : (
                obl.status !== "VERIFIED_CLOSED" && (
                  <button
                    onClick={() => onOpenVerifyModal(obl)}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <FileCheck2 className="h-3.5 w-3.5" />
                    Clinician Verify & Close
                  </button>
                )
              )}
            </div>

            {safetyBlock && (
              <div
                role="alert"
                className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-950"
              >
                <div className="flex items-start gap-2">
                  <ShieldAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-semibold text-rose-900">
                      Deterministic Safety Guard Intercepted (HTTP {safetyBlock.status} ·{" "}
                      <span className="font-mono">{safetyBlock.ruleVersion}</span>)
                    </p>
                    <p className="mt-0.5 leading-relaxed text-rose-800">{safetyBlock.detail}</p>
                    <p className="mt-1 text-[11px] font-medium text-rose-700">
                      Logged as <span className="font-mono">CLINICAL_SAFETY_BLOCKED</span> in
                      the Auditable Governance Log below.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDismissSafetyBlock(obl.id)}
                  aria-label={`Dismiss safety guard alert for ${obl.id}`}
                  className="rounded p-1 text-rose-500 hover:bg-rose-100 hover:text-rose-800"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {transitionDiff && (
              <div className="mt-3 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-slate-500">
                    Before: <span className="font-medium text-slate-700">{transitionDiff.before}</span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-teal-600" aria-hidden="true" />
                  <span className="font-semibold text-slate-900">
                    After: {transitionDiff.after}
                  </span>
                </div>
                {transitionDiff.reason && (
                  <p className="mt-1 text-[11px] text-slate-600">{transitionDiff.reason}</p>
                )}
              </div>
            )}

            <p className="mt-3 text-sm leading-relaxed text-slate-600">{obl.rationale}</p>

            <ClinicalMetricVisualizer obligation={obl} />

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

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onExplainObligation(obl)}
                disabled={explainingId === obl.id}
                aria-label={`Explain ${obl.id}: ${obl.title}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-teal-200 bg-teal-50/80 px-2.5 py-1 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 disabled:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                {explainingId === obl.id ? "Explaining…" : "Explain"}
              </button>
              <button
                type="button"
                onClick={() => onOpenClinicalDocument(getDefaultDocIdForObligation(obl.id))}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-700 hover:text-indigo-900"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                View Clinical Report (Clinician Ref)
              </button>
              {fhirRecord && (
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
              )}
            </div>
            {fhirRecord && isFhirOpen && (
              <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-sky-200">
                {JSON.stringify(fhirRecord, null, 2)}
              </pre>
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
  );
}
