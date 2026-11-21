import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import ClinicalDocumentsDrawer from "./ClinicalDocumentsDrawer";
import AuditGovernanceSection from "./demo/AuditGovernanceSection";
import CareFlowAndPatientHeader from "./demo/CareFlowAndPatientHeader";
import DemoTopBar from "./demo/DemoTopBar";
import FhirExportModal from "./demo/FhirExportModal";
import ObligationIntakeModal from "./demo/ObligationIntakeModal";
import ObligationPassportSection from "./demo/ObligationPassportSection";
import OrchestratorHarnessSection from "./demo/OrchestratorHarnessSection";
import VerifyClosureModal from "./demo/VerifyClosureModal";
import { parseStreamedSections } from "./demo/helpers";
import type {
  AiMetadata,
  AuditEvent,
  HealthResponse,
  Obligation,
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

export default function PrototypeDemo({ onBackToTutorial }: PrototypeDemoProps) {
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

  function openClinicalDocuments(docId?: string | null) {
    setDocsInitialId(docId ?? null);
    setDocsDrawerOpen(true);
  }

  const totalClinicalDocCount =
    5 + obligations.filter((o) => o.id !== "OBL-101" && o.id !== "OBL-102").length;

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
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || docsDrawerOpen) return;
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
        await loadData();
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
      <DemoTopBar
        health={health}
        totalClinicalDocCount={totalClinicalDocCount}
        onBackToTutorial={onBackToTutorial}
        onOpenClinicalDocuments={() => openClinicalDocuments()}
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
            await loadData();
          }}
          onAuditUpdated={setAuditEvents}
          onError={setError}
        />
      )}

      <ObligationIntakeModal
        isOpen={showIntakeModal}
        onClose={() => setShowIntakeModal(false)}
        onImported={(nextObligations, nextAuditEvents) => {
          setObligations(nextObligations);
          setAuditEvents(nextAuditEvents);
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

      {/* Persistent Right-Edge Side Tab for Clinician Source Documents */}
      <button
        type="button"
        onClick={() => openClinicalDocuments()}
        aria-label={`Open Clinical Source Documents (${totalClinicalDocCount} synthetic records)`}
        className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-center gap-2 rounded-l-xl border border-r-0 border-slate-300 bg-white/95 px-2.5 py-3.5 text-xs font-semibold text-slate-800 shadow-lg backdrop-blur-xs transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-950 md:flex"
      >
        <FileText className="h-4 w-4 text-teal-700" aria-hidden="true" />
        <span className="[writing-mode:vertical-rl] rotate-180 tracking-wide">
          Clinical Docs
        </span>
        <span className="rounded-full bg-teal-600 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
          {totalClinicalDocCount}
        </span>
      </button>

      {/* Clinician-Only Clinical Documents Side Drawer (Zero AI Egress) */}
      <ClinicalDocumentsDrawer
        isOpen={docsDrawerOpen}
        onClose={() => setDocsDrawerOpen(false)}
        initialDocId={docsInitialId}
        currentLifeStage={currentLifeStage}
        obligations={obligations}
        clinicianLabel={clinicianName}
      />
    </div>
  );
}
