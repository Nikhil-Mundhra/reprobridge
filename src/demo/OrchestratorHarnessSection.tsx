import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  FileCheck2,
  Info,
  Lock,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { handleSpatialKeyDown } from "../spatialNav";
import {
  INTERIM_TIPS,
  PRIORITY_STYLES,
  STATUS_STYLES,
  TRACE_NODE_META,
} from "./constants";
import {
  detectObligationId,
  formatExecutionLabel,
  parseHandoffItems,
} from "./helpers";
import type { AiMetadata, Obligation, PrivacyReport, TraceStep } from "./types";

interface OrchestratorHarnessSectionProps {
  isStreaming: boolean;
  streamingPhase: string | null;
  streamingModel: string | null;
  streamTokenCount: number;
  streamDurationMs: number | null;
  activeTransitionKind: "pregnancy" | "postpartum";
  agentSummary: string | null;
  specialistHandoff: string | null;
  onUpdateSpecialistHandoff: (next: string) => void;
  displaySummary: string | null;
  displayHandoff: string | null;
  aiMetadata: AiMetadata | null;
  privacyReport: PrivacyReport | null;
  trace: TraceStep[];
  obligations: Obligation[];
  patient: Obligation | undefined;
  loading: boolean;
  onRunTransition: (
    endpoint: "/api/transitions/pregnancy" | "/api/transitions/postpartum"
  ) => void;
  onOpenFhirExport: () => void;
  onOpenVerifyModal: (obl: Obligation) => void;
}

