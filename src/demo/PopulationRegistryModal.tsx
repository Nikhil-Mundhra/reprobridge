import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, Building2, Check, ChevronLeft, ChevronRight, Search, Users, X } from "lucide-react";
import { handleSpatialKeyDown } from "../spatialNav";
import type { CohortTotals, PatientCohortSummary } from "./types";

type TriageFilter = "ALL" | "urgent" | "open" | "deferred" | "closed";
type SortColumn = "name" | "stage" | "gaps";
type SortDirection = "ascending" | "descending";

interface PopulationRegistryModalProps {
  isOpen: boolean;
  initialTriage?: TriageFilter;
  patients: PatientCohortSummary[];
  cohortTotals?: CohortTotals;
  selectedPatientId: string;
  onSelectPatient: (patientId: string) => void;
  onClose: () => void;
}

const PAGE_SIZE = 10;
const textCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

let cachedDisplaySupport: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (cachedDisplaySupport !== undefined) return cachedDisplaySupport;
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  cachedDisplaySupport = getComputedStyle(probe).display === "block";
  probe.remove();
  return cachedDisplaySupport;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.CSS?.supports?.("overlay", "auto")) &&
    canTransitionDisplay()
  );
}

async function closeDialogWithAnimation(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((resolve) => window.setTimeout(resolve, 350)),
      ]);
    }
    if (!dialog.hasAttribute("data-closing")) return;
    dialog.removeAttribute("data-closing");
  }
  if (dialog.open) {
    dialog.close();
  }
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

function stageSortOrder(lifeStage: string): number {
  const lowered = lifeStage.toLowerCase();
  if (lowered === "postpartum") return 0;
  if (lowered.startsWith("antenatal")) return 1;
  return 2;
}

