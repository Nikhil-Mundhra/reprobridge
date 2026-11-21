import {
  ArrowRight,
  Baby,
  Building2,
  Check,
  CheckCircle2,
  Info,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { FACILITY_CONTINUITY_STAGES, FLOW_STEPS } from "./constants";
import type { Obligation } from "./types";

interface CareFlowAndPatientHeaderProps {
  activeStep: number;
  patient: Obligation | undefined;
  currentLifeStage: string;
  isAntenatal: boolean;
  isPostpartum: boolean;
  obligations: Obligation[];
  loading: boolean;
  onRunTransition: (
    endpoint: "/api/transitions/pregnancy" | "/api/transitions/postpartum"
  ) => void;
  onReset: () => void;
}

export default function CareFlowAndPatientHeader({
  activeStep,
  patient,
  currentLifeStage,
  isAntenatal,
  isPostpartum,
  obligations,
  loading,
  onRunTransition,
  onReset,
}: CareFlowAndPatientHeaderProps) {
  return (
    <>
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
                onClick={() => onRunTransition("/api/transitions/pregnancy")}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                Trigger Pregnancy Transition
              </button>
            )}
            {isAntenatal && (
              <button
                onClick={() => onRunTransition("/api/transitions/postpartum")}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
              >
                <Baby className="h-4 w-4" />
                Trigger Postpartum Transition
              </button>
            )}
            <button
              onClick={onReset}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset Demo
            </button>
          </div>
        </div>

        {/* Compact Care-Site Provenance Trail */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-slate-100 pt-3.5 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-400">
            <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
            Care Sites:
          </span>
          <ol className="flex flex-wrap items-center gap-1.5">
            {FACILITY_CONTINUITY_STAGES.map((stage, idx) => {
              const currentFacilityIdx = isPostpartum ? 2 : isAntenatal ? 1 : 0;
              const isDone = stage.stageIndex < currentFacilityIdx;
              const isCurrent = stage.stageIndex === currentFacilityIdx;

              return (
                <li key={stage.dayTag} className="inline-flex items-center gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
                      isCurrent
                        ? "border-teal-300 bg-teal-50 font-medium text-teal-950"
                        : isDone
                          ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
                          : "border-slate-200 bg-slate-50 text-slate-400"
                    }`}
                  >
                    {isDone ? (
                      <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 rounded-full ${
                          isCurrent ? "bg-teal-600" : "bg-slate-300"
                        }`}
                      />
                    )}
                    <span>{stage.facility}</span>
                    <span className="font-mono text-[10px] opacity-75">
                      {stage.emrSystem} · {stage.dayTag}
                    </span>
                  </span>
                  {idx < FACILITY_CONTINUITY_STAGES.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-slate-300" aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ol>
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
    </>
  );
}