export default function OrchestratorHarnessSection({
  isStreaming,
  streamingPhase,
  streamingModel,
  streamTokenCount,
  streamDurationMs,
  activeTransitionKind,
  agentSummary,
  specialistHandoff,
  onUpdateSpecialistHandoff,
  displaySummary,
  displayHandoff,
  aiMetadata,
  privacyReport,
  trace,
  obligations,
  patient,
  loading,
  onRunTransition,
  onOpenFhirExport,
  onOpenVerifyModal,
}: OrchestratorHarnessSectionProps) {
  const handoffCopyId = useId();
  const copyTimerRef = useRef<number | null>(null);
  const lastCopyMsgRef = useRef<string>("");

  const [showPayload, setShowPayload] = useState(false);
  const [privacyTab, setPrivacyTab] = useState<"outbound" | "redacted">("outbound");
  const [selectedTraceNode, setSelectedTraceNode] = useState<string | null>(null);
  const [focusedTraceIndex, setFocusedTraceIndex] = useState(0);
  const [focusedHandoffIndex, setFocusedHandoffIndex] = useState(0);
  const [checkedHandoff, setCheckedHandoff] = useState<Record<number, boolean>>({});
  const [isEditingHandoff, setIsEditingHandoff] = useState(false);
  const [handoffDraft, setHandoffDraft] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const [tipIndex, setTipIndex] = useState(0);
  const [tipsPaused, setTipsPaused] = useState(false);

  useEffect(() => {
    if (isStreaming) {
      setCheckedHandoff({});
      setIsEditingHandoff(false);
      setSelectedTraceNode(null);
      setTipIndex(0);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (!privacyReport) {
      setShowPayload(false);
    }
  }, [privacyReport]);

  useEffect(() => {
    if (!isStreaming || tipsPaused) return;
    const tips = INTERIM_TIPS[activeTransitionKind];
    const timer = window.setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [isStreaming, tipsPaused, activeTransitionKind]);

  useEffect(() => {
    if (!selectedTraceNode) return;
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector('[role="dialog"], dialog[open]')) return;
      setSelectedTraceNode(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [selectedTraceNode]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function handleCopyHandoff(targetText: string) {
    if (!targetText.trim()) return;
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    let ok = false;
    try {
      await navigator.clipboard.writeText(targetText.trim());
      ok = true;
    } catch {
      ok = false;
    }
    let message = ok ? "Copied" : "Copy failed";
    if (message === lastCopyMsgRef.current) message += "\u00A0";
    lastCopyMsgRef.current = message;
    setCopyState(ok ? "copied" : "failed");
    setCopyAnnouncement("");
    requestAnimationFrame(() => setCopyAnnouncement(message));
    copyTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      setCopyAnnouncement("");
    }, 2000);
  }

  const showHarnessPanel = isStreaming || Boolean(agentSummary);
  if (!showHarnessPanel) return null;

  const currentTip = INTERIM_TIPS[activeTransitionKind][tipIndex] ?? INTERIM_TIPS.pregnancy[0];

  return (
    <section
      id="hybrid-care-resolution-harness"
      aria-live="polite"
      aria-busy={isStreaming}
      className="scroll-mt-16 space-y-4 rounded-xl border border-teal-200 bg-teal-50 p-5 text-sm text-teal-950"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {/* Floating agent avatar that reacts while thinking/streaming */}
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
              isStreaming
                ? "rb-float-avatar border-teal-300 bg-white shadow-xs"
                : "border-teal-200 bg-white"
            }`}
          >
            <img
              src="/reprobridge-mark.png"
              alt=""
              width={26}
              height={26}
              className="h-6.5 w-6.5 object-contain"
            />
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

        <div className="flex flex-wrap items-center gap-2">
          {!isStreaming && agentSummary && (
            <button
              type="button"
              onClick={() =>
                onRunTransition(
                  activeTransitionKind === "postpartum"
                    ? "/api/transitions/postpartum"
                    : "/api/transitions/pregnancy"
                )
              }
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-white px-2.5 py-1 text-[11px] font-medium text-teal-800 transition hover:bg-teal-100/60 disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerate Brief
            </button>
          )}
        </div>
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

      {/* Interactive Specialist Handoff — checkable bullets, quick verify, inline edit, accessible copy */}
      {displayHandoff ? (
        (() => {
          const handoffItems = parseHandoffItems(displayHandoff);
          const checkedCount = handoffItems.filter((_, i) => checkedHandoff[i]).length;

          return (
            <div className="rounded-lg border border-teal-200 bg-white p-3.5 text-xs text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold uppercase tracking-wider text-teal-700">
                    Draft Specialist Handoff (Pending Clinician Approval)
                  </p>
                  {!isStreaming && handoffItems.length > 0 && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-800">
                      {checkedCount} / {handoffItems.length} reviewed
                    </span>
                  )}
                </div>

                {!isStreaming && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onOpenFhirExport}
                      className="inline-flex min-h-6 min-w-6 items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-800 transition hover:bg-indigo-100"
                    >
                      <Send className="h-3 w-3" aria-hidden="true" />
                      Push to EMR (FHIR R4)
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!isEditingHandoff) {
                          setHandoffDraft(specialistHandoff ?? displayHandoff);
                          setIsEditingHandoff(true);
                        } else {
                          setIsEditingHandoff(false);
                        }
                      }}
                      className="inline-flex min-h-6 min-w-6 items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      <Pencil className="h-3 w-3" aria-hidden="true" />
                      {isEditingHandoff ? "Cancel Edit" : "Edit Draft"}
                    </button>

                    <span className="relative inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyHandoff(
                            isEditingHandoff ? handoffDraft : displayHandoff
                          )
                        }
                        data-copied={copyState === "copied" ? "" : undefined}
                        data-failed={copyState === "failed" ? "" : undefined}
                        className="inline-flex min-h-6 min-w-6 items-center gap-1 rounded border border-teal-200 bg-teal-50/70 px-2 py-1 text-[11px] font-medium text-teal-800 transition hover:bg-teal-100"
                      >
                        {copyState === "copied" ? (
                          <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3 w-3" aria-hidden="true" />
                        )}
                        Copy Handoff
                      </button>
                      <span
                        role="status"
                        className={`text-[11px] font-medium transition-opacity duration-150 ${
                          copyState === "idle"
                            ? "pointer-events-none opacity-0"
                            : copyState === "failed"
                              ? "text-rose-700 opacity-100"
                              : "text-emerald-700 opacity-100"
                        }`}
                      >
                        {copyAnnouncement}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {isStreaming ? (
                <p
                  id={handoffCopyId}
                  className="mt-2 whitespace-pre-line leading-relaxed"
                >
                  {displayHandoff}
                  <span className="rb-stream-caret" aria-hidden="true" />
                </p>
              ) : isEditingHandoff ? (
                <div className="mt-2.5 space-y-2">
                  <textarea
                    rows={4}
                    value={handoffDraft}
                    onChange={(e) => setHandoffDraft(e.target.value)}
                    aria-label="Edit specialist handoff draft"
                    className="w-full rounded-lg border border-teal-300 p-2.5 text-xs leading-relaxed text-slate-800 focus:border-teal-500 focus:outline-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingHandoff(false)}
                      className="rounded border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateSpecialistHandoff(handoffDraft.trim());
                        setIsEditingHandoff(false);
                        setCheckedHandoff({});
                      }}
                      className="rounded bg-teal-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-700"
                    >
                      Save Clinician Draft
                    </button>
                  </div>
                </div>
              ) : (
                <ul
                  id={handoffCopyId}
                  role="listbox"
                  aria-label="Draft specialist handoff checklist"
                  aria-multiselectable="true"
                  onKeyDown={(e) => {
                    handleSpatialKeyDown(e, '[role="option"]', (next) => {
                      const idxAttr = Number(next.dataset.handoffIndex);
                      if (!Number.isNaN(idxAttr)) setFocusedHandoffIndex(idxAttr);
                    });
                  }}
                  className="mt-2.5 space-y-2"
                >
                  {handoffItems.map((item, idx) => {
                    const checked = Boolean(checkedHandoff[idx]);
                    const oblId = detectObligationId(item);
                    const matchedObl = oblId
                      ? obligations.find((o) => o.id === oblId)
                      : undefined;
                    const canQuickVerify =
                      matchedObl &&
                      matchedObl.status !== "VERIFIED_CLOSED" &&
                      matchedObl.status !== "DEFERRED_TO_POSTPARTUM";

                    return (
                      <li
                        key={idx}
                        role="option"
                        aria-selected={checked}
                        data-handoff-index={idx}
                        tabIndex={idx === focusedHandoffIndex ? 0 : -1}
                        onFocus={() => setFocusedHandoffIndex(idx)}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setCheckedHandoff((prev) => ({
                              ...prev,
                              [idx]: !prev[idx],
                            }));
                          }
                        }}
                        className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border p-2.5 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                          checked
                            ? "border-emerald-200 bg-emerald-50/50"
                            : "border-slate-100 bg-slate-50/60"
                        }`}
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            tabIndex={-1}
                            checked={checked}
                            onChange={() =>
                              setCheckedHandoff((prev) => ({
                                ...prev,
                                [idx]: !prev[idx],
                              }))
                            }
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                          />
                          <span
                            className={`leading-relaxed ${
                              checked ? "text-slate-400 line-through" : "text-slate-700"
                            }`}
                          >
                            {item}
                          </span>
                        </label>

                        {canQuickVerify && matchedObl && (
                          <button
                            type="button"
                            onClick={() => onOpenVerifyModal(matchedObl)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-medium text-emerald-800 transition hover:bg-emerald-50"
                          >
                            <FileCheck2 className="h-3 w-3" aria-hidden="true" />
                            Verify {matchedObl.id}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })()
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

      {/* Compact Single-Row Technical Pipeline Strip (Expand Step Inspector on Click) */}
      {trace.length > 0 && (
        <div className="space-y-2.5">
          <div
            role="tablist"
            aria-label="Care-resolution workflow trace steps (use Arrow keys to move, Enter to inspect)"
            onKeyDown={(e) => {
              handleSpatialKeyDown(e, '[role="tab"]', (next) => {
                const idxAttr = Number(next.dataset.traceIndex);
                if (!Number.isNaN(idxAttr)) setFocusedTraceIndex(idxAttr);
              });
            }}
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            {trace.map((step, idx) => {
              const meta = TRACE_NODE_META[step.node] ?? {
                title: step.node.replaceAll("_", " "),
                accent: "border-t-teal-500",
                badge: "bg-teal-100 text-teal-800",
              };
              const exec = formatExecutionLabel(step.execution);
              const isSelected = selectedTraceNode === step.node;

              return (
                <button
                  key={step.node}
                  type="button"
                  role="tab"
                  id={`trace-tab-${step.node}`}
                  aria-selected={isSelected}
                  data-trace-index={idx}
                  title={step.detail}
                  tabIndex={
                    selectedTraceNode
                      ? isSelected
                        ? 0
                        : -1
                      : idx === focusedTraceIndex
                        ? 0
                        : -1
                  }
                  onFocus={() => setFocusedTraceIndex(idx)}
                  onClick={() => {
                    setFocusedTraceIndex(idx);
                    setSelectedTraceNode((prev) =>
                      prev === step.node ? null : step.node
                    );
                  }}
                  className={`flex items-center justify-between gap-2 rounded-lg border border-t-2 ${meta.accent} bg-white px-3 py-2 text-left text-xs shadow-xs transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                    isSelected
                      ? "border-teal-400 ring-2 ring-teal-500/25"
                      : "border-slate-200/90 hover:border-teal-300"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold ${meta.badge}`}
                    >
                      {idx + 1}
                    </span>
                    <span className="truncate font-semibold text-slate-900">
                      {meta.title}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${exec.className}`}
                  >
                    {exec.label}
                  </span>
                </button>
              );
            })}
            {isStreaming && trace.length === 3 && (
              <div
                title="synthesize_coordination_brief"
                className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-purple-300 border-t-2 border-t-purple-500 bg-white/90 px-3 py-2 text-xs shadow-xs"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 font-mono text-[10px] font-bold text-purple-800">
                    4
                  </span>
                  <span className="truncate font-semibold text-slate-900">
                    Synthesize Handoff Brief
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">
                  <progress aria-label="Streaming brief" className="rb-spinner" />
                  Streaming…
                </span>
              </div>
            )}
          </div>

          {/* Step Inspector Drawer */}
          {selectedTraceNode && (
            <div
              role="tabpanel"
              aria-labelledby={`trace-tab-${selectedTraceNode}`}
              className="rounded-xl border border-teal-200 bg-white p-4 text-xs text-slate-700 shadow-xs"
            >
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <span className="font-semibold text-slate-900">
                  {TRACE_NODE_META[selectedTraceNode]?.title ?? selectedTraceNode}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedTraceNode(null)}
                  aria-label="Close step inspector"
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 text-slate-600">
                {trace.find((s) => s.node === selectedTraceNode)?.detail}
              </p>

              {selectedTraceNode === "detect_open_obligations" && (
                <div className="mt-3 space-y-2.5">
                  <pre className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 font-mono text-[11px] text-teal-300">
                    {`SELECT id, rule_version, status FROM clinical_obligations WHERE status != 'VERIFIED_CLOSED'; -- ${obligations.filter((o) => o.status !== "VERIFIED_CLOSED").length} open row(s)`}
                  </pre>
                  <div className="flex flex-wrap gap-2">
                    {obligations.map((obl) => (
                      <span
                        key={obl.id}
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-700"
                      >
                        <strong className="text-slate-900">{obl.id}</strong>
                        <span className="text-slate-400">·</span>
                        <span>{obl.rule_version}</span>
                        <span className="text-slate-400">·</span>
                        <span className="text-teal-700">{obl.status}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedTraceNode === "evaluate_life_stage_transition" && (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 font-semibold">Obligation</th>
                        <th className="px-3 py-1.5 font-semibold">Rule Version</th>
                        <th className="px-3 py-1.5 font-semibold">Assigned Owner</th>
                        <th className="px-3 py-1.5 font-semibold">Outcome</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {obligations.map((obl) => (
                        <tr key={obl.id}>
                          <td className="px-3 py-1.5 font-mono font-semibold text-slate-900">
                            {obl.id}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-slate-600">
                            {obl.rule_version}
                          </td>
                          <td className="px-3 py-1.5 text-slate-700">{obl.owner}</td>
                          <td className="px-3 py-1.5">
                            <span
                              className={`mr-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                PRIORITY_STYLES[obl.priority] ?? "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {obl.priority}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                STATUS_STYLES[obl.status] ?? "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {obl.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedTraceNode === "apply_uae_privacy_firewall" && privacyReport && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-indigo-800">
                    case_token: <strong>{String(privacyReport.payload.case_token ?? "ANON-CASE")}</strong> ·{" "}
                    {privacyReport.redacted_fields.length} PHI fields stripped · assert_phi_free() passed
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowPayload(true);
                      setPrivacyTab("redacted");
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-800 hover:bg-indigo-100"
                  >
                    <Eye className="h-3 w-3" aria-hidden="true" />
                    View Redaction Diff Below
                  </button>
                </div>
              )}

              {selectedTraceNode === "synthesize_coordination_brief" && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-[11px] text-slate-600">
                    {aiMetadata
                      ? `${aiMetadata.provider} · ${aiMetadata.model.replace(/:free$/i, "")}`
                      : streamingModel
                        ? `openrouter · ${streamingModel.replace(/:free$/i, "")}`
                        : "openrouter"}
                    {streamTokenCount > 0 ? ` · ${streamTokenCount} chunks` : ""}
                    {streamDurationMs !== null ? ` · ${(streamDurationMs / 1000).toFixed(1)}s` : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setHandoffDraft(specialistHandoff ?? displayHandoff ?? "");
                      setIsEditingHandoff(true);
                      setSelectedTraceNode(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-800 hover:bg-teal-100"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    Edit Handoff Draft
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {privacyReport && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5 text-xs text-indigo-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 font-semibold text-indigo-900">
              <Lock className="h-3.5 w-3.5" />
              <span>UAE Data Residency Firewall — Zero PHI Sent Outside UAE</span>
              <span className="font-mono text-[10px] font-normal text-indigo-700">
                ({privacyReport.redacted_fields.length} PHI fields stripped)
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowPayload((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-1 text-[11px] font-medium text-indigo-800 hover:bg-indigo-50"
            >
              <Eye className="h-3 w-3" />
              {showPayload ? "Hide Redaction Diff" : "Inspect Before / After PHI Diff"}
            </button>
          </div>

          {showPayload && (
            <div className="mt-3 space-y-2.5 border-t border-indigo-200/70 pt-2.5">
              <div className="grid gap-3 sm:grid-cols-2">
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
              <div
                role="tablist"
                aria-label="PHI redaction inspection view"
                onKeyDown={(e) => {
                  handleSpatialKeyDown(e, '[role="tab"]', (next) => {
                    const tabKey = next.dataset.tab as "outbound" | "redacted" | undefined;
                    if (tabKey) setPrivacyTab(tabKey);
                  });
                }}
                className="inline-flex rounded-lg border border-indigo-200 bg-white p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  data-tab="outbound"
                  aria-selected={privacyTab === "outbound"}
                  tabIndex={privacyTab === "outbound" ? 0 : -1}
                  onClick={() => setPrivacyTab("outbound")}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 ${
                    privacyTab === "outbound"
                      ? "bg-emerald-600 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Outbound AI JSON (0 PHI)
                </button>
                <button
                  type="button"
                  role="tab"
                  data-tab="redacted"
                  aria-selected={privacyTab === "redacted"}
                  tabIndex={privacyTab === "redacted" ? 0 : -1}
                  onClick={() => setPrivacyTab("redacted")}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600 ${
                    privacyTab === "redacted"
                      ? "bg-indigo-600 text-white"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Stripped Locally (UAE-Only)
                </button>
              </div>

              {privacyTab === "outbound" ? (
                <pre className="overflow-x-auto rounded bg-slate-900 p-3 font-mono text-[11px] text-emerald-300">
                  {JSON.stringify(privacyReport.payload, null, 2)}
                </pre>
              ) : (
                <div className="rounded-lg border border-indigo-200 bg-white p-3 font-mono text-[11px]">
                  <p className="mb-2 font-sans text-[11px] font-medium text-indigo-900">
                    Blocked before egress — stayed inside Neon Postgres (UAE boundary):
                  </p>
                  <ul className="space-y-1.5">
                    <li className="flex flex-wrap items-center justify-between gap-2 rounded bg-rose-50/70 px-2.5 py-1">
                      <span className="text-slate-500">patient_name</span>
                      <span className="text-rose-700 line-through">
                        {patient?.patient_name ?? "Amina Al-Mansoori (Synthetic)"}
                      </span>
                    </li>
                    <li className="flex flex-wrap items-center justify-between gap-2 rounded bg-rose-50/70 px-2.5 py-1">
                      <span className="text-slate-500">patient_id</span>
                      <span className="text-rose-700 line-through">
                        {patient?.patient_id ?? "PAT-AE-4092"}
                      </span>
                    </li>
                    <li className="flex flex-wrap items-center justify-between gap-2 rounded bg-emerald-50/80 px-2.5 py-1">
                      <span className="text-slate-500">replaced with → case_token</span>
                      <span className="font-semibold text-emerald-800">
                        {String(privacyReport.payload.case_token ?? "ANON-CASE")}
                      </span>
                    </li>
                    {obligations.map((obl) => (
                      <li
                        key={obl.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded bg-rose-50/70 px-2.5 py-1"
                      >
                        <span className="text-slate-500">
                          {obl.id}.evidence_source
                        </span>
                        <span className="text-rose-700 line-through">
                          {obl.evidence_source}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