export default function PopulationRegistryModal({
  isOpen,
  initialTriage = "ALL",
  patients,
  cohortTotals,
  selectedPatientId,
  onSelectPatient,
  onClose,
}: PopulationRegistryModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const captionId = useId();

  const [searchQuery, setSearchQuery] = useState("");
  const [triageFilter, setTriageFilter] = useState<TriageFilter>("ALL");
  const [stageFilter, setStageFilter] = useState<"ALL" | "Preconception" | "Antenatal" | "Postpartum">("ALL");
  const [sortColumn, setSortColumn] = useState<SortColumn>("gaps");
  const [sortDirection, setSortDirection] = useState<SortDirection>("descending");
  const [sortAnnouncement, setSortAnnouncement] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setTriageFilter(initialTriage);
      setPage(0);
    }
  }, [isOpen, initialTriage]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.removeAttribute("data-closing");
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      void closeDialogWithAnimation(dialog);
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };

    const handleCancel = (event: Event) => {
      event.preventDefault();
      void closeDialogWithAnimation(dialog);
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);

    let cleanupLightDismiss: (() => void) | undefined;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          void closeDialogWithAnimation(dialog);
        }
        pressedOutside = false;
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      cleanupLightDismiss = () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
      cleanupLightDismiss?.();
    };
  }, [onClose]);

  const totals: CohortTotals = useMemo(() => {
    if (cohortTotals) return cohortTotals;
    return {
      total_patients: patients.length,
      total_open: patients.reduce((acc, p) => acc + p.open_count, 0),
      total_urgent: patients.reduce((acc, p) => acc + p.urgent_count, 0),
      total_deferred: patients.reduce((acc, p) => acc + p.deferred_count, 0),
      total_closed: patients.reduce((acc, p) => acc + p.closed_count, 0),
    };
  }, [cohortTotals, patients]);

  const filteredAndSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = patients.filter((p) => {
      if (q) {
        const haystack = [
          p.patient_id,
          p.patient_name,
          p.clinical_track,
          p.facility_a,
          p.facility_b,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      if (stageFilter !== "ALL") {
        if (!p.life_stage.toLowerCase().startsWith(stageFilter.toLowerCase())) return false;
      }

      if (triageFilter === "urgent" && p.urgent_count <= 0) return false;
      if (triageFilter === "open" && p.open_count <= 0) return false;
      if (triageFilter === "deferred" && p.deferred_count <= 0) return false;
      if (
        triageFilter === "closed" &&
        !(p.total_obligations > 0 && p.closed_count === p.total_obligations)
      ) {
        return false;
      }

      return true;
    });

    const factor = sortDirection === "ascending" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortColumn === "name") {
        return factor * textCollator.compare(a.patient_name, b.patient_name);
      }
      if (sortColumn === "stage") {
        const diff = stageSortOrder(a.life_stage) - stageSortOrder(b.life_stage);
        return diff !== 0 ? factor * diff : textCollator.compare(a.patient_name, b.patient_name);
      }
      const aScore = a.urgent_count * 1000 + a.open_count * 10 + a.deferred_count;
      const bScore = b.urgent_count * 1000 + b.open_count * 10 + b.deferred_count;
      if (aScore !== bScore) return factor * (aScore - bScore);
      return textCollator.compare(a.patient_name, b.patient_name);
    });
  }, [patients, searchQuery, stageFilter, triageFilter, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const visibleRows = filteredAndSorted.slice(pageStart, pageStart + PAGE_SIZE);

  function handleToggleSort(column: SortColumn, label: string) {
    const nextDir: SortDirection =
      sortColumn === column
        ? sortDirection === "ascending"
          ? "descending"
          : "ascending"
        : column === "gaps"
          ? "descending"
          : "ascending";
    setSortColumn(column);
    setSortDirection(nextDir);
    setPage(0);
    setSortAnnouncement(`Sorted by ${label}, ${nextDir}, ${filteredAndSorted.length} patients`);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="rb-cohort-dialog"
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div className="flex max-h-[86dvh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
        {/* Header */}
        <header className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Users className="h-4 w-4 text-teal-700" aria-hidden="true" />
                <h2 id={titleId} className="text-base font-semibold text-slate-900">
                  Population Registry
                </h2>
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[11px] font-medium text-teal-800">
                  {totals.total_patients} Synthetic UAE Patients
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Search, filter, and triage open preventive obligations across care sites without leaving the workbench.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (dialogRef.current) void closeDialogWithAnimation(dialogRef.current);
              }}
              aria-label="Close Population Registry"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Search & Filters */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <label className="relative min-w-[220px] flex-1">
              <span className="sr-only">Search patients by name, MRN, track, or facility</span>
              <Search
                className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(0);
                }}
                placeholder="Search name, MRN (PAT-AE-...), care track, or facility…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>

            <label className="sr-only" htmlFor="cohort-stage-filter">
              Filter by reproductive life stage
            </label>
            <select
              id="cohort-stage-filter"
              value={stageFilter}
              onChange={(e) => {
                setStageFilter(e.target.value as typeof stageFilter);
                setPage(0);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-teal-500 focus:outline-none"
            >
              <option value="ALL">All Stages</option>
              <option value="Preconception">Preconception</option>
              <option value="Antenatal">Antenatal</option>
              <option value="Postpartum">Postpartum</option>
            </select>
          </div>

          <div
            role="tablist"
            aria-label="Filter population cohort by triage bucket"
            onKeyDown={(e) => {
              handleSpatialKeyDown(e, '[role="tab"]', (next) => {
                const key = next.dataset.triage as TriageFilter | undefined;
                if (key) {
                  setTriageFilter(key);
                  setPage(0);
                }
              });
            }}
            className="mt-2.5 flex flex-wrap gap-1.5 text-xs"
          >
            {(
              [
                { key: "ALL", label: `All (${totals.total_patients})` },
                { key: "urgent", label: `Urgent (${totals.total_urgent})` },
                { key: "open", label: `Open Gaps (${totals.total_open})` },
                { key: "deferred", label: `Deferred (${totals.total_deferred})` },
                { key: "closed", label: "Completed" },
              ] as const
            ).map((item) => {
              const active = triageFilter === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  data-triage={item.key}
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => {
                    setTriageFilter(item.key);
                    setPage(0);
                  }}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 ${
                    active
                      ? "bg-teal-600 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* Scrollable Sortable Table */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <span role="status" className="rb-visually-hidden-live">
            {sortAnnouncement}
          </span>

          <div
            tabIndex={0}
            role="region"
            aria-labelledby={captionId}
            className="overflow-x-auto rounded-lg border border-slate-200"
          >
            <table className="rb-sortable-table w-full min-w-[640px] border-collapse text-left text-xs">
              <caption id={captionId} className="sr-only">
                Population cohort registry of synthetic maternal care patients
              </caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                <tr>
                  <th
                    scope="col"
                    aria-sort={sortColumn === "name" ? sortDirection : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleSort("name", "Patient")}
                    >
                      <span>Patient</span>
                      <ArrowUp className="rb-sort-icon h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortColumn === "stage" ? sortDirection : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleSort("stage", "Life Stage")}
                    >
                      <span>Life Stage</span>
                      <ArrowUp className="rb-sort-icon h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Care Track &amp; Sites
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortColumn === "gaps" ? sortDirection : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleSort("gaps", "Open Gaps")}
                    >
                      <span>Obligation Status</span>
                      <ArrowUp className="rb-sort-icon h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </th>
                  <th scope="col" className="px-3 py-2 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                      No patients match the current search or triage filters.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((p) => {
                    const isActive = p.patient_id === selectedPatientId;
                    return (
                      <tr
                        key={p.patient_id}
                        className={
                          isActive
                            ? "bg-teal-50/70"
                            : "bg-white transition-colors hover:bg-slate-50"
                        }
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-semibold text-slate-900">{p.patient_name}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-slate-500">
                            {p.patient_id} · {p.age_sex}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${lifeStageBadgeStyle(
                              p.life_stage
                            )}`}
                          >
                            {p.life_stage}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-teal-900">{p.clinical_track}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                            <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>
                              {p.facility_a} → {p.facility_b}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1 text-[10px]">
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
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectPatient(p.patient_id);
                              if (dialogRef.current) void closeDialogWithAnimation(dialogRef.current);
                            }}
                            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${
                              isActive
                                ? "border border-teal-300 bg-teal-100 text-teal-900"
                                : "bg-teal-600 text-white hover:bg-teal-700"
                            }`}
                          >
                            {isActive && <Check className="h-3 w-3" aria-hidden="true" />}
                            {isActive ? "Active" : "Open Workspace"}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Footer */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-2.5 text-xs text-slate-600">
          <span>
            Showing{" "}
            <span className="font-semibold text-slate-900">
              {filteredAndSorted.length === 0 ? 0 : pageStart + 1}–
              {Math.min(pageStart + PAGE_SIZE, filteredAndSorted.length)}
            </span>{" "}
            of <span className="font-semibold text-slate-900">{filteredAndSorted.length}</span>{" "}
            matching patients
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((prev) => Math.max(0, prev - 1))}
              disabled={safePage === 0}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-45"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Previous
            </button>
            <span className="px-1.5 font-mono text-[11px] text-slate-500">
              Page {safePage + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((prev) => Math.min(totalPages - 1, prev + 1))}
              disabled={safePage >= totalPages - 1}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-45"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
