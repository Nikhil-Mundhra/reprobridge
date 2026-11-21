import { useEffect, useState } from "react";
import ClinicalDocumentsDrawer from "./ClinicalDocumentsDrawer";
import AuditGovernanceSection from "./demo/AuditGovernanceSection";
import CareFlowAndPatientHeader from "./demo/CareFlowAndPatientHeader";
import DemoTopBar from "./demo/DemoTopBar";
import FhirExportModal from "./demo/FhirExportModal";
import FloatingDocsTab from "./demo/FloatingDocsTab";
import ObligationExplainerPopover from "./demo/ObligationExplainerPopover";
import ObligationIntakeModal from "./demo/ObligationIntakeModal";
import ObligationPassportSection from "./demo/ObligationPassportSection";
import OrchestratorHarnessSection from "./demo/OrchestratorHarnessSection";
import PatientCohortBar from "./demo/PatientCohortBar";
import VerifyClosureModal from "./demo/VerifyClosureModal";
import { DEFAULT_PATIENT_COHORT } from "./demo/constants";
import { readDocsSessionPrefs, type DocsSessionPrefs } from "./demo/docsSessionPrefs";
import { parseStreamedSections } from "./demo/helpers";
import type {
  AiMetadata,
  AuditEvent,
  CohortTotals,
  HealthResponse,
  Obligation,
  ObligationExplanationResponse,
  PatientCohortSummary,
  PrivacyReport,
  PrototypeDemoProps,
  SafetyBlockInfo,
  TraceStep,
} from "./demo/types";

export type { Obligation } from "./demo/types";
export { SAMPLE_IMPORT_CSV } from "./demo/constants";
export {
  buildOutboundFhirBundle,
  detectObligationId,
  formatExecutionLabel,
  getUrgentDueChip,
  parseDelimitedTable,
  parseHandoffItems,
  parseStreamedSections,
} from "./demo/helpers";

const SEEDED_OBLIGATION_IDS = new Set([
  "OBL-101",
  "OBL-102",
  "OBL-201",
  "OBL-202",
  "OBL-301",
  "OBL-302",
]);

