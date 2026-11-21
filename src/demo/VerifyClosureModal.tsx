import { useEffect, useState } from "react";
import { Database, FileCheck2, Plus, X } from "lucide-react";
import type { AuditEvent, ClinicalEvidence, Obligation } from "./types";

interface VerifyClosureModalProps {
  target: Obligation;
  loading: boolean;
  defaultClinicianName: string;
  onClose: () => void;
  onVerified: (clinicianUsed: string) => Promise<void>;
  onAuditUpdated: (events: AuditEvent[]) => void;
  onError: (msg: string | null) => void;
}

export default function VerifyClosureModal({
  target,
  loading,
  defaultClinicianName,
  onClose,
  onVerified,
  onAuditUpdated,
  onError,
}: VerifyClosureModalProps) {
  const [verifyEvidenceList, setVerifyEvidenceList] = useState<ClinicalEvidence[]>([]);
  const [verifyEvidenceLoading, setVerifyEvidenceLoading] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [clinicianName, setClinicianName] = useState(defaultClinicianName);
  const [closureEvidence, setClosureEvidence] = useState("");
  const [showAddEvidenceForm, setShowAddEvidenceForm] = useState(false);
  const [newEvDisplay, setNewEvDisplay] = useState(target.title);
  const [newEvValue, setNewEvValue] = useState("");
  const [newEvFacility, setNewEvFacility] = useState("Malaffi HIE · Manual Entry");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchEvidence() {
      setVerifyEvidenceList([]);
      setSelectedEvidenceId(null);
      setShowAddEvidenceForm(false);
      setNewEvDisplay(target.title);
      setNewEvValue("");
      setClinicianName(defaultClinicianName);
      setClosureEvidence("");
      setVerifyEvidenceLoading(true);
      try {
        const res = await fetch(`/api/obligations/${target.id}/evidence`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          const records: ClinicalEvidence[] = data.evidence ?? [];
          setVerifyEvidenceList(records);
          if (records.length > 0) {
            const latest = records[0];
            setSelectedEvidenceId(latest.id);
            setClinicianName(latest.clinician_suggestion || defaultClinicianName);
            setClosureEvidence(latest.summary_note);
          }
        }
      } finally {
        if (!cancelled) {
          setVerifyEvidenceLoading(false);
        }
      }
    }

    void fetchEvidence();
    return () => {
      cancelled = true;
    };
  }, [target.id, target.title, defaultClinicianName]);

  async function handleAttachNewEvidence(e: React.FormEvent) {
    e.preventDefault();
    if (!newEvDisplay.trim() || !newEvValue.trim()) return;
    setVerifyEvidenceLoading(true);
    try {
      const res = await fetch(`/api/obligations/${target.id}/evidence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fhir_resource_type: "Observation",
          code_display: newEvDisplay.trim(),
          result_value: newEvValue.trim(),
          source_facility: newEvFacility.trim() || "Malaffi HIE · Manual Entry",
          clinician_suggestion: clinicianName,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const records: ClinicalEvidence[] = data.evidence ?? [];
        setVerifyEvidenceList(records);
        if (data.record) {
          setSelectedEvidenceId(data.record.id);
          setClosureEvidence(data.record.summary_note);
        }
        if (data.audit_events) onAuditUpdated(data.audit_events);
        setShowAddEvidenceForm(false);
        setNewEvValue("");
      }
    } finally {
      setVerifyEvidenceLoading(false);
    }
  }

  async function handleConfirmVerify(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    onError(null);
    try {
      const res = await fetch(`/api/obligations/${target.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinician_name: clinicianName,
          closure_evidence: closureEvidence,
          evidence_id: selectedEvidenceId,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || "Verification failed");
      }
      onClose();
      await onVerified(clinicianName);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="verify-modal-title"
    >
      <div className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Evidence-Verified Care Closure · Neon Postgres HIE
            </p>
            <h3
              id="verify-modal-title"
              className="mt-1 text-base font-semibold text-slate-900"
            >
              {target.id}: {target.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Incoming Evidence pulled live from Neon clinical_evidence */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
              <Database className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />
              Incoming FHIR Evidence in Neon ({verifyEvidenceList.length})
            </p>
            <button
              type="button"
              onClick={() => setShowAddEvidenceForm((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {showAddEvidenceForm ? "Cancel" : "Log New Lab / Result"}
            </button>
          </div>

          {verifyEvidenceLoading ? (
            <div className="mt-2.5 space-y-2" aria-label="Loading evidence from Neon Postgres">
              <div className="rb-shimmer h-3.5 w-3/4 rounded" />
              <div className="rb-shimmer h-3 w-full rounded" />
            </div>
          ) : verifyEvidenceList.length > 0 ? (
            <ul className="mt-2.5 space-y-2">
              {verifyEvidenceList.map((ev) => {
                const isPicked = selectedEvidenceId === ev.id;
                return (
                  <li
                    key={ev.id}
                    className={`rounded-lg border p-2.5 text-xs transition ${
                      isPicked
                        ? "border-emerald-300 bg-emerald-50/70"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-teal-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-900">
                            {ev.fhir_resource_type}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">
                            {ev.id} · #{ev.accession_id}
                          </span>
                        </div>
                        <p className="mt-1 font-semibold text-slate-900">{ev.result_value}</p>
                        <p className="mt-0.5 text-[11px] text-slate-600">
                          {ev.code_display} · {ev.source_facility}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEvidenceId(ev.id);
                          setClinicianName(ev.clinician_suggestion || clinicianName);
                          setClosureEvidence(ev.summary_note);
                        }}
                        className={`shrink-0 rounded px-2 py-1 text-[11px] font-medium ${
                          isPicked
                            ? "bg-emerald-600 text-white"
                            : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {isPicked ? "Attached" : "Attach Evidence"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              No incoming lab or immunization record found in Neon for {target.id} yet.
              Log a new result above or enter clinician verification notes below.
            </p>
          )}

          {showAddEvidenceForm && (
            <form
              onSubmit={handleAttachNewEvidence}
              className="mt-3 space-y-2 rounded-lg border border-teal-200 bg-white p-3 text-xs"
            >
              <p className="font-semibold text-teal-900">
                Record New Incoming Clinical Evidence in Neon
              </p>
              <input
                type="text"
                required
                placeholder="Test / Procedure (e.g., Repeat TSH + Free T4)"
                value={newEvDisplay}
                onChange={(e) => setNewEvDisplay(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
              />
              <input
                type="text"
                required
                placeholder="Result Value (e.g., TSH 2.0 mIU/L · Normal)"
                value={newEvValue}
                onChange={(e) => setNewEvValue(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Source Facility / Registry"
                value={newEvFacility}
                onChange={(e) => setNewEvFacility(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={verifyEvidenceLoading}
                  className="rounded bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  Save & Attach to Closure
                </button>
              </div>
            </form>
          )}
        </div>

        <form onSubmit={handleConfirmVerify} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Authorized Clinician
            </label>
            <input
              type="text"
              required
              value={clinicianName}
              onChange={(e) => setClinicianName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700">
              Supporting Clinical Evidence (Required for Closure)
            </label>
            <textarea
              rows={3}
              required
              placeholder="Select an incoming Neon HIE record above or enter verified clinical closure evidence…"
              value={closureEvidence}
              onChange={(e) => setClosureEvidence(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            />
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
              disabled={loading || submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <FileCheck2 className="h-4 w-4" />
              Approve & Verify Closure
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
