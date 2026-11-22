import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileText,
  Lock,
  Search,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { DEFAULT_PATIENT_COHORT } from "./constants";
import { parseStreamedQuestionnaire } from "./helpers";
import type {
  Obligation,
  PatientCohortSummary,
  PrivacyReport,
  ReconciliationOnboardingResult,
  ReconciliationQuestion,
  ReconciliationQuestionnaireResponse,
} from "./types";

interface PatientSearchOnboardingProps {
  initialPatientId?: string;
  initialStep?: "search" | "questionnaire";
  onBackToTutorial: () => void;
  onCompleteOnboarding: (result: ReconciliationOnboardingResult) => void;
  onSkipToWorkbench?: (patientId: string) => void;
}

type StageFilter = "ALL" | "Preconception" | "Antenatal" | "Postpartum";

function getLifeStageBadgeStyle(lifeStage: string): string {
  if (lifeStage === "Postpartum") {
    return "border-indigo-200 bg-indigo-50 text-indigo-800";
  }
  if (lifeStage.startsWith("Antenatal")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  return "border-sky-200 bg-sky-50 text-sky-800";
}

function getLifeStageButtonStyle(lifeStage: string): string {
  if (lifeStage === "Postpartum") {
    return "bg-indigo-600 hover:bg-indigo-700 text-white";
  }
  if (lifeStage.startsWith("Antenatal")) {
    return "bg-amber-600 hover:bg-amber-700 text-white";
  }
  return "bg-sky-600 hover:bg-sky-700 text-white";
}

function getStageFilterStyle(stageOpt: StageFilter, active: boolean): string {
  if (stageOpt === "Preconception") {
    return active
      ? "bg-sky-600 text-white shadow-2xs"
      : "border border-sky-200 bg-sky-50/70 text-sky-800 hover:bg-sky-100";
  }
  if (stageOpt === "Antenatal") {
    return active
      ? "bg-amber-600 text-white shadow-2xs"
      : "border border-amber-200 bg-amber-50/70 text-amber-800 hover:bg-amber-100";
  }
  if (stageOpt === "Postpartum") {
    return active
      ? "bg-indigo-600 text-white shadow-2xs"
      : "border border-indigo-200 bg-indigo-50/70 text-indigo-800 hover:bg-indigo-100";
  }
  return active
    ? "bg-teal-600 text-white shadow-2xs"
    : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100";
}

function inferTargetLifeStage(
  answer: string,
  fallbackStage: string
): "Preconception" | "Antenatal (Trimester 1)" | "Postpartum" {
  const lowered = answer.toLowerCase();
  if (/postpartum|deliver|post-delivery/.test(lowered)) {
    return "Postpartum";
  }
  if (/still preconception|not currently pregnant|not pregnant/.test(lowered)) {
    return "Preconception";
  }
  if (/week|wk|antenatal|trimester|pregnant|gestation|scan|crl|booking/.test(lowered)) {
    return "Antenatal (Trimester 1)";
  }
  if (fallbackStage === "Postpartum") return "Postpartum";
  if (fallbackStage.startsWith("Antenatal")) return "Antenatal (Trimester 1)";
  return "Preconception";
}

function buildLocalFallbackQuestions(
  patient: PatientCohortSummary,
  obligations: Obligation[]
): { contextNote: string; questions: ReconciliationQuestion[] } {
  const isPostpartum = obligations.some((o) => o.life_stage === "Postpartum");
  const isAntenatal =
    !isPostpartum && obligations.some((o) => o.life_stage.startsWith("Antenatal"));
  const primaryTitle = obligations[0]?.title ?? patient.clinical_track;

  return {
    contextNote:
      "Confirm live pregnancy dating, active medications, and external lab documents before opening the longitudinal workbench.",
    questions: [
      {
        id: "pregnancy_stage",
        category: "Pregnancy Stage & Dating",
        question:
          "What pregnancy stage are we at today? The HIE data shows Preconception / 5th week early dating note, which may actually be 8th week on ultrasound.",
        data_shows: `HIE Record: ${patient.life_stage}${isAntenatal ? " (5th-week booking note)" : ""}`,
        options: isPostpartum
          ? [
              "Postpartum Day 1–3 (Pre-discharge hospital ward)",
              "Postpartum Week 2–6 (Outpatient follow-up clinic)",
              "Still Antenatal (discharge record entered in error)",
            ]
          : [
              "8th week gestation (Antenatal Trimester 1 updated by scan)",
              "5th week gestation (Antenatal Trimester 1 — matches early note)",
              "Still Preconception (Not currently pregnant)",
              "Postpartum / recently delivered",
            ],
        placeholder: "e.g., 8th week gestation by ultrasound today (record showed 5th week)...",
      },
      {
        id: "medications",
        category: "Medication Reconciliation",
        question:
          "What medications are we on right now? Is anything different from what the current EMR data shows?",
        data_shows: "HIE Medication List: Prenatal Folic Acid 400 mcg daily",
        options: [
          "Matches current HIE medication list (Folic Acid 400 mcg daily)",
          "Started new prescription externally since last visit",
          "Discontinued or modified prior regimen",
        ],
        placeholder: "Enter active medications or differences vs HIE data...",
      },
      {
        id: "scenario_specific",
        category: "Scenario & Document Verification",
        question: `Regarding "${primaryTitle}": do the imported HIE documents match today's labs and visit history?`,
        data_shows: `${obligations.length || patient.total_obligations} obligation(s) imported from ${patient.facility_a}`,
        options: [
          "Documents match today's clinical scenario — keep obligations active",
          "New external lab result brought today (pending import)",
        ],
        placeholder: "Note any outside lab values, scans, or immunization updates...",
      },
    ],
  };
}

export default function PatientSearchOnboarding({
  initialPatientId = "PAT-AE-4092",
  initialStep = "search",
  onBackToTutorial,
  onCompleteOnboarding,
  onSkipToWorkbench,
}: PatientSearchOnboardingProps) {
  const searchInputId = useId();
  const additionalInfoId = useId();

  const [step, setStep] = useState<"search" | "questionnaire">(initialStep);
  const [patients, setPatients] = useState<PatientCohortSummary[]>(DEFAULT_PATIENT_COHORT);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("ALL");
  const [loadingPatients, setLoadingPatients] = useState(true);

  const [selectedPatient, setSelectedPatient] = useState<PatientCohortSummary>(
    () =>
      DEFAULT_PATIENT_COHORT.find((p) => p.patient_id === initialPatientId) ??
      DEFAULT_PATIENT_COHORT[0]
  );
  const [patientObligations, setPatientObligations] = useState<Obligation[]>([]);

  const [isStreamingQuestions, setIsStreamingQuestions] = useState(false);
  const [streamRawText, setStreamRawText] = useState("");
  const [streamTokenCount, setStreamTokenCount] = useState(0);
  const [streamModel, setStreamModel] = useState<string | null>(null);
  const [privacyReport, setPrivacyReport] = useState<PrivacyReport | null>(null);
  const [contextNote, setContextNote] = useState("");
  const [questions, setQuestions] = useState<ReconciliationQuestion[]>([]);
  const [questionError, setQuestionError] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const streamAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchCohort() {
      try {
        const res = await fetch("/api/patients?limit=50");
        if (!res.ok) return;
        const data = await res.json();
        if (active && Array.isArray(data.patients) && data.patients.length > 0) {
          setPatients(data.patients);
          const matched = data.patients.find(
            (p: PatientCohortSummary) => p.patient_id === initialPatientId
          );
          if (matched) setSelectedPatient(matched);
        }
      } catch {
        // Retain DEFAULT_PATIENT_COHORT cleanly in offline/error cases
      } finally {
        if (active) setLoadingPatients(false);
      }
    }
    void fetchCohort();
    return () => {
      active = false;
      streamAbortRef.current?.abort();
    };
  }, [initialPatientId]);

  useEffect(() => {
    if (initialStep === "questionnaire") {
      const target =
        patients.find((p) => p.patient_id === initialPatientId) ?? selectedPatient;
      void startQuestionnaireForPatient(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredPatients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return patients.filter((p) => {
      if (stageFilter !== "ALL" && !p.life_stage.startsWith(stageFilter)) {
        return false;
      }
      if (!q) return true;
      const haystack = `${p.patient_id} ${p.patient_name} ${p.clinical_track} ${p.facility_a} ${p.facility_b} ${p.life_stage}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [patients, searchQuery, stageFilter]);

  async function startQuestionnaireForPatient(target: PatientCohortSummary) {
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;

    setSelectedPatient(target);
    setStep("questionnaire");
    setQuestionError(null);
    setFormError(null);
    setAnswers({});
    setAdditionalInfo("");
    setQuestions([]);
    setContextNote("");
    setPrivacyReport(null);
    setStreamRawText("");
    setStreamTokenCount(0);
    setStreamModel(null);
    setIsStreamingQuestions(true);

    let loadedObls: Obligation[] = [];
    try {
      const oRes = await fetch(
        `/api/obligations?patient_id=${encodeURIComponent(target.patient_id)}`,
        { signal: controller.signal }
      );
      if (oRes.ok) {
        const oData = await oRes.json();
        loadedObls = oData.obligations ?? [];
        setPatientObligations(loadedObls);
      }
    } catch {
      // Continue cleanly to questionnaire stream
    }

    try {
      const res = await fetch(
        `/api/patients/${encodeURIComponent(target.patient_id)}/reconcile-questions/stream`,
        {
          method: "POST",
          signal: controller.signal,
        }
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let completed = false;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";

          for (const frame of frames) {
            if (!frame.trim()) continue;
            let eventName = "message";
            const dataLines: string[] = [];
            for (const line of frame.split(/\r?\n/)) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
              }
            }
            if (dataLines.length === 0) continue;
            const parsed = JSON.parse(dataLines.join("\n"));

            if (eventName === "firewall_verified") {
              setPrivacyReport(parsed.privacy_report ?? null);
            } else if (eventName === "token") {
              const delta = String(parsed.delta ?? "");
              setStreamRawText((prev) => prev + delta);
              setStreamTokenCount((n) => n + 1);
              if (parsed.model) setStreamModel(String(parsed.model));
            } else if (eventName === "complete") {
              completed = true;
              const payload = parsed as ReconciliationQuestionnaireResponse;
              setContextNote(payload.context_note);
              setQuestions(payload.questions ?? []);
              setPrivacyReport(payload.privacy_report ?? null);
              if (payload.ai_metadata?.model && payload.ai_metadata.model !== "none") {
                setStreamModel(payload.ai_metadata.model);
              }
            }
          }
        }

        if (!completed) {
          throw new Error("Incomplete questionnaire stream");
        }
      } else {
        const payload = (await res.json()) as ReconciliationQuestionnaireResponse;
        setContextNote(payload.context_note);
        setQuestions(payload.questions ?? []);
        setPrivacyReport(payload.privacy_report ?? null);
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      // Fallback to batch endpoint, then local deterministic baseline questions
      try {
        const batchRes = await fetch(
          `/api/patients/${encodeURIComponent(target.patient_id)}/reconcile-questions`,
          { method: "POST", signal: controller.signal }
        );
        if (batchRes.ok) {
          const payload = (await batchRes.json()) as ReconciliationQuestionnaireResponse;
          setContextNote(payload.context_note);
          setQuestions(payload.questions ?? []);
          setPrivacyReport(payload.privacy_report ?? null);
          return;
        }
      } catch {
        // Proceed to local fallback below
      }
      const localFb = buildLocalFallbackQuestions(target, loadedObls);
      setContextNote(localFb.contextNote);
      setQuestions(localFb.questions);
      setQuestionError(
        "Loaded deterministic reconciliation questions (streaming endpoint offline)."
      );
    } finally {
      if (!controller.signal.aborted) {
        setIsStreamingQuestions(false);
      }
    }
  }

  function handleSelectOption(questionId: string, optionText: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: optionText }));
    setFormError(null);
  }

  async function handleSubmitReconciliation(e: FormEvent) {
    e.preventDefault();
    const pregnancyStageAnswer = (answers.pregnancy_stage ?? "").trim();
    const medicationsAnswer = (answers.medications ?? "").trim();
    const scenarioAnswer = (answers.scenario_specific ?? "").trim();

    if (!pregnancyStageAnswer || !medicationsAnswer) {
      setFormError(
        "Please select or enter both the patient's current pregnancy stage and active medications before opening the full view."
      );
      return;
    }

    const targetLifeStage = inferTargetLifeStage(
      pregnancyStageAnswer,
      selectedPatient.life_stage
    );

    setSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch(
        `/api/patients/${encodeURIComponent(selectedPatient.patient_id)}/reconcile-submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pregnancy_stage_answer: pregnancyStageAnswer,
            target_life_stage: targetLifeStage,
            medications_answer: medicationsAnswer,
            scenario_answer: scenarioAnswer,
            additional_info: additionalInfo.trim(),
          }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setFormError(errData.detail ?? `Unable to save reconciliation (HTTP ${res.status}).`);
        return;
      }

      const data = await res.json();
      onCompleteOnboarding({
        patientId: selectedPatient.patient_id,
        reconciliation: data.reconciliation,
        transitionResult: data.transition_result ?? null,
      });
    } catch {
      setFormError("Unable to reach ReproBridge API to submit clinical reconciliation.");
    } finally {
      setSubmitting(false);
    }
  }

  const liveParsedStream = useMemo(
    () => parseStreamedQuestionnaire(streamRawText),
    [streamRawText]
  );

  const stageAnswer = answers.pregnancy_stage ?? "";
  const predictedStage = inferTargetLifeStage(stageAnswer, selectedPatient.life_stage);
  const willAutoTransition =
    stageAnswer.trim().length > 0 && predictedStage !== selectedPatient.life_stage;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onBackToTutorial}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to Tutorial
            </button>
            <span className="h-4 w-px bg-slate-200" aria-hidden="true" />
            <img
              src="/reprobridge-logo-full.png"
              alt="ReproBridge — Connected care for women"
              width={272}
              height={84}
              className="h-14 w-auto object-contain"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 text-base font-bold text-teal-800 sm:text-lg">
              <CheckCircle2 className="h-5 w-5 text-teal-600" aria-hidden="true" />
              {step === "search"
                ? "Step 1 of 2 · Patient Search"
                : "Step 2 of 2 · AI Scenario Reconciliation"}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        {step === "search" ? (
          <section aria-labelledby="patient-search-heading" className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-xs">
              <p className="text-xs font-bold uppercase tracking-wider text-teal-700">
                Malaffi HIE & Facility Registry · UAE Boundary
              </p>
              <h1
                id="patient-search-heading"
                className="mt-1 text-2xl font-bold tracking-tight text-slate-900"
              >
                Search & Select Patient Record
              </h1>
              <p className="mx-auto mt-1.5 max-w-2xl text-sm text-slate-600">
                Choose a patient record to launch an AI-streamed intake reconciliation check
                (gestational dating, active medications, and HIE document alignment) before opening
                the full Care Continuity Workbench.
              </p>

              <div className="mx-auto mt-5 flex w-full max-w-xl flex-col items-center gap-3">
                <div className="relative w-full">
                  <label htmlFor={searchInputId} className="sr-only">
                    Search patients by name, MRN, track, or facility
                  </label>
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id={searchInputId}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by patient name, MRN (e.g. PAT-AE-4092), clinical track, or facility..."
                    className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>

                <div
                  className="flex flex-wrap items-center justify-center gap-2"
                  role="group"
                  aria-label="Filter by life stage"
                >
                  {(["ALL", "Preconception", "Antenatal", "Postpartum"] as const).map(
                    (stageOpt) => {
                      const active = stageFilter === stageOpt;
                      return (
                        <button
                          key={stageOpt}
                          type="button"
                          onClick={() => setStageFilter(stageOpt)}
                          aria-pressed={active}
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${getStageFilterStyle(
                            stageOpt,
                            active
                          )}`}
                        >
                          {stageOpt === "ALL" ? "All Stages" : stageOpt}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            </div>

            {filteredPatients.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
                <p className="text-sm font-medium text-slate-700">
                  No synthetic patient records match &ldquo;{searchQuery}&rdquo;.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setStageFilter("ALL");
                  }}
                  className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <ul className="grid gap-4 md:grid-cols-3">
                {filteredPatients.map((p) => (
                  <li
                    key={p.patient_id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-teal-300 hover:shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="font-mono text-xs font-semibold text-teal-700">
                            {p.patient_id}
                          </span>
                          <h2 className="mt-0.5 text-base font-semibold text-slate-900">
                            {p.patient_name}
                          </h2>
                          <p className="text-xs text-slate-500">{p.age_sex}</p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getLifeStageBadgeStyle(
                            p.life_stage
                          )}`}
                        >
                          {p.life_stage}
                        </span>
                      </div>

                      <p className="mt-3 text-xs font-medium text-slate-700">
                        {p.clinical_track}
                      </p>

                      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                        <span className="truncate">
                          {p.facility_a} → {p.facility_b}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          {p.total_obligations} Care Gaps
                        </span>
                        {p.urgent_count > 0 && (
                          <span className="rounded bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                            {p.urgent_count} Urgent
                          </span>
                        )}
                        {p.deferred_count > 0 && (
                          <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                            {p.deferred_count} Deferred
                          </span>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void startQuestionnaireForPatient(p)}
                      className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-2xs transition ${getLifeStageButtonStyle(
                        p.life_stage
                      )}`}
                    >
                      Select Patient & Reconcile
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {loadingPatients && (
              <p className="text-center text-xs text-slate-400">
                Syncing live cohort totals from UAE Neon PostgreSQL…
              </p>
            )}
          </section>
        ) : (
          <section aria-labelledby="reconcile-heading" className="space-y-5">
            {/* Selected Patient Context Header */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      streamAbortRef.current?.abort();
                      setIsStreamingQuestions(false);
                      setStep("search");
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    Change Patient
                  </button>
                  <span className="font-mono text-xs font-semibold text-teal-700">
                    {selectedPatient.patient_id}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${getLifeStageBadgeStyle(
                      selectedPatient.life_stage
                    )}`}
                  >
                    HIE Stage: {selectedPatient.life_stage}
                  </span>
                </div>

                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {privacyReport?.phi_check_passed
                    ? "UAE Firewall Verified · 0 PHI Sent to AI"
                    : "UAE Privacy Firewall Active"}
                </span>
              </div>

              <h1 id="reconcile-heading" className="mt-3 text-xl font-bold text-slate-900">
                Scenario & Document Reconciliation — {selectedPatient.patient_name}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                Verify whether today&apos;s live clinical scenario matches the imported HIE
                documents before opening the full Care Continuity Workbench.
              </p>

              {/* Baseline HIE Obligations Snapshot */}
              {patientObligations.length > 0 && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <FileText className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                    Current HIE / FHIR Documents on File ({patientObligations.length})
                  </p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {patientObligations.map((obl) => (
                      <li
                        key={obl.id}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-teal-700">
                            {obl.id}
                          </span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                            {obl.priority} · {obl.status}
                          </span>
                        </div>
                        <p className="mt-1 font-medium text-slate-900">{obl.title}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {obl.evidence_source}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* AI-Streamed Clinical Questionnaire */}
            <form
              onSubmit={(e) => void handleSubmitReconciliation(e)}
              className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-teal-600" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    AI-Generated Verification Questions
                  </h2>
                </div>
                {isStreamingQuestions ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-800">
                    <progress aria-label="Streaming AI questions" className="rb-spinner" />
                    Streaming scenario questions
                    {streamTokenCount > 0 ? ` (${streamTokenCount} chunks)` : "…"}
                  </span>
                ) : (
                  <span className="text-[11px] text-slate-500">
                    {streamModel ? `Prepared via ${streamModel} (0 PHI)` : "Ready for clinician review"}
                  </span>
                )}
              </div>

              {(contextNote || liveParsedStream.context_note) && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/70 px-3.5 py-2.5 text-xs text-teal-950">
                  <strong className="font-semibold">AI Verification Focus:</strong>{" "}
                  {contextNote || liveParsedStream.context_note}
                </div>
              )}

              {questionError && (
                <p className="text-xs text-amber-700">{questionError}</p>
              )}

              {isStreamingQuestions && questions.length === 0 ? (
                <div className="space-y-3" aria-live="polite">
                  {liveParsedStream.questions.filter((q) => q.question).length > 0 ? (
                    liveParsedStream.questions.map((q, idx) =>
                      q.question ? (
                        <div
                          key={idx}
                          className="rounded-lg border border-teal-200 bg-teal-50/30 p-4 text-sm text-slate-800"
                        >
                          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
                            Question {idx + 1}
                          </p>
                          <p className="mt-1 font-medium">{q.question}</p>
                          {q.options.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {q.options.map((opt) => (
                                <span
                                  key={opt}
                                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600"
                                >
                                  {opt}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null
                    )
                  ) : (
                    <div className="space-y-3" aria-label="Loading scenario questions">
                      <div className="rb-shimmer h-20 w-full rounded-lg" />
                      <div className="rb-shimmer h-20 w-full rounded-lg" />
                      <div className="rb-shimmer h-20 w-full rounded-lg" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {questions.map((q, idx) => {
                    const currentVal = answers[q.id] ?? "";
                    const inputId = `reconcile-q-${q.id}`;
                    return (
                      <div
                        key={q.id}
                        className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wider text-teal-700">
                            Q{idx + 1} · {q.category}
                          </span>
                          <span className="rounded bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                            {q.data_shows}
                          </span>
                        </div>

                        <label
                          htmlFor={inputId}
                          className="mt-2 block text-sm font-semibold text-slate-900"
                        >
                          {q.question}
                        </label>

                        {/* Quick-Select Option Chips */}
                        <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label={`${q.category} quick options`}>
                          {q.options.map((opt) => {
                            const selected = currentVal === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                aria-pressed={selected}
                                onClick={() => handleSelectOption(q.id, opt)}
                                className={`rounded-full px-3 py-1.5 text-left text-xs font-medium transition ${
                                  selected
                                    ? "bg-teal-600 text-white shadow-2xs ring-2 ring-teal-500/30"
                                    : "border border-slate-300 bg-white text-slate-700 hover:border-teal-400 hover:bg-teal-50/50"
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>

                        {/* Editable Text Input */}
                        <input
                          id={inputId}
                          type="text"
                          value={currentVal}
                          onChange={(e) => {
                            setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }));
                            setFormError(null);
                          }}
                          placeholder={q.placeholder}
                          className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
                        />
                      </div>
                    );
                  })}

                  {/* Additional Information Field */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                    <label
                      htmlFor={additionalInfoId}
                      className="block text-sm font-semibold text-slate-900"
                    >
                      Any additional information
                    </label>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Add outside lab values, allergies, ultrasound notes, or care preferences to
                      carry into the audit log and workbench banner.
                    </p>
                    <textarea
                      id={additionalInfoId}
                      rows={3}
                      value={additionalInfo}
                      onChange={(e) => setAdditionalInfo(e.target.value)}
                      placeholder="e.g., Patient brought CRL scan confirming 8w2d gestation; started low-dose thyroid regimen yesterday..."
                      className="mt-2.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20"
                    />
                  </div>
                </div>
              )}

              {/* Live Stage Update Preview Banner */}
              {willAutoTransition && (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3.5 py-2.5 text-xs text-indigo-950"
                >
                  <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold">
                      Deterministic Rule Engine Preview:
                    </strong>{" "}
                    Confirming <span className="font-semibold">{stageAnswer}</span> will
                    automatically update life stage from{" "}
                    <span className="font-semibold">{selectedPatient.life_stage}</span> to{" "}
                    <span className="font-semibold">{predictedStage}</span>, reassessing clinical
                    obligations and recording an immutable audit entry.
                  </span>
                </div>
              )}

              {formError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    if (onSkipToWorkbench) {
                      onSkipToWorkbench(selectedPatient.patient_id);
                    }
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Skip straight to full view
                </button>

                <button
                  type="submit"
                  disabled={submitting || isStreamingQuestions}
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-2.5 text-sm font-medium text-white shadow-xs transition hover:bg-teal-700 disabled:opacity-50"
                >
                  {submitting ? "Reconciling & Updating Care Plan…" : "Confirm & Open Full Patient View"}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
