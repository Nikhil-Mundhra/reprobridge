import { Users } from "lucide-react";
import { handleSpatialKeyDown } from "../spatialNav";
import type { PatientCohortSummary } from "./types";

interface PatientCohortBarProps {
  patients: PatientCohortSummary[];
  selectedPatientId: string;
  loading: boolean;
  onSelectPatient: (patientId: string) => void;
}

function lifeStageBadgeStyle(lifeStage: string): string {
  if (lifeStage === "Postpartum") {
    return "border-indigo-200 bg-indigo-50 text-indigo-800";
  }
  if (lifeStage.startsWith("Antenatal")) {
    return "border-teal-200 bg-teal-50 text-teal-800";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export default function PatientCohortBar({
  patients,
  selectedPatientId,
  loading,
  onSelectPatient,
}: PatientCohortBarProps) {
  const totalOpen = patients.reduce((acc, p) => acc + p.open_count, 0);
  const totalUrgent = patients.reduce((acc, p) => acc + p.urgent_count, 0);

  return (
    <section
      aria-label="Population Cohort Switcher"
      className="border-b border-slate-200/80 bg-slate-100/60"
    >
      <div className="mx-auto max-w-5xl px-6 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Users className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Population Cohort ({patients.length} Synthetic UAE Patients)
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-medium">
              {totalOpen} Open Gaps
            </span>
            {totalUrgent > 0 && (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-800">
                {totalUrgent} Urgent
              </span>
            )}
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Select synthetic patient workspace"
          onKeyDown={(e) => {
            handleSpatialKeyDown(e, '[role="tab"]', (next) => {
              const pid = next.dataset.patientId;
              if (pid && !loading) onSelectPatient(pid);
            });
          }}
          className="mt-2.5 grid gap-2.5 md:grid-cols-3"
        >
          {patients.map((p) => {
            const isSelected = p.patient_id === selectedPatientId;
            return (
              <button
                key={p.patient_id}
                type="button"
                role="tab"
                data-patient-id={p.patient_id}
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                disabled={loading}
                onClick={() => onSelectPatient(p.patient_id)}
                className={`rounded-xl border p-3 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 disabled:opacity-60 ${
                  isSelected
                    ? "border-teal-500 bg-white shadow-xs ring-2 ring-teal-500/20"
                    : "border-slate-200/90 bg-white/80 hover:border-teal-300 hover:bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-slate-900">
                      {p.patient_name}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                      {p.patient_id} · {p.age_sex}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${lifeStageBadgeStyle(
                      p.life_stage
                    )}`}
                  >
                    {p.life_stage}
                  </span>
                </div>

                <p className="mt-1.5 truncate text-[11px] font-medium text-teal-800">
                  {p.clinical_track}
                </p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                    {p.open_count} Open
                  </span>
                  {p.urgent_count > 0 && (
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800">
                      {p.urgent_count} Urgent
                    </span>
                  )}
                  {p.deferred_count > 0 && (
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-800">
                      {p.deferred_count} Deferred
                    </span>
                  )}
                  {p.closed_count > 0 && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">
                      {p.closed_count} Closed
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
