import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Database,
  FileText,
  Lock,
  Network,
  ShieldCheck,
} from "lucide-react";
import type { HealthResponse } from "./types";

interface DemoTopBarProps {
  health: HealthResponse | null;
  totalClinicalDocCount: number;
  connectedIntegrationCount?: number;
  onBackToTutorial: () => void;
  onOpenClinicalDocuments: () => void;
  onOpenIntegrations?: () => void;
}

export default function DemoTopBar({
  health,
  totalClinicalDocCount,
  connectedIntegrationCount = 4,
  onBackToTutorial,
  onOpenClinicalDocuments,
  onOpenIntegrations,
}: DemoTopBarProps) {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusPopoverId = useId();
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusPopoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const popover = statusPopoverRef.current;
    if (!popover) return;
    const onToggle = (event: Event) => {
      const nextOpen = (event as ToggleEvent).newState === "open";
      setStatusMenuOpen(nextOpen);
      if (
        nextOpen &&
        statusTriggerRef.current &&
        !window.CSS?.supports?.("position-area", "block-end")
      ) {
        const triggerRect = statusTriggerRef.current.getBoundingClientRect();
        const popRect = popover.getBoundingClientRect();
        const gap = 8;
        let top = triggerRect.bottom + gap;
        if (top + popRect.height > window.innerHeight - 12) {
          top = Math.max(12, triggerRect.top - popRect.height - gap);
        }
        const rawLeft = triggerRect.right - popRect.width;
        const left = Math.max(12, Math.min(rawLeft, window.innerWidth - popRect.width - 12));
        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
      }
    };
    popover.addEventListener("toggle", onToggle);
    return () => popover.removeEventListener("toggle", onToggle);
  }, []);

  return (
    <header className="rb-demo-topbar border-b border-slate-200/90 bg-white/95 backdrop-blur-xs">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={onBackToTutorial}
            aria-label="Back to Tutorial"
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Tutorial</span>
          </button>
          <span className="h-4 w-px shrink-0 bg-slate-200" aria-hidden="true" />
          <img
            src="/reprobridge-logo-full.png"
            alt="ReproBridge — Connected care for women"
            width={272}
            height={84}
            className="h-14 w-auto shrink-0 object-contain"
          />
        </div>

        <nav aria-label="Workspace controls" className="flex shrink-0 items-center gap-2">
          <div>
            <button
              ref={statusTriggerRef}
              type="button"
              aria-expanded={statusMenuOpen}
              aria-controls={statusPopoverId}
              popoverTarget={statusPopoverId}
              popoverTargetAction="toggle"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  health?.database.connected ? "bg-emerald-500" : "bg-amber-500"
                }`}
                aria-hidden="true"
              />
              <span>{health?.database.connected ? "UAE Local · Live" : "UAE Local · Demo"}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                  statusMenuOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            <div
              ref={statusPopoverRef}
              id={statusPopoverId}
              className="rb-status-popover"
              popover="auto"
            >
              <div className="w-72 rounded-xl border border-slate-200 bg-white p-3.5 text-xs shadow-lg">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Environment & Governance
                </p>
                <ul className="mt-2.5 space-y-2.5">
                  <li className="flex items-start gap-2.5">
                    <ShieldCheck
                      className="mt-0.5 h-4 w-4 shrink-0 text-teal-600"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium text-slate-900">Malaffi HIE · HL7 FHIR R4</p>
                      <p className="text-[11px] text-slate-500">
                        Epic, Oracle Health & Abu Dhabi HIE layer
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Lock
                      className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600"
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium text-slate-900">UAE PHI Local-Only</p>
                      <p className="text-[11px] text-slate-500">
                        Pre-egress de-identification firewall active
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Database
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        health?.database.connected ? "text-emerald-600" : "text-amber-600"
                      }`}
                      aria-hidden="true"
                    />
                    <div>
                      <p className="font-medium text-slate-900">
                        {health?.database.connected
                          ? `Neon Postgres (${health.database.branch ?? "production"})`
                          : "Synthetic Fallback Store"}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {health?.database.detail ?? "Checking persistence status..."}
                      </p>
                    </div>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {onOpenIntegrations && (
            <button
              type="button"
              onClick={onOpenIntegrations}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-950"
              title="Open HIE & EMR Integrations Hub (Malaffi, Oracle Health, Epic, Nabidh)"
            >
              <Network className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
              <span>Integrations</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                {connectedIntegrationCount}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenClinicalDocuments}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-900"
            title="Open clinician-only synthetic source documents (excluded from AI egress)"
          >
            <FileText className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            <span>Docs</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
              {totalClinicalDocCount}
            </span>
          </button>
        </nav>
      </div>
    </header>
  );
}
