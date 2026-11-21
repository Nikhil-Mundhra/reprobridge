import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Users } from "lucide-react";
import PopulationRegistryModal from "./PopulationRegistryModal";
import type { CohortTotals, PatientCohortSummary } from "./types";

interface PatientCohortBarProps {
  patients: PatientCohortSummary[];
  cohortTotals?: CohortTotals;
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
  cohortTotals,
  selectedPatientId,
  loading,
  onSelectPatient,
}: PatientCohortBarProps) {
  const [registryOpen, setRegistryOpen] = useState(false);
  const [initialTriage, setInitialTriage] = useState<
    "ALL" | "urgent" | "open" | "deferred" | "closed"
  >("ALL");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const target = e.target as HTMLElement | null;
        if (target && target.matches(':read-write, select, textarea, input')) return;
        e.preventDefault();
        setInitialTriage("ALL");
        setRegistryOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const totals: CohortTotals = cohortTotals ?? {
    total_patients: patients.length,
    total_open: patients.reduce((acc, p) => acc + p.open_count, 0),
    total_urgent: patients.reduce((acc, p) => acc + p.urgent_count, 0),
    total_deferred: patients.reduce((acc, p) => acc + p.deferred_count, 0),
    total_closed: patients.reduce((acc, p) => acc + p.closed_count, 0),
  };

  const activeIdx = Math.max(
    0,
    patients.findIndex((p) => p.patient_id === selectedPatientId)
  );
  const activePatient = patients[activeIdx] ?? patients[0];
  const hasMultiple = patients.length > 1;

  function stepPatient(delta: -1 | 1) {
    if (!hasMultiple || loading) return;
    const nextIdx = (activeIdx + delta + patients.length) % patients.length;
    onSelectPatient(patients[nextIdx].patient_id);
  }

  function openRegistry(triage: typeof initialTriage = "ALL") {
    setInitialTriage(triage);
    setRegistryOpen(true);
  }

  return (
    <>
      <section
        aria-label="Population Cohort Switcher"
        className="border-b border-slate-200/80 bg-slate-100/70"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2.5 px-6 py-2">
          {/* Active Patient Switcher + Prev/Next Stepper */}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => openRegistry("ALL")}
              className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs shadow-2xs transition hover:border-teal-400 hover:bg-teal-50/50 disabled:opacity-60"
            >
              <Users className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />
              <span className="truncate font-semibold text-slate-900">
                {activePatient?.patient_name ?? "Amina Al-Mansoori (Synthetic)"}
              </span>
              <span className="hidden font-mono text-[11px] text-slate-500 sm:inline">
                {activePatient?.patient_id ?? selectedPatientId}
              </span>
              {activePatient && (
                <span
                  className={`hidden rounded-full border px-2 py-0.5 text-[10px] font-medium md:inline ${lifeStageBadgeStyle(
                    activePatient.life_stage
                  )}`}
                >
                  {activePatient.life_stage}
                </span>
              )}
              {activePatient && (
                <span className="hidden truncate text-[11px] font-medium text-teal-800 lg:inline">
                  · {activePatient.clinical_track}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                Switch Patient
                <kbd className="hidden font-mono text-[9px] text-slate-500 sm:inline">⌘K</kbd>
                <ChevronDown className="h-3 w-3 text-slate-500" aria-hidden="true" />
              </span>
            </button>

            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
              <button
                type="button"
                disabled={!hasMultiple || loading}
                onClick={() => stepPatient(-1)}
                aria-label="Previous patient"
                title="Previous patient"
                className="rounded p-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <span className="px-1.5 font-mono text-[10px] tabular-nums text-slate-500">
                {patients.length > 0 ? `${activeIdx + 1}/${patients.length}` : "0/0"}
              </span>
              <button
                type="button"
                disabled={!hasMultiple || loading}
                onClick={() => stepPatient(1)}
                aria-label="Next patient"
                title="Next patient"
                className="rounded p-1 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Clickable Cohort Triage Pills */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={() => openRegistry("ALL")}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium text-slate-700 transition hover:border-teal-300 hover:bg-teal-50"
            >
              {totals.total_patients} Patients
            </button>
            <button
              type="button"
              onClick={() => openRegistry("open")}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-medium text-slate-700 transition hover:border-teal-300 hover:bg-teal-50"
            >
              {totals.total_open} Open
            </button>
            {totals.total_urgent > 0 && (
              <button
                type="button"
                onClick={() => openRegistry("urgent")}
                className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-semibold text-rose-800 transition hover:bg-rose-100"
              >
                {totals.total_urgent} Urgent
              </button>
            )}
            {totals.total_deferred > 0 && (
              <button
                type="button"
                onClick={() => openRegistry("deferred")}
                className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-800 transition hover:bg-indigo-100"
              >
                {totals.total_deferred} Deferred
              </button>
            )}
          </div>
        </div>
      </section>

      <PopulationRegistryModal
        isOpen={registryOpen}
        initialTriage={initialTriage}
        patients={patients}
        cohortTotals={totals}
        selectedPatientId={selectedPatientId}
        onSelectPatient={onSelectPatient}
        onClose={() => setRegistryOpen(false)}
      />
    </>
  );
}
