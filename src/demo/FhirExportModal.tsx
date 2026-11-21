import { useEffect, useState } from "react";
import { Check, Copy, Download, X } from "lucide-react";
import { buildOutboundFhirBundle } from "./helpers";
import type { Obligation } from "./types";

interface FhirExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  obligations: Obligation[];
  currentLifeStage: string;
  displaySummary: string | null;
  displayHandoff: string | null;
}

export default function FhirExportModal({
  isOpen,
  onClose,
  obligations,
  currentLifeStage,
  displaySummary,
  displayHandoff,
}: FhirExportModalProps) {
  const [fhirCopyState, setFhirCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (!isOpen) setFhirCopyState("idle");
  }, [isOpen]);

  if (!isOpen) return null;

  const bundle = buildOutboundFhirBundle(
    obligations,
    currentLifeStage,
    displaySummary,
    displayHandoff
  );
  const bundleJson = JSON.stringify(bundle, null, 2);

  async function handleCopyFhirBundle(jsonText: string) {
    try {
      await navigator.clipboard.writeText(jsonText);
      setFhirCopyState("copied");
    } catch {
      setFhirCopyState("failed");
    }
    window.setTimeout(() => setFhirCopyState("idle"), 2000);
  }

  function handleDownloadFhirBundle(jsonText: string) {
    const blob = new Blob([jsonText], { type: "application/fhir+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reprobridge-fhir-r4-bundle-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fhir-export-modal-title"
    >
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">
              Bidirectional EMR Interoperability · SMART on FHIR / Malaffi HIE
            </p>
            <h3
              id="fhir-export-modal-title"
              className="mt-1 text-lg font-semibold text-slate-900"
            >
              Outbound HL7 FHIR R4 Transaction Bundle
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              1 <span className="font-mono font-medium">CarePlan</span> + {obligations.length}{" "}
              <span className="font-mono font-medium">Task</span> resource(s) formatted for
              Epic, Oracle Health, or Malaffi HIE write-back inside the UAE boundary.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close FHIR R4 export dialog"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-teal-800">
              FHIR R4 · Bundle/transaction
            </span>
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-indigo-800">
              {currentLifeStage}
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-[11px] font-medium text-emerald-800">
              UAE Local Write-Back
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopyFhirBundle(bundleJson)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              {fhirCopyState === "copied" ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {fhirCopyState === "copied"
                ? "Copied FHIR JSON"
                : fhirCopyState === "failed"
                  ? "Copy Failed"
                  : "Copy Bundle"}
            </button>
            <button
              type="button"
              onClick={() => handleDownloadFhirBundle(bundleJson)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download JSON
            </button>
          </div>
        </div>

        <pre className="mt-3 min-h-0 flex-1 overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-sky-200">
          {bundleJson}
        </pre>
      </div>
    </div>
  );
}
