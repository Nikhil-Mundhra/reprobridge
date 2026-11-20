import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Baby,
  Check,
  CheckCircle2,
  ClipboardList,
  Code2,
  Copy,
  Cpu,
  Database,
  Eye,
  FileCheck2,
  GitBranch,
  Info,
  Lock,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

interface Obligation {
  id: string;
  patient_id: string;
  patient_name: string;
  life_stage: string;
  title: string;
  rationale: string;
  evidence_source: string;
  rule_version: string;
  owner: string;
  status: string;
  priority: string;
  verified_by: string | null;
  closure_evidence: string | null;
}

interface AuditEvent {
  id: number;
  obligation_id: string | null;
  event_type: string;
  actor: string;
  summary: string;
  created_at: string;
}

interface TraceStep {
  node: string;
  execution?: "deterministic" | "agentic" | "deterministic_fallback";
  phi_exposed?: boolean;
  detail: string;
}

interface PrivacyReport {
  payload: Record<string, unknown>;
  redacted_fields: string[];
  permitted_fields: string[];
  phi_check_passed: boolean;
}

interface AiMetadata {
  mode: string;
  provider: string;
  model: string;
  fallback_reason: string | null;
}

interface ClinicalEvidence {
  id: string;
  obligation_id: string;
  fhir_resource_type: string;
  code_display: string;
  result_value: string;
  reference_range: string | null;
  source_facility: string;
  accession_id: string;
  clinician_suggestion: string;
  summary_note: string;
  recorded_at: string;
}

interface ParsedImportRow {
  title: string;
  rationale: string;
  priority: string;
  life_stage: string;
  owner: string;
  evidence_source: string;
  incoming_evidence_result?: string;
}

const SAMPLE_IMPORT_CSV = `title,rationale,priority,life_stage,owner,evidence_source,incoming_evidence_result
Gestational Diabetes OGTT Follow-up,Elevated 1-hour glucose challenge (152 mg/dL); requires 3-hour 100g OGTT confirmation.,HIGH,Antenatal (Trimester 1),OB-GYN / Endocrinology,FHIR Observation/obs-ogtt-2026-10,3-hour OGTT normal across all 4 draws (fasting 84 mg/dL)
Iron Deficiency Anemia Ferritin Check,Preconception ferritin 11 ng/mL; requires oral iron supplementation and 6-week repeat CBC.,MEDIUM,Preconception,Primary Care / OB-GYN,FHIR Observation/obs-ferritin-2026-09,Repeat ferritin 38 ng/mL & Hb 12.6 g/dL after iron therapy`;

function parseDelimitedTable(raw: string): ParsedImportRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const splitLine = (line: string): string[] => {
    if (delimiter === "\t") return line.split("\t").map((c) => c.trim());
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };

  const headers = splitLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]+/g, "_")
  );
  const rows: ParsedImportRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line);
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const idx = headers.indexOf(k);
        if (idx !== -1 && cells[idx]) return cells[idx];
      }
      return "";
    };
    const title = get("title", "obligation", "finding", "care_gap");
    const rationale = get("rationale", "description", "notes", "clinical_rationale");
    if (!title || !rationale) continue;
    rows.push({
      title,
      rationale,
      priority: (get("priority", "severity") || "MEDIUM").toUpperCase(),
      life_stage: get("life_stage", "stage") || "Preconception",
      owner: get("owner", "specialty") || "OB-GYN / Primary Care",
      evidence_source: get("evidence_source", "source", "fhir_source") || "CSV Table Import",
      incoming_evidence_result:
        get("incoming_evidence_result", "evidence_result", "lab_result", "result") || undefined,
    });
  }
  return rows;
}

interface HealthResponse {
  status: string;
  residency_policy?: string;
  ai_provider?: {
    provider: string;
    configured: boolean;
    model: string;
  };
  database: {
    provider: string;
    connected: boolean;
    branch?: string;
    pooled?: boolean;
    detail: string;
  };
}

interface PrototypeDemoProps {
  onBackToTutorial: () => void;
}

const FLOW_STEPS = [
  { step: 1, label: "Clinical Finding", desc: "FHIR / Malaffi HIE intake" },
  { step: 2, label: "Care-Gap Detection", desc: "Deterministic clinical rules" },
  { step: 3, label: "Obligation Passport", desc: "Auditable longitudinal record" },
  { step: 4, label: "Life-Stage Transition", desc: "Pregnancy & Postpartum events" },
  { step: 5, label: "UAE Firewall + AI", desc: "De-identified OpenRouter brief" },
  { step: 6, label: "Verified Closure", desc: "Clinician evidence sign-off" },
];