export default function PrototypeDemo({ onBackToTutorial }: PrototypeDemoProps) {
  const [selectedPatientId, setSelectedPatientId] = useState("PAT-AE-4092");
  const [patients, setPatients] = useState<PatientCohortSummary[]>(DEFAULT_PATIENT_COHORT);
  const [cohortTotals, setCohortTotals] = useState<CohortTotals | undefined>(undefined);
  const [obligations, setObligations] = useState<Obligation[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingPhase, setStreamingPhase] = useState<string | null>(null);
  const [streamingRawText, setStreamingRawText] = useState("");
  const [streamingModel, setStreamingModel] = useState<string | null>(null);
  const [streamTokenCount, setStreamTokenCount] = useState(0);
  const [streamDurationMs, setStreamDurationMs] = useState<number | null>(null);
  const [activeTransitionKind, setActiveTransitionKind] = useState<"pregnancy" | "postpartum">(
    "pregnancy"
  );

  const [agentSummary, setAgentSummary] = useState<string | null>(null);
  const [specialistHandoff, setSpecialistHandoff] = useState<string | null>(null);
  const [aiMetadata, setAiMetadata] = useState<AiMetadata | null>(null);
  const [privacyReport, setPrivacyReport] = useState<PrivacyReport | null>(null);
  const [trace, setTrace] = useState<TraceStep[]>([]);

  const [verifyTarget, setVerifyTarget] = useState<Obligation | null>(null);
  const [clinicianName, setClinicianName] = useState("Dr. Layla Al-Hashimi (OB-GYN)");
  const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [showFhirExportModal, setShowFhirExportModal] = useState(false);

  const [testingSafetyId, setTestingSafetyId] = useState<string | null>(null);
  const [safetyBlockFeedback, setSafetyBlockFeedback] = useState<
    Record<string, SafetyBlockInfo>
  >({});

  const [docsDrawerOpen, setDocsDrawerOpen] = useState(false);
  const [docsInitialId, setDocsInitialId] = useState<string | null>(null);
  const [docsPrefs, setDocsPrefs] = useState<DocsSessionPrefs>(() => readDocsSessionPrefs());

  const [explainTarget, setExplainTarget] = useState<Obligation | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explainCache, setExplainCache] = useState<Record<string, ObligationExplanationResponse>>(
    {}
  );

  function openClinicalDocuments(docId?: string | null) {
    setDocsInitialId(docId ?? null);
    setDocsDrawerOpen(true);
  }

  const totalClinicalDocCount =
    5 + obligations.filter((o) => !SEEDED_OBLIGATION_IDS.has(o.id)).length;

  async function loadData(targetPatientId = selectedPatientId) {
    try {
      setError(null);
      const [hRes, oRes] = await Promise.all([
        fetch("/api/health"),
        fetch(`/api/obligations?patient_id=${encodeURIComponent(targetPatientId)}`),
      ]);
      if (hRes.ok) setHealth(await hRes.json());
      if (oRes.ok) {
        const data = await oRes.json();
        setObligations(data.obligations ?? []);
        setAuditEvents(data.audit_events ?? []);
        if (Array.isArray(data.patients) && data.patients.length > 0) {
          setPatients(data.patients);
        }
        if (data.cohort_totals) {
          setCohortTotals(data.cohort_totals);
        }
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
    void loadData("PAT-AE-4092");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelectPatient(patientId: string) {
    if (patientId === selectedPatientId) return;
    setSelectedPatientId(patientId);
    setAgentSummary(null);
    setSpecialistHandoff(null);
    setAiMetadata(null);
    setPrivacyReport(null);
    setTrace([]);
    setSafetyBlockFeedback({});
    setVerifyTarget(null);
    setShowFhirExportModal(false);
    setExplainTarget(null);
    setExplainError(null);
    setError(null);
    void loadData(patientId);
  }

  function getExplainCacheKey(obl: Obligation): string {
    return `${obl.id}:${obl.life_stage}:${obl.status}`;
  }

  async function handleExplainObligation(obl: Obligation, forceRefresh = false) {
    const cacheKey = getExplainCacheKey(obl);
    setExplainTarget(obl);
    setExplainError(null);
    if (!forceRefresh && explainCache[cacheKey]) {
      return;
    }

    setExplainLoading(true);
    try {
      const res = await fetch(`/api/obligations/${encodeURIComponent(obl.id)}/explain`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.detail || `Explain request failed (HTTP ${res.status})`);
      }
      const explanationData = body as ObligationExplanationResponse;
      setExplainCache((prev) => ({
        ...prev,
        [cacheKey]: explanationData,
      }));
      if (Array.isArray(explanationData.audit_events)) {
        setAuditEvents(explanationData.audit_events);
      }
    } catch (err) {
      setExplainError(
        err instanceof Error ? err.message : "Unable to generate AI explanation."
      );
    } finally {
      setExplainLoading(false);
    }
  }

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || docsDrawerOpen || document.querySelector("dialog[open]")) {
        return;
      }
      if (verifyTarget) {
        setVerifyTarget(null);
      } else if (showFhirExportModal) {
        setShowFhirExportModal(false);
      } else if (showIntakeModal) {
        setShowIntakeModal(false);
      }
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [docsDrawerOpen, verifyTarget, showFhirExportModal, showIntakeModal]);

  async function runTransition(
    endpoint: "/api/transitions/pregnancy" | "/api/transitions/postpartum"
  ) {
    const kind = endpoint.includes("postpartum") ? "postpartum" : "pregnancy";
    const startedAt = performance.now();
    setActiveTransitionKind(kind);
    setLoading(true);
    setIsStreaming(true);
    setStreamingPhase("Running deterministic clinical rules & UAE PHI firewall…");
    setStreamingRawText("");
    setStreamingModel(null);
    setStreamTokenCount(0);
    setStreamDurationMs(null);
    setSafetyBlockFeedback({});
    setAgentSummary(null);
    setSpecialistHandoff(null);
    setAiMetadata(null);
    setError(null);

    try {
      const res = await fetch(
        `${endpoint}/stream?patient_id=${encodeURIComponent(selectedPatientId)}`,
        {
          method: "POST",
          headers: { Accept: "text/event-stream" },
        }
      );
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
          if (Array.isArray(payload.patients) && payload.patients.length > 0) {
            setPatients(payload.patients);
          }
          if (payload.cohort_totals) setCohortTotals(payload.cohort_totals);
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
          if (Array.isArray(payload.patients) && payload.patients.length > 0) {
            setPatients(payload.patients);
          }
          if (payload.cohort_totals) setCohortTotals(payload.cohort_totals);
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

  async function handleTestSafetyGuard(obl: Obligation) {
    setTestingSafetyId(obl.id);
    setError(null);
    try {
      const res = await fetch(`/api/obligations/${obl.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinician_name: "Dr. Layla Al-Hashimi (OB-GYN · Safety Guard Test)",
          closure_evidence: "Simulated premature live-vaccine closure attempt during pregnancy.",
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setSafetyBlockFeedback((prev) => ({
          ...prev,
          [obl.id]: {
            status: res.status,
            ruleVersion: obl.rule_version,
            detail:
              body.detail ||
              "Clinical safety guard blocked premature closure during pregnancy.",
          },
        }));
        await loadData(selectedPatientId);
      } else if (!res.ok) {
        setError(body.detail || `Unexpected response (HTTP ${res.status})`);
      }
    } catch {
      setError("Unable to reach ReproBridge API to test safety guard.");
    } finally {
      setTestingSafetyId(null);
    }
  }

  async function handleReset() {
    setLoading(true);
    setAgentSummary(null);
    setSpecialistHandoff(null);
    setAiMetadata(null);
    setPrivacyReport(null);
    setSafetyBlockFeedback({});
    setShowFhirExportModal(false);
    setExplainTarget(null);
    setExplainError(null);
    setExplainCache({});
    setTrace([]);
    setError(null);
    try {
      const res = await fetch(
        `/api/demo/reset?patient_id=${encodeURIComponent(selectedPatientId)}`,
        { method: "POST" }
      );
      if (res.ok) {
        const data = await res.json();
        setObligations(data.obligations ?? []);
        setAuditEvents(data.audit_events ?? []);
        if (Array.isArray(data.patients) && data.patients.length > 0) {
          setPatients(data.patients);
        }
        if (data.cohort_totals) {
          setCohortTotals(data.cohort_totals);
        }
      }
    } finally {
      setLoading(false);
    }
  }

  const parsedStream = parseStreamedSections(streamingRawText);
  const displaySummary = agentSummary ?? (isStreaming ? parsedStream.summary : null);
  const displayHandoff = specialistHandoff ?? (isStreaming ? parsedStream.handoff : null);
  const selectedPatientMeta = patients.find((p) => p.patient_id === selectedPatientId);
  const patient: Obligation | undefined = obligations[0] ?? (selectedPatientMeta
    ? {
        id: "",
        patient_id: selectedPatientMeta.patient_id,
        patient_name: selectedPatientMeta.patient_name,
        life_stage: selectedPatientMeta.life_stage,
        title: "",
        rationale: "",
        evidence_source: "",
        rule_version: "",
        owner: "",
        status: "OPEN",
        priority: "MEDIUM",
        verified_by: null,
        closure_evidence: null,
      }
    : undefined);
  const activePatientName =
    patient?.patient_name ?? selectedPatientMeta?.patient_name ?? "Amina Al-Mansoori (Synthetic)";
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
      <DemoTopBar
        health={health}
        totalClinicalDocCount={totalClinicalDocCount}
        onBackToTutorial={onBackToTutorial}
        onOpenClinicalDocuments={() => openClinicalDocuments()}
      />

      <PatientCohortBar
        patients={patients}
        cohortTotals={cohortTotals}
        selectedPatientId={selectedPatientId}
        loading={loading || isStreaming}
        onSelectPatient={handleSelectPatient}
      />

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        <CareFlowAndPatientHeader
          activeStep={activeStep}
          patient={patient}
          currentLifeStage={currentLifeStage}
          isAntenatal={isAntenatal}
          isPostpartum={isPostpartum}
          obligations={obligations}
          loading={loading}
          onRunTransition={runTransition}
          onReset={handleReset}
        />

        <OrchestratorHarnessSection
          isStreaming={isStreaming}
          streamingPhase={streamingPhase}
          streamingModel={streamingModel}
          streamTokenCount={streamTokenCount}
          streamDurationMs={streamDurationMs}
          activeTransitionKind={activeTransitionKind}
          agentSummary={agentSummary}
          specialistHandoff={specialistHandoff}
          onUpdateSpecialistHandoff={setSpecialistHandoff}
          displaySummary={displaySummary}
          displayHandoff={displayHandoff}
          aiMetadata={aiMetadata}
          privacyReport={privacyReport}
          trace={trace}
          obligations={obligations}
          patient={patient}
          loading={loading}
          onRunTransition={runTransition}
          onOpenFhirExport={() => setShowFhirExportModal(true)}
          onOpenVerifyModal={setVerifyTarget}
        />

        <ObligationPassportSection
          obligations={obligations}
          initialLoading={initialLoading}
          loading={loading}
          testingSafetyId={testingSafetyId}
          safetyBlockFeedback={safetyBlockFeedback}
          onDismissSafetyBlock={(oblId) =>
            setSafetyBlockFeedback((prev) => {
              const next = { ...prev };
              delete next[oblId];
              return next;
            })
          }
          onTestSafetyGuard={handleTestSafetyGuard}
          onOpenVerifyModal={setVerifyTarget}
          onOpenFhirExport={() => setShowFhirExportModal(true)}
          onOpenIntakeModal={() => setShowIntakeModal(true)}
          onOpenClinicalDocument={(docId) => openClinicalDocuments(docId)}
          onExplainObligation={(obl) => {
            void handleExplainObligation(obl);
          }}
          explainingId={explainLoading ? explainTarget?.id ?? null : null}
        />

        <AuditGovernanceSection
          auditEvents={auditEvents}
          residencyPolicy={health?.residency_policy}
        />
      </main>

      {verifyTarget && (
        <VerifyClosureModal
          target={verifyTarget}
          loading={loading}
          defaultClinicianName={clinicianName}
          onClose={() => setVerifyTarget(null)}
          onVerified={async (clinicianUsed) => {
            setClinicianName(clinicianUsed);
            await loadData(selectedPatientId);
          }}
          onAuditUpdated={setAuditEvents}
          onError={setError}
        />
      )}

      <ObligationIntakeModal
        isOpen={showIntakeModal}
        patientId={selectedPatientId}
        patientName={activePatientName}
        onClose={() => setShowIntakeModal(false)}
        onImported={(nextObligations, nextAuditEvents, nextPatients, nextCohortTotals) => {
          setObligations(nextObligations);
          setAuditEvents(nextAuditEvents);
          if (Array.isArray(nextPatients) && nextPatients.length > 0) {
            setPatients(nextPatients);
          }
          if (nextCohortTotals) {
            setCohortTotals(nextCohortTotals);
          }
        }}
        onError={setError}
      />

      <FhirExportModal
        isOpen={showFhirExportModal}
        onClose={() => setShowFhirExportModal(false)}
        obligations={obligations}
        currentLifeStage={currentLifeStage}
        displaySummary={displaySummary}
        displayHandoff={displayHandoff}
      />

      {/* Draggable Edge-Snapping Tab for Clinician Source Documents */}
      <FloatingDocsTab
        count={totalClinicalDocCount}
        initialSide={docsPrefs.side}
        initialYRatio={docsPrefs.yRatio}
        onDockChange={(side, yRatio) =>
          setDocsPrefs((prev) => ({ ...prev, side, yRatio }))
        }
        onOpen={() => openClinicalDocuments()}
      />

      {/* Floating Zero-PHI AI Explainer with Browser Speech Audio */}
      <ObligationExplainerPopover
        obligation={explainTarget}
        data={explainTarget ? explainCache[getExplainCacheKey(explainTarget)] ?? null : null}
        loading={explainLoading}
        error={explainError}
        onRetry={() => {
          if (explainTarget) void handleExplainObligation(explainTarget, true);
        }}
        onClose={() => {
          setExplainTarget(null);
          setExplainError(null);
        }}
      />

      {/* Clinician-Only Clinical Documents Side Drawer (Zero AI Egress) */}
      <ClinicalDocumentsDrawer
        isOpen={docsDrawerOpen}
        onClose={() => setDocsDrawerOpen(false)}
        initialDocId={docsInitialId}
        currentLifeStage={currentLifeStage}
        obligations={obligations}
        patientId={selectedPatientId}
        clinicianLabel={clinicianName}
        side={docsPrefs.side}
        drawerWidth={docsPrefs.drawerWidth}
        onDrawerWidthChange={(drawerWidth) =>
          setDocsPrefs((prev) => ({ ...prev, drawerWidth }))
        }
      />
    </div>
  );
}
