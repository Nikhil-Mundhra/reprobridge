import {
  ArrowRight,
  Baby,
  Building2,
  Check,
  CheckCircle2,
  Lock,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import {
  FACILITY_CONTINUITY_STAGES,
  FLOW_STEPS,
  PATIENT_FACILITY_STAGES,
} from "./constants";
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

export interface CareSiteContinuitySpineProps {
  patient?: Obligation | undefined;
  isAntenatal: boolean;
  isPostpartum: boolean;
  obligations: Obligation[];
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
  const activePatientId = patient?.patient_id ?? "PAT-AE-4092";

  const escalatedCount = obligations.filter(
    (o) => o.status === "ESCALATED_FOR_REVIEW"
  ).length;
  const deferredCount = obligations.filter(
    (o) => o.status === "DEFERRED_TO_POSTPARTUM"
  ).length;
  const closedCount = obligations.filter((o) => o.status === "VERIFIED_CLOSED").length;
  const currentStepMeta =
    FLOW_STEPS.find((s) => s.step === activeStep) ?? FLOW_STEPS[2];

  const transitionOutcomeSegments: string[] = [];
  if (escalatedCount > 0) {
    transitionOutcomeSegments.push(
      `${escalatedCount} ${escalatedCount === 1 ? "gap" : "gaps"} escalated (${isPostpartum ? "pre-discharge ≤ 48h" : "due ≤ 72h"})`
    );
  }
  if (deferredCount > 0) {
    transitionOutcomeSegments.push(`${deferredCount} safely deferred to postpartum`);
  }
  if (closedCount > 0) {
    transitionOutcomeSegments.push(`${closedCount} verified closed`);
  }
  transitionOutcomeSegments.push("0 patient identifiers sent to AI");

  return (
    <section className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      {/* Merged Value Proposition & Step Cue */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-teal-700">
            Detect. Carry forward. Verify.
          </p>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[11px] font-semibold text-teal-800"
            title={currentStepMeta.desc}
          >
            <CheckCircle2 className="h-3 w-3 text-teal-600" aria-hidden="true" />
            Step {activeStep}/6 · {currentStepMeta.label}
          </span>
        </div>
        <h1 className="mt-1 text-base font-semibold text-slate-900">
          Continuous reproductive care coordination across disconnected Abu Dhabi EMRs — zero
          clinical obligations lost at pregnancy or postpartum transitions.
        </h1>
      </div>

      {/* Compact Synthetic Patient Record & Transition Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-3.5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
            Synthetic Patient Record (Stored in Neon / UAE Boundary)
          </p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">
            {patient?.patient_name ?? "Amina Al-Mansoori (Synthetic)"}{" "}
            <span className="ml-2 font-mono text-xs font-normal text-slate-500">
              {activePatientId}
            </span>
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Current Life Stage:{" "}
            <span className="font-medium text-teal-700">{currentLifeStage}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {!isPostpartum && (
            <span className="hidden items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-800 sm:inline-flex">
              Next action
              <ArrowRight className="h-3 w-3 text-teal-600" aria-hidden="true" />
            </span>
          )}
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

      {/* 5-Second Post-Transition Takeaway Strip */}
      {(isAntenatal || isPostpartum) && obligations.length > 0 && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3.5 py-2.5 text-xs font-medium text-emerald-950"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>
              <strong className="font-semibold">
                {isPostpartum ? "Postpartum confirmed:" : "Pregnancy confirmed:"}
              </strong>{" "}
              {transitionOutcomeSegments.join(", ")}.
            </span>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Zero PHI Egress
          </span>
        </div>
      )}
    </section>
  );
}

export function CareSiteContinuitySpine({
  patient,
  isAntenatal,
  isPostpartum,
  obligations,
}: CareSiteContinuitySpineProps) {
  const activePatientId = patient?.patient_id ?? "PAT-AE-4092";
  const facilityStages = PATIENT_FACILITY_STAGES[activePatientId] ?? FACILITY_CONTINUITY_STAGES;
  const currentFacilityIdx = isPostpartum ? 2 : isAntenatal ? 1 : 0;

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      {/* Hero 3-Facility Care-Site Continuity Spine */}
      <div>
        <div className="mb-2.5 flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-slate-500">
            <Building2 className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            Cross-System Care Continuity Spine (1 Patient · 3 Disconnected EMRs)
          </span>
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {facilityStages.map((stage) => {
            const isDone = stage.stageIndex < currentFacilityIdx;
            const isCurrent = stage.stageIndex === currentFacilityIdx;

            // Map each obligation to its active facility stage (deferred items pre-stationed on Postpartum Stage 2)
            const siteObligations = obligations.filter((obl) => {
              if (obl.status === "DEFERRED_TO_POSTPARTUM") {
                return stage.stageIndex === 2;
              }
              return stage.stageIndex === currentFacilityIdx;
            });

            return (
              <li
                key={stage.dayTag}
                className={`flex flex-col justify-between rounded-xl border p-3.5 transition ${
                  isCurrent
                    ? "border-teal-300 bg-teal-50/70 ring-1 ring-teal-500/20"
                    : isDone
                      ? "border-emerald-200 bg-emerald-50/40"
                      : "border-slate-200 bg-slate-50/80"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-mono font-semibold text-slate-600">
                      {stage.dayTag}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        isCurrent
                          ? "bg-teal-600 text-white"
                          : isDone
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-200/80 text-slate-600"
                      }`}
                    >
                      {isDone && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                      {isCurrent
                        ? "Active Care Site"
                        : isDone
                          ? "Completed"
                          : siteObligations.length > 0
                            ? "Queued Handoff"
                            : "Upcoming"}
                    </span>
                  </div>

                  <p className="mt-1.5 text-sm font-semibold text-slate-900">
                    {stage.facility}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                    {stage.emrSystem}
                  </p>
                </div>

                {siteObligations.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-slate-200/60 pt-2">
                    {siteObligations.map((obl) => {
                      const isDeferred = obl.status === "DEFERRED_TO_POSTPARTUM";
                      const isEscalated = obl.status === "ESCALATED_FOR_REVIEW";
                      const isClosed = obl.status === "VERIFIED_CLOSED";

                      return (
                        <span
                          key={obl.id}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                            isClosed
                              ? "border-emerald-200 bg-white text-emerald-800"
                              : isEscalated
                                ? "border-rose-200 bg-rose-50 text-rose-800"
                                : isDeferred
                                  ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                                  : "border-slate-200 bg-white text-slate-700"
                          }`}
                        >
                          <span>{obl.id}</span>
                          <span className="font-sans font-medium">
                            {isClosed
                              ? "Verified"
                              : isEscalated
                                ? "Urgent"
                                : isDeferred
                                  ? "Deferred"
                                  : "Active"}
                          </span>
                        </span>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Single-Line Hybrid Safety Summary */}
      {!isPostpartum && (
        <p className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <Lock className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
          <span>
            <strong className="font-semibold text-slate-800">Hybrid Safety Guarantee:</strong>{" "}
            Deterministic local rules decide all escalations and deferrals; external AI sees 0 PHI and never diagnoses, prescribes, or closes obligations.
          </span>
        </p>
      )}
    </section>
  );
}
