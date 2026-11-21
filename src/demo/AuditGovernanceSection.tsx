import { useState } from "react";
import { ClipboardList, Download } from "lucide-react";
import { AUDIT_EVENT_META } from "./constants";
import type { AuditEvent } from "./types";

interface AuditGovernanceSectionProps {
  auditEvents: AuditEvent[];
  residencyPolicy?: string;
}

export default function AuditGovernanceSection({
  auditEvents,
  residencyPolicy,
}: AuditGovernanceSectionProps) {
  const [auditTypeFilter, setAuditTypeFilter] = useState<string>("ALL");
  const [auditOblFilter, setAuditOblFilter] = useState<string>("ALL");

  const obligationIds = Array.from(
    new Set(
      auditEvents
        .map((e) => e.obligation_id)
        .filter((id): id is string => Boolean(id))
    )
  ).sort();

  const filteredEvents = auditEvents.filter((ev) => {
    if (auditTypeFilter !== "ALL") {
      const cat = AUDIT_EVENT_META[ev.event_type]?.category ?? "intake";
      if (cat !== auditTypeFilter) return false;
    }
    if (auditOblFilter !== "ALL" && ev.obligation_id !== auditOblFilter) {
      return false;
    }
    return true;
  });

  const handleExportAudit = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exported_at: new Date().toISOString(),
            residency_policy: residencyPolicy ?? "UAE_PHI_LOCAL_ONLY",
            count: filteredEvents.length,
            audit_events: filteredEvents,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reprobridge-audit-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-slate-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
            Auditable Governance Log ({filteredEvents.length}
            {filteredEvents.length !== auditEvents.length
              ? ` of ${auditEvents.length}`
              : ""}
            )
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="sr-only" htmlFor="audit-type-filter">
            Filter log by event type
          </label>
          <select
            id="audit-type-filter"
            value={auditTypeFilter}
            onChange={(e) => setAuditTypeFilter(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-teal-500 focus:outline-none"
          >
            <option value="ALL">All Events</option>
            <option value="safety">Safety Guard Blocks</option>
            <option value="closure">Clinician Closures</option>
            <option value="transition">Life-Stage Rules</option>
            <option value="ai">AI Briefs (0 PHI)</option>
            <option value="intake">FHIR / Evidence Intake</option>
          </select>

          {obligationIds.length > 0 && (
            <>
              <label className="sr-only" htmlFor="audit-obl-filter">
                Filter log by obligation
              </label>
              <select
                id="audit-obl-filter"
                value={auditOblFilter}
                onChange={(e) => setAuditOblFilter(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-700 focus:border-teal-500 focus:outline-none"
              >
                <option value="ALL">All Obligations</option>
                {obligationIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            type="button"
            onClick={handleExportAudit}
            disabled={filteredEvents.length === 0}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export JSON
          </button>
        </div>
      </div>

      {filteredEvents.length === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          No governance events match the selected filters.
        </p>
      ) : (
        <ol className="relative mt-4 space-y-0 border-l border-slate-200 pl-5 text-xs">
          {filteredEvents.map((ev) => {
            const meta = AUDIT_EVENT_META[ev.event_type] ?? {
              label: ev.event_type,
              dot: "bg-slate-400",
              tag: "bg-slate-100 text-slate-700 border-slate-200",
              category: "intake" as const,
            };
            const dt = new Date(ev.created_at);

            return (
              <li
                key={ev.id}
                className="relative grid grid-cols-[1fr_auto] items-start gap-x-4 border-b border-slate-100 py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-white ${meta.dot}`}
                />

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${meta.tag}`}
                    >
                      {meta.label}
                    </span>
                    {ev.obligation_id && (
                      <span className="font-mono text-[11px] font-semibold text-slate-500">
                        {ev.obligation_id}
                      </span>
                    )}
                    <span className="font-medium text-slate-800">{ev.actor}</span>
                  </div>
                  <p className="mt-1 leading-relaxed text-slate-600">{ev.summary}</p>
                </div>

                <time
                  dateTime={dt.toISOString()}
                  title={dt.toLocaleString()}
                  className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-slate-400"
                >
                  {dt.toLocaleTimeString()}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