const TRACE_NODE_META: Record<
  string,
  { title: string; accent: string; badge: string }
> = {
  detect_open_obligations: {
    title: "Detect Open Obligations",
    accent: "border-t-teal-500",
    badge: "bg-teal-100 text-teal-800",
  },
  evaluate_life_stage_transition: {
    title: "Evaluate Transition Rules",
    accent: "border-t-sky-500",
    badge: "bg-sky-100 text-sky-800",
  },
  apply_uae_privacy_firewall: {
    title: "UAE Privacy Firewall",
    accent: "border-t-indigo-500",
    badge: "bg-indigo-100 text-indigo-800",
  },
  synthesize_coordination_brief: {
    title: "Synthesize Handoff Brief",
    accent: "border-t-purple-500",
    badge: "bg-purple-100 text-purple-800",
  },
};

function formatExecutionLabel(execution?: string): { label: string; className: string } {
  if (execution === "agentic") {
    return {
      label: "Agentic",
      className: "border-purple-200 bg-purple-50 text-purple-800",
    };
  }
  if (execution === "deterministic_fallback") {
    return {
      label: "Fallback",
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "Deterministic",
    className: "border-slate-200 bg-slate-100 text-slate-700",
  };
}

const SYNTHETIC_FHIR_RECORDS: Record<string, Record<string, unknown>> = {
  "OBL-101": {
    resourceType: "Observation",
    id: "obs-tsh-2026-09",
    status: "final",
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "3016-3",
          display: "Thyrotropin [Units/volume] in Serum or Plasma",
        },
      ],
    },
    subject: { reference: "Patient/PAT-AE-4092" },
    effectiveDateTime: "2026-09-14T09:30:00+04:00",
    valueQuantity: {
      value: 4.8,
      unit: "mIU/L",
      system: "http://unitsofmeasure.org",
      code: "m[IU]/L",
    },
    interpretation: [{ coding: [{ code: "H", display: "High" }] }],
    meta: { source: "urn:malaffi:hie:synthetic-preconception-lab" },
  },
  "OBL-102": {
    resourceType: "DiagnosticReport",
    id: "rep-rubella-2026-08",
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "25514-1",
          display: "Rubella virus IgG Ab [Presence] in Serum",
        },
      ],
    },
    subject: { reference: "Patient/PAT-AE-4092" },
    effectiveDateTime: "2026-08-22T11:15:00+04:00",
    conclusion:
      "Rubella IgG Non-Immune (<5 IU/mL). Recommend MMR immunization prior to pregnancy or postpartum.",
    meta: { source: "urn:malaffi:hie:synthetic-preconception-serology" },
  },
};

const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-rose-100 text-rose-800 border-rose-200",
  HIGH: "bg-amber-100 text-amber-800 border-amber-200",
  MEDIUM: "bg-sky-100 text-sky-800 border-sky-200",
};

const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-slate-100 text-slate-700",
  ESCALATED_FOR_REVIEW: "bg-rose-600 text-white",
  DEFERRED_TO_POSTPARTUM: "bg-indigo-100 text-indigo-800",
  VERIFIED_CLOSED: "bg-emerald-100 text-emerald-800",
};

const INTERIM_TIPS: Record<string, { title: string; body: string }[]> = {
  pregnancy: [
    {
      title: "UAE PHI Privacy Firewall Active",
      body: "Deterministic clinical rules run first inside the UAE boundary. Patient names, IDs, and raw HIE notes are stripped before OpenRouter receives an ephemeral case token.",
    },
    {
      title: "Clinical Safety Rule · First-Trimester TSH",
      body: "Preconception TSH of 4.8 mIU/L exceeds the first-trimester target (<2.5 mIU/L). AI never diagnoses or prescribes — it only drafts the OB-GYN handoff checklist for clinician sign-off.",
    },
    {
      title: "Live-Vaccine Contraindication Guard",
      body: "Rubella MMR is a live-attenuated vaccine contraindicated during pregnancy. ReproBridge preserves the obligation and locks closure until postpartum delivery.",
    },
  ],
  postpartum: [
    {
      title: "Postpartum Wake-Up Rule",
      body: "Delivery lifts the pregnancy live-vaccine contraindication, automatically reactivating deferred OBL-102 as URGENT for pre-discharge MMR immunization.",
    },
    {
      title: "Assistive AI Only · Zero Autonomous Closure",
      body: "OpenRouter drafts a de-identified postpartum discharge handoff while Neon Postgres enforces clinician evidence verification before any obligation can close.",
    },
  ],
};

