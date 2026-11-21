import { useState } from "react";
import { Plus, Upload, X } from "lucide-react";
import { handleSpatialKeyDown } from "../spatialNav";
import { SAMPLE_IMPORT_CSV } from "./constants";
import { parseDelimitedTable } from "./helpers";
import type { AuditEvent, Obligation, PatientCohortSummary } from "./types";

interface ObligationIntakeModalProps {
  isOpen: boolean;
  patientId: string;
  patientName: string;
  onClose: () => void;
  onImported: (
    obligations: Obligation[],
    auditEvents: AuditEvent[],
    patients?: PatientCohortSummary[]
  ) => void;
  onError: (msg: string | null) => void;
}

export default function ObligationIntakeModal({
  isOpen,
  patientId,
  patientName,
  onClose,
  onImported,
  onError,
}: ObligationIntakeModalProps) {
  const [intakeTab, setIntakeTab] = useState<"manual" | "table">("manual");
  const [manualTitle, setManualTitle] = useState("");
  const [manualRationale, setManualRationale] = useState("");
  const [manualPriority, setManualPriority] = useState("HIGH");
  const [manualLifeStage, setManualLifeStage] = useState("Preconception");
  const [manualOwner, setManualOwner] = useState("OB-GYN / Primary Care");
  const [manualSource, setManualSource] = useState("Manual Clinician Intake");
  const [manualIncomingResult, setManualIncomingResult] = useState("");
  const [tableRawText, setTableRawText] = useState(SAMPLE_IMPORT_CSV);
  const [intakeSubmitting, setIntakeSubmitting] = useState(false);

  if (!isOpen) return null;

  async function handleManualIntakeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualTitle.trim() || !manualRationale.trim()) return;
    setIntakeSubmitting(true);
    onError(null);
    try {
      const res = await fetch("/api/obligations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_label: "Manual Clinician Intake",
          obligations: [
            {
              patient_id: patientId,
              patient_name: patientName,
              title: manualTitle.trim(),
              rationale: manualRationale.trim(),
              priority: manualPriority,
              life_stage: manualLifeStage,
              owner: manualOwner.trim() || "OB-GYN / Primary Care",
              evidence_source: manualSource.trim() || "Manual Clinician Intake",
              incoming_evidence_result: manualIncomingResult.trim() || null,
              incoming_evidence_facility: "Malaffi HIE · Manual Intake",
            },
          ],
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `Import failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      onImported(data.obligations ?? [], data.audit_events ?? [], data.patients);
      setManualTitle("");
      setManualRationale("");
      setManualIncomingResult("");
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Manual intake failed");
    } finally {
      setIntakeSubmitting(false);
    }
  }

  async function handleTableImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseDelimitedTable(tableRawText);
    if (parsed.length === 0) {
      onError("No valid rows found. Include header columns 'title' and 'rationale'.");
      return;
    }
    setIntakeSubmitting(true);
    onError(null);
    try {
      const res = await fetch("/api/obligations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_label: "CSV / Table Import",
          obligations: parsed.map((row) => ({
            ...row,
            patient_id: patientId,
            patient_name: patientName,
          })),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `Table import failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      onImported(data.obligations ?? [], data.audit_events ?? [], data.patients);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Table import failed");
    } finally {
      setIntakeSubmitting(false);
    }
  }

  const previewRows = intakeTab === "table" ? parseDelimitedTable(tableRawText) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intake-modal-title"
    >
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
              Neon Postgres Clinical Intake
            </p>
            <h3
              id="intake-modal-title"
              className="mt-1 text-base font-semibold text-slate-900"
            >
              Import Clinical Table or Input Finding Manually
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close intake modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Clinical data intake mode"
          onKeyDown={(e) => {
            handleSpatialKeyDown(e, '[role="tab"]', (next) => {
              const tabKey = next.dataset.tab as "manual" | "table" | undefined;
              if (tabKey) setIntakeTab(tabKey);
            });
          }}
          className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs"
        >
          <button
            type="button"
            role="tab"
            data-tab="manual"
            aria-selected={intakeTab === "manual"}
            tabIndex={intakeTab === "manual" ? 0 : -1}
            onClick={() => setIntakeTab("manual")}
            className={`rounded-md px-3 py-1.5 font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 ${
              intakeTab === "manual"
                ? "bg-white text-teal-800 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Manual Entry
          </button>
          <button
            type="button"
            role="tab"
            data-tab="table"
            aria-selected={intakeTab === "table"}
            tabIndex={intakeTab === "table" ? 0 : -1}
            onClick={() => setIntakeTab("table")}
            className={`rounded-md px-3 py-1.5 font-medium transition focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 ${
              intakeTab === "table"
                ? "bg-white text-teal-800 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Import CSV / Spreadsheet Table
          </button>
        </div>

        {intakeTab === "manual" ? (
          <form onSubmit={handleManualIntakeSubmit} className="mt-4 space-y-3.5 text-sm">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Clinical Obligation Title *
              </label>
              <input
                type="text"
                required
                placeholder="e.g., Gestational Diabetes 3-Hour OGTT Confirmation"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700">
                Clinical Rationale *
              </label>
              <textarea
                rows={2}
                required
                placeholder="Why this care gap must be tracked across life stages…"
                value={manualRationale}
                onChange={(e) => setManualRationale(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">Priority</label>
                <select
                  value={manualPriority}
                  onChange={(e) => setManualPriority(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                >
                  <option value="URGENT">URGENT</option>
                  <option value="HIGH">HIGH</option>
                  <option value="MEDIUM">MEDIUM</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Life Stage</label>
                <select
                  value={manualLifeStage}
                  onChange={(e) => setManualLifeStage(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                >
                  <option value="Preconception">Preconception</option>
                  <option value="Antenatal (Trimester 1)">Antenatal (Trimester 1)</option>
                  <option value="Postpartum">Postpartum</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">Owner</label>
                <input
                  type="text"
                  value={manualOwner}
                  onChange={(e) => setManualOwner(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  FHIR / HIE Source
                </label>
                <input
                  type="text"
                  value={manualSource}
                  onChange={(e) => setManualSource(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Optional Incoming Verification Result
                </label>
                <input
                  type="text"
                  placeholder="e.g., Repeat ferritin 38 ng/mL (Normal)"
                  value={manualIncomingResult}
                  onChange={(e) => setManualIncomingResult(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={intakeSubmitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                Save to Neon Postgres
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleTableImportSubmit} className="mt-4 space-y-3.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-slate-600">
                Upload a <span className="font-mono">.csv</span> /{" "}
                <span className="font-mono">.tsv</span> file or paste spreadsheet rows
                below (columns: <span className="font-mono">title, rationale, priority, life_stage, owner, evidence_source, incoming_evidence_result</span>).
              </p>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 font-medium text-teal-800 hover:bg-teal-100">
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                Choose CSV File
                <input
                  type="file"
                  accept=".csv,.tsv,.txt"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setTableRawText(text);
                  }}
                />
              </label>
            </div>

            <textarea
              rows={5}
              value={tableRawText}
              onChange={(e) => setTableRawText(e.target.value)}
              className="w-full rounded-lg border border-slate-300 p-2.5 font-mono text-[11px] leading-relaxed text-slate-800 focus:border-teal-500 focus:outline-none"
            />

            {previewRows.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2.5 py-1.5 font-semibold">Title</th>
                      <th className="px-2.5 py-1.5 font-semibold">Priority</th>
                      <th className="px-2.5 py-1.5 font-semibold">Stage</th>
                      <th className="px-2.5 py-1.5 font-semibold">Linked Evidence</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="px-2.5 py-1.5 font-medium text-slate-800">
                          {row.title}
                        </td>
                        <td className="px-2.5 py-1.5 font-mono">{row.priority}</td>
                        <td className="px-2.5 py-1.5">{row.life_stage}</td>
                        <td className="px-2.5 py-1.5 text-slate-500">
                          {row.incoming_evidence_result ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <span className="text-slate-500">
                {previewRows.length} valid row(s) ready to import into Neon Postgres
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={intakeSubmitting || previewRows.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  Import {previewRows.length} Row(s)
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