function parseStreamedSections(raw: string): { summary: string; handoff: string } {
  const trimmed = raw.trim();
  if (trimmed.includes("HANDOFF:")) {
    const [before, after] = trimmed.split("HANDOFF:", 2);
    return {
      summary: before.replace(/^SUMMARY:\s*/i, "").trim(),
      handoff: after.trim(),
    };
  }
  return {
    summary: trimmed.replace(/^SUMMARY:\s*/i, "").trim(),
    handoff: "",
  };
}

function parseHandoffItems(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[•*-]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;
  // Handle single-line numbered lists like "1) ... 2) ..." without matching "(OBL-101) "
  const numbered = text
    .split(/(?:^|\s+)(?=\d+[.)]\s+)/)
    .map((part) => part.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  return numbered.length > 0 ? numbered : lines;
}

function detectObligationId(text: string): string | null {
  const match = text.match(/\bOBL-\d+\b/i);
  if (match) return match[0].toUpperCase();
  if (/thyroid|tsh|RB-THYROID/i.test(text)) return "OBL-101";
  if (/rubella|mmr|vaccin|RB-IMMUNE/i.test(text)) return "OBL-102";
  return null;
}

export default function PrototypeDemo({ onBackToTutorial }: PrototypeDemoProps) {
  const handoffCopyId = useId();
  const copyTimerRef = useRef<number | null>(null);
  const lastCopyMsgRef = useRef<string>("");

  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [agentSummary, setAgentSummary] = useState<string | null>(null);
  const [specialistHandoff, setSpecialistHandoff] = useState<string | null>(null);
  const [aiMetadata, setAiMetadata] = useState<AiMetadata | null>(null);
  const [privacyReport, setPrivacyReport] = useState<PrivacyReport | null>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [privacyTab, setPrivacyTab] = useState<"outbound" | "redacted">("outbound");
  const [selectedTraceNode, setSelectedTraceNode] = useState<string | null>(null);
  const [checkedHandoff, setCheckedHandoff] = useState<Record<number, boolean>>({});
  const [isEditingHandoff, setIsEditingHandoff] = useState(false);
  const [handoffDraft, setHandoffDraft] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const [streamTokenCount, setStreamTokenCount] = useState(0);
  const [streamDurationMs, setStreamDurationMs] = useState<number | null>(null);
  const [expandedFhirId, setExpandedFhirId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingPhase, setStreamingPhase] = useState<string | null>(null);
  const [streamingRawText, setStreamingRawText] = useState("");
  const [streamingModel, setStreamingModel] = useState<string | null>(null);
  const [activeTransitionKind, setActiveTransitionKind] = useState<"pregnancy" | "postpartum">("pregnancy");
  const [tipIndex, setTipIndex] = useState(0);
  const [tipsPaused, setTipsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verifyTarget, setVerifyTarget] = useState<Obligation | null>(null);
  const [verifyEvidenceList, setVerifyEvidenceList] = useState<ClinicalEvidence[]>([]);
  const [verifyEvidenceLoading, setVerifyEvidenceLoading] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [clinicianName, setClinicianName] = useState("Dr. Layla Al-Hashimi (OB-GYN)");
  const [closureEvidence, setClosureEvidence] = useState("");
  const [showAddEvidenceForm, setShowAddEvidenceForm] = useState(false);
  const [newEvDisplay, setNewEvDisplay] = useState("");
  const [newEvValue, setNewEvValue] = useState("");
  const [newEvFacility, setNewEvFacility] = useState("Malaffi HIE · Manual Entry");

  const [showIntakeModal, setShowIntakeModal] = useState(false);
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

  async function loadData() {
    try {
      setError(null);
      const [hRes, oRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/obligations"),
      ]);
      if (hRes.ok) setHealth(await hRes.json());
      if (oRes.ok) {
        const data = await oRes.json();
        setObligations(data.obligations ?? []);
        setAuditEvents(data.audit_events ?? []);
      } else {
        setError(`ReproBridge API returned HTTP ${oRes.status} while loading obligations.`);
      }
    } catch {
      setError("Unable to reach ReproBridge API. Start FastAPI or deploy on Vercel.");
    } finally {
      setInitialLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!isStreaming || tipsPaused) return;
    const tips = INTERIM_TIPS[activeTransitionKind];
    const timer = window.setInterval(() => {
      setTipIndex((prev) => (prev + 1) % tips.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [isStreaming, tipsPaused, activeTransitionKind]);

  async function openVerifyModal(obl: Obligation) {
    setVerifyTarget(obl);
    setVerifyEvidenceList([]);
    setSelectedEvidenceId(null);
    setShowAddEvidenceForm(false);
    setNewEvDisplay(obl.title);
    setNewEvValue("");
    setClinicianName("Dr. Layla Al-Hashimi (OB-GYN)");
    setClosureEvidence("");
    setVerifyEvidenceLoading(true);
    try {
      const res = await fetch(`/api/obligations/${obl.id}/evidence`);
      if (res.ok) {
        const data = await res.json();
        const records: ClinicalEvidence[] = data.evidence ?? [];
        setVerifyEvidenceList(records);
        if (records.length > 0) {
          const latest = records[0];
          setSelectedEvidenceId(latest.id);
          setClinicianName(latest.clinician_suggestion || "Dr. Layla Al-Hashimi (OB-GYN)");
          setClosureEvidence(latest.summary_note);
        }
      }
    } finally {
      setVerifyEvidenceLoading(false);
    }
  }

  async function handleAttachNewEvidence(e: React.FormEvent) {
    e.preventDefault();
    if (!verifyTarget || !newEvDisplay.trim() || !newEvValue.trim()) return;
    setVerifyEvidenceLoading(true);
    try {
      const res = await fetch(`/api/obligations/${verifyTarget.id}/evidence`, {
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
        if (data.audit_events) setAuditEvents(data.audit_events);
        setShowAddEvidenceForm(false);
        setNewEvValue("");
      }
    } finally {
      setVerifyEvidenceLoading(false);
    }
  }

  async function handleManualIntakeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualTitle.trim() || !manualRationale.trim()) return;
    setIntakeSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/obligations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_label: "Manual Clinician Intake",
          obligations: [
            {
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
      setObligations(data.obligations ?? []);
      setAuditEvents(data.audit_events ?? []);
      setManualTitle("");
      setManualRationale("");
      setManualIncomingResult("");
      setShowIntakeModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manual intake failed");
    } finally {
      setIntakeSubmitting(false);
    }
  }

  async function handleTableImportSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseDelimitedTable(tableRawText);
    if (parsed.length === 0) {
      setError("No valid rows found. Include header columns 'title' and 'rationale'.");
      return;
    }
    setIntakeSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/obligations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_label: "CSV / Table Import",
          obligations: parsed,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `Table import failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      setObligations(data.obligations ?? []);
      setAuditEvents(data.audit_events ?? []);
      setShowIntakeModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Table import failed");
    } finally {
      setIntakeSubmitting(false);
    }
  }

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

  async function runTransition(
    endpoint: "/api/transitions/pregnancy" | "/api/transitions/postpartum"
  ) {
    const kind = endpoint.includes("postpartum") ? "postpartum" : "pregnancy";
    const startedAt = performance.now();
    setActiveTransitionKind(kind);
    setTipIndex(0);
    setLoading(true);
    setIsStreaming(true);
    setStreamingPhase("Running deterministic clinical rules & UAE PHI firewall…");
    setStreamingRawText("");
    setStreamingModel(null);
    setStreamTokenCount(0);
    setStreamDurationMs(null);
    setCheckedHandoff({});
    setIsEditingHandoff(false);
    setSelectedTraceNode(null);
    setAgentSummary(null);
    setSpecialistHandoff(null);
    setAiMetadata(null);
    setError(null);

    try {
      const res = await fetch(`${endpoint}/stream`, {
        method: "POST",
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(
          errBody.detail || `Transition request failed (HTTP ${res.status})`
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      const handleEventBlock = (block: string) => {
        const lines = block.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (dataLines.length === 0) return;
        const payload = JSON.parse(dataLines.join("\n"));

        if (eventName === "deterministic_complete") {
          setObligations(payload.obligations ?? []);
          setAuditEvents(payload.audit_events ?? []);
          setPrivacyReport(payload.privacy_report ?? null);
          setTrace(payload.trace ?? []);
          setStreamingPhase("UAE Firewall verified (0 PHI) · Streaming OpenRouter synthesis…");
        } else if (eventName === "token") {
          accumulated += payload.delta ?? "";
          setStreamingRawText(accumulated);
          setStreamTokenCount((c) => c + 1);
          if (payload.model) setStreamingModel(payload.model);
          setStreamingPhase("Streaming de-identified clinician handoff tokens…");
        } else if (eventName === "complete") {
          setObligations(payload.obligations ?? []);
          setAuditEvents(payload.audit_events ?? []);
          setAgentSummary(payload.agent_summary ?? null);
          setSpecialistHandoff(payload.specialist_handoff ?? null);
          setAiMetadata(payload.ai_metadata ?? null);
          setPrivacyReport(payload.privacy_report ?? null);
          setTrace(payload.trace ?? []);
          setStreamDurationMs(Math.round(performance.now() - startedAt));
          setStreamingPhase(null);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          if (block.trim()) handleEventBlock(block);
        }
      }
      if (buffer.trim()) handleEventBlock(buffer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transition failed");
    } finally {
      setLoading(false);
      setIsStreaming(false);
      setStreamingPhase(null);
    }
  }

  async function handleConfirmVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!verifyTarget) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/obligations/${verifyTarget.id}/verify`, {
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
      setVerifyTarget(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    setLoading(true);
    setAgentSummary(null);
    setSpecialistHandoff(null);
    setAiMetadata(null);
    setPrivacyReport(null);
    setShowPayload(false);
    setExpandedFhirId(null);
    setTrace([]);
    setError(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setObligations(data.obligations ?? []);
        setAuditEvents(data.audit_events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  const parsedStream = parseStreamedSections(streamingRawText);
  const displaySummary = agentSummary ?? (isStreaming ? parsedStream.summary : null);
  const displayHandoff = specialistHandoff ?? (isStreaming ? parsedStream.handoff : null);
  const currentTip = INTERIM_TIPS[activeTransitionKind][tipIndex] ?? INTERIM_TIPS.pregnancy[0];
  const showHarnessPanel = isStreaming || Boolean(agentSummary);
  const patient = obligations[0];
  const isPostpartum = obligations.some((o) => o.life_stage === "Postpartum");
  const isAntenatal =
    !isPostpartum && obligations.some((o) => o.life_stage.startsWith("Antenatal"));
  const currentLifeStage = isPostpartum
    ? "Postpartum"
    : isAntenatal
      ? "Antenatal (Trimester 1)"
      : (patient?.life_stage ?? "Preconception");
  const hasClosed = obligations.some((o) => o.status === "VERIFIED_CLOSED");
  const activeStep = hasClosed ? 6 : isAntenatal || isPostpartum ? 5 : 3;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToTutorial}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Tutorial
            </button>
            <img
              src="/reprobridge-logo-full.png"
              alt="ReproBridge — Connected care for women"
              width={154}
              height={48}
              className="h-9 w-auto object-contain"
            />
            <span className="hidden border-l border-slate-200 pl-3 text-xs text-slate-500 md:inline">
              Clinical Obligation Passport · Preconception → Antenatal → Postpartum
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              <Lock className="h-3.5 w-3.5" />
              UAE PHI Local-Only
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                health?.database.connected
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
              title={health?.database.detail}
            >
              <Database className="h-3.5 w-3.5" />
              {health?.database.connected
                ? `Neon Postgres (${health.database.branch ?? "production"})`
                : "Synthetic Fallback Mode"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {/* 6-Step Care Continuity Flow */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            End-to-End Care-Continuity Flow
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {FLOW_STEPS.map((item) => {
              const completed = item.step <= activeStep;
              return (
                <div
                  key={item.step}
                  className={`rounded-lg border p-2.5 text-xs transition ${
                    completed
                      ? "border-teal-200 bg-teal-50/70 text-teal-950"
                      : "border-slate-100 bg-slate-50 text-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>Step {item.step}</span>
                    {completed && <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />}
                  </div>
                  <p className="mt-1 font-medium">{item.label}</p>
                  <p className="mt-0.5 text-[11px] opacity-80">{item.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Patient Header & Life-Stage Transition Actions */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Synthetic Patient Record (Stored in Neon / UAE Boundary)
              </p>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                {patient?.patient_name ?? "Amina Al-Mansoori (Synthetic)"}{" "}
                <span className="ml-2 font-mono text-xs font-normal text-slate-500">
                  {patient?.patient_id ?? "PAT-AE-4092"}
                </span>
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Current Life Stage:{" "}
                <span className="font-medium text-teal-700">{currentLifeStage}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {!isAntenatal && !isPostpartum && (
                <button
                  onClick={() => runTransition("/api/transitions/pregnancy")}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700 disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  Trigger Pregnancy Transition
                </button>
              )}
              {isAntenatal && (
                <button
                  onClick={() => runTransition("/api/transitions/postpartum")}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Baby className="h-4 w-4" />
                  Trigger Postpartum Transition
                </button>
              )}
              <button
                onClick={handleReset}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Reset Demo
              </button>
            </div>
          </div>

          {!isPostpartum && (
            <div
              role="note"
              className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed ${
                isAntenatal && obligations.some((o) => o.id === "OBL-101" && o.status !== "VERIFIED_CLOSED")
                  ? "border-amber-200 bg-amber-50/80 text-amber-950"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {isAntenatal && obligations.some((o) => o.id === "OBL-101" && o.status !== "VERIFIED_CLOSED") ? (
                <>
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <p>
                    <span className="font-semibold text-amber-900">
                      Before triggering Postpartum:
                    </span>{" "}
                    <span className="font-mono font-medium">OBL-101</span> (antenatal TSH follow-up) is still open. You can verify &amp; close it below first, or proceed — Postpartum Transition will carry{" "}
                    <span className="font-mono">OBL-101</span> forward for 6-week reassessment, reactivate deferred{" "}
                    <span className="font-mono">OBL-102</span> (MMR) as <span className="font-semibold">URGENT</span>, and call external assistive AI (OpenRouter) with <span className="font-semibold">0 PHI</span> to draft a handoff for clinician sign-off.
                  </p>
                </>
              ) : isAntenatal ? (
                <>
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                  <p>
                    <span className="font-semibold text-slate-900">
                      Postpartum Transition Notice:
                    </span>{" "}
                    Runs deterministic postpartum rules (lifting the pregnancy live-vaccine contraindication and reactivating{" "}
                    <span className="font-mono">OBL-102</span> as <span className="font-semibold">URGENT</span>), strips all UAE PHI, and calls OpenRouter solely to draft an assistive OB-GYN handoff pending clinician approval.
                  </p>
                </>
              ) : (
                <>
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                  <p>
                    <span className="font-semibold text-slate-900">
                      Hybrid AI &amp; Safety Notice:
                    </span>{" "}
                    Triggering a life-stage transition executes deterministic clinical rules in Neon Postgres first, strips all UAE PHI via the Privacy Firewall, and uses external assistive AI (OpenRouter) only to draft a de-identified clinician handoff — never to diagnose, prescribe, or close obligations.
                  </p>
                </>
              )}
            </div>
          )}
        </section>

        {/* Hybrid LangGraph Orchestrator Summary, Live Streaming, Micro-Interactions & UAE Privacy Firewall */}
        {showHarnessPanel && (
          <section
            aria-live="polite"
            aria-busy={isStreaming}
            className="space-y-4 rounded-xl border border-teal-200 bg-teal-50 p-5 text-sm text-teal-950"
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
                {(aiMetadata || streamingModel) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-white px-2.5 py-1 font-mono text-[11px] font-medium text-teal-800">
                    <Cpu className="h-3 w-3" />
                    {aiMetadata
                      ? `${aiMetadata.provider} · ${aiMetadata.model}`
                      : `openrouter · ${streamingModel}`}
                  </span>
                )}
                {!isStreaming && agentSummary && (
                  <button
                    type="button"
                    onClick={() =>
                      runTransition(
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
                              setSpecialistHandoff(handoffDraft.trim());
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
                      <ul id={handoffCopyId} className="mt-2.5 space-y-2">
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
                              className={`flex flex-wrap items-start justify-between gap-2 rounded-lg border p-2.5 transition ${
                                checked
                                  ? "border-emerald-200 bg-emerald-50/50"
                                  : "border-slate-100 bg-slate-50/60"
                              }`}
                            >
                              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                                <input
                                  type="checkbox"
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
                                  onClick={() => openVerifyModal(matchedObl)}
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

            {/* Clickable Trace Cards 1–4 with inline Step Inspector Drawer */}
            {trace.length > 0 && (
              <div className="space-y-3">
                <div className="rb-trace-grid">
                  {trace.map((step, idx) => {
                    const meta = TRACE_NODE_META[step.node] ?? {
                      title: step.node.replaceAll("_", " "),
                      accent: "border-t-teal-500",
                      badge: "bg-teal-100 text-teal-800",
                    };
                    const exec = formatExecutionLabel(step.execution);
                    const isSelected = selectedTraceNode === step.node;

                    return (
                      <article
                        key={step.node}
                        title={step.node}
                        className={`rb-trace-card rounded-xl border border-t-2 ${meta.accent} bg-white p-3.5 text-xs shadow-xs transition ${
                          isSelected
                            ? "border-teal-400 ring-2 ring-teal-500/25"
                            : "border-slate-200/90 hover:border-teal-300"
                        }`}
                      >
                        <header className="flex items-start justify-between gap-2 min-w-0">
                          <button
                            type="button"
                            aria-expanded={isSelected}
                            onClick={() =>
                              setSelectedTraceNode((prev) =>
                                prev === step.node ? null : step.node
                              )
                            }
                            className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
                          >
                            <span
                              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold ${meta.badge}`}
                            >
                              {idx + 1}
                            </span>
                            <h4 className="font-semibold leading-snug text-slate-900">
                              {meta.title}
                            </h4>
                          </button>
                          {idx < 3 && (
                            <ArrowRight
                              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400"
                              aria-hidden="true"
                            />
                          )}
                        </header>

                        <p className="leading-relaxed text-slate-600">{step.detail}</p>

                        <footer className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-100 pt-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${exec.className}`}
                          >
                            {exec.label}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedTraceNode((prev) =>
                                prev === step.node ? null : step.node
                              )
                            }
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-teal-700 hover:underline"
                          >
                            <Eye className="h-3 w-3 text-teal-600" aria-hidden="true" />
                            <span>{isSelected ? "Hide" : "Inspect"}</span>
                          </button>
                        </footer>
                      </article>
                    );
                  })}
                  {isStreaming && trace.length === 3 && (
                    <article
                      title="synthesize_coordination_brief"
                      className="rb-trace-card rounded-xl border border-dashed border-purple-300 border-t-2 border-t-purple-500 bg-white/90 p-3.5 text-xs shadow-xs"
                    >
                      <header className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-100 font-mono text-[11px] font-bold text-purple-800">
                          4
                        </span>
                        <h4 className="font-semibold leading-snug text-slate-900">
                          Synthesize Handoff Brief
                        </h4>
                      </header>

                      <div className="space-y-1.5">
                        <div className="rb-shimmer h-2.5 w-full rounded" />
                        <div className="rb-shimmer h-2.5 w-4/5 rounded" />
                      </div>

                      <footer className="flex items-center justify-between border-t border-slate-100 pt-2">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-semibold text-purple-800">
                          <progress aria-label="Streaming brief" className="rb-spinner" />
                          Streaming…
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
                          <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                          0 PHI
                        </span>
                      </footer>
                    </article>
                  )}
                </div>

                {/* Step Inspector Drawer */}
                {selectedTraceNode && (
                  <div className="rounded-xl border border-teal-200 bg-white p-4 text-xs text-slate-700 shadow-xs">
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
                            ? `${aiMetadata.provider} · ${aiMetadata.model}`
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
              <div className="rounded-lg border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-950">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold text-indigo-900">
                    <Lock className="h-3.5 w-3.5" />
                    UAE Data Residency Firewall — Zero PHI Sent Outside UAE
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

                <div className="mt-2 grid gap-3 sm:grid-cols-2">
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

                {showPayload && (
                  <div className="mt-3 space-y-2.5">
                    <div
                      role="tablist"
                      aria-label="PHI redaction inspection view"
                      className="inline-flex rounded-lg border border-indigo-200 bg-white p-0.5"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={privacyTab === "outbound"}
                        onClick={() => setPrivacyTab("outbound")}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
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
                        aria-selected={privacyTab === "redacted"}
                        onClick={() => setPrivacyTab("redacted")}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
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
        )}

        {/* Clinical Obligation Passport */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
                Clinical Obligation Passport ({obligations.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                setIntakeTab("manual");
                setShowIntakeModal(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-200 bg-white px-3 py-1.5 text-xs font-medium text-teal-800 shadow-xs transition hover:bg-teal-50"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Import Table / Add Finding
            </button>
          </div>

          {initialLoading && obligations.length === 0 && (
            <div className="space-y-4" aria-label="Loading clinical obligations">
              {[0, 1].map((idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
                >
                  <div className="flex items-center gap-2">
                    <div className="rb-shimmer h-4 w-16 rounded" />
                    <div className="rb-shimmer h-5 w-16 rounded-full" />
                    <div className="rb-shimmer h-5 w-20 rounded-full" />
                  </div>
                  <div className="rb-shimmer mt-3 h-5 w-2/3 rounded" />
                  <div className="rb-shimmer mt-2 h-3.5 w-full rounded" />
                  <div className="rb-shimmer mt-1.5 h-3.5 w-5/6 rounded" />
                </div>
              ))}
            </div>
          )}

          {obligations.map((obl) => {
            const fhirRecord = SYNTHETIC_FHIR_RECORDS[obl.id];
            const isFhirOpen = expandedFhirId === obl.id;

            return (
              <article
                key={obl.id}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{obl.id}</span>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                          PRIORITY_STYLES[obl.priority] ?? "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {obl.priority}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[obl.status] ?? "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {obl.status}
                      </span>
                    </div>
                    <h4 className="mt-2 text-base font-semibold text-slate-900">
                      {obl.title}
                    </h4>
                  </div>

                  {obl.status === "DEFERRED_TO_POSTPARTUM" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-800">
                      <Lock className="h-3.5 w-3.5" />
                      Contraindicated in Pregnancy — Auto-Queued for Postpartum
                    </span>
                  ) : (
                    obl.status !== "VERIFIED_CLOSED" && (
                      <button
                        onClick={() => openVerifyModal(obl)}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <FileCheck2 className="h-3.5 w-3.5" />
                        Clinician Verify & Close
                      </button>
                    )
                  )}
                </div>

                <p className="mt-3 text-sm leading-relaxed text-slate-600">{obl.rationale}</p>

                <dl className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 sm:grid-cols-3">
                  <div>
                    <dt className="font-medium text-slate-400">Evidence Source</dt>
                    <dd className="mt-0.5 font-mono text-slate-700">{obl.evidence_source}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Rule Version</dt>
                    <dd className="mt-0.5 font-mono text-slate-700">{obl.rule_version}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-400">Care Owner</dt>
                    <dd className="mt-0.5 text-slate-700">{obl.owner}</dd>
                  </div>
                </dl>

                {fhirRecord && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedFhirId(isFhirOpen ? null : obl.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900"
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      {isFhirOpen
                        ? "Hide HL7 FHIR R4 Source Record"
                        : "Inspect HL7 FHIR R4 Source Record"}
                    </button>
                    {isFhirOpen && (
                      <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-sky-200">
                        {JSON.stringify(fhirRecord, null, 2)}
                      </pre>
                    )}
                  </div>
                )}

                {obl.verified_by && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-900">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div>
                      <span className="font-semibold">Verified by {obl.verified_by}:</span>{" "}
                      {obl.closure_evidence}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </section>

        {/* Auditable Governance Log */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Auditable Governance Log ({auditEvents.length})
            </h3>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 text-xs">
            {auditEvents.map((ev) => (
              <li
                key={ev.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2.5"
              >
                <div>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                    {ev.event_type}
                  </span>
                  <span className="ml-2 font-medium text-slate-800">{ev.actor}</span>
                  <p className="mt-1 text-slate-600">{ev.summary}</p>
                </div>
                <span className="font-mono text-[11px] text-slate-400">
                  {new Date(ev.created_at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      {/* Human-in-the-Loop Clinician Verification Modal (Backed by Neon clinical_evidence) */}
      {verifyTarget && (
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
                  {verifyTarget.id}: {verifyTarget.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setVerifyTarget(null)}
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
                  No incoming lab or immunization record found in Neon for {verifyTarget.id} yet.
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
                  onClick={() => setVerifyTarget(null)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <FileCheck2 className="h-4 w-4" />
                  Approve & Verify Closure
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Data Input & CSV/TSV Table Import Modal */}
      {showIntakeModal && (
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
                onClick={() => setShowIntakeModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close intake modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              role="tablist"
              aria-label="Clinical data intake mode"
              className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs"
            >
              <button
                type="button"
                role="tab"
                aria-selected={intakeTab === "manual"}
                onClick={() => setIntakeTab("manual")}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
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
                aria-selected={intakeTab === "table"}
                onClick={() => setIntakeTab("table")}
                className={`rounded-md px-3 py-1.5 font-medium transition ${
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
                    onClick={() => setShowIntakeModal(false)}
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
              (() => {
                const previewRows = parseDelimitedTable(tableRawText);
                return (
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
                          onClick={() => setShowIntakeModal(false)}
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
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}
