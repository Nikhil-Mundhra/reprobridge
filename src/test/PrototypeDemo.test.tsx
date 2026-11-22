import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import ClinicalDocumentsDrawer from "../ClinicalDocumentsDrawer";
import ClinicalMetricVisualizer, { extractClinicalMetrics } from "../demo/ClinicalMetricVisualizer";
import FloatingDocsTab from "../demo/FloatingDocsTab";
import {
  clearDocsSessionPrefs,
  DOCS_PREFS_COOKIE,
  readDocsSessionPrefs,
} from "../demo/docsSessionPrefs";
import PrototypeDemo, {
  SAMPLE_IMPORT_CSV,
  buildOutboundFhirBundle,
  detectObligationId,
  formatExecutionLabel,
  getUrgentDueChip,
  parseDelimitedTable,
  parseHandoffItems,
  parseStreamedExplanation,
  parseStreamedQuestionnaire,
  parseStreamedSections,
  type Obligation,
} from "../PrototypeDemo";
import { findSpatialCandidate, handleSpatialKeyDown } from "../spatialNav";

function makeSeedObligations(): Obligation[] {
  return [
    {
      id: "OBL-101",
      patient_id: "PAT-AE-4092",
      patient_name: "Amina Al-Mansoori (Synthetic)",
      life_stage: "Preconception",
      title: "Subclinical Hypothyroidism Follow-up (TSH 4.8 mIU/L)",
      rationale:
        "Preconception lab showed elevated TSH (4.8 mIU/L). Requires repeat TSH + free T4.",
      evidence_source: "FHIR Observation/obs-tsh-2026-09 (Malaffi HIE Synthetic)",
      rule_version: "RB-THYROID-v1.4.0",
      owner: "Primary Care / OB-GYN",
      status: "OPEN",
      priority: "HIGH",
      verified_by: null,
      closure_evidence: null,
    },
    {
      id: "OBL-102",
      patient_id: "PAT-AE-4092",
      patient_name: "Amina Al-Mansoori (Synthetic)",
      life_stage: "Preconception",
      title: "Rubella IgG Non-Immune Vaccination Verification",
      rationale:
        "Preconception screening indicated Rubella IgG non-immune status. Contraindicated during pregnancy.",
      evidence_source: "FHIR DiagnosticReport/rep-rubella-2026-08",
      rule_version: "RB-IMMUNE-v1.2.1",
      owner: "Preventive Care Nurse",
      status: "OPEN",
      priority: "MEDIUM",
      verified_by: null,
      closure_evidence: null,
    },
  ];
}

function makeFatimaObligations(): Obligation[] {
  return [
    {
      id: "OBL-201",
      patient_id: "PAT-AE-5180",
      patient_name: "Fatima Al-Zaabi (Synthetic)",
      life_stage: "Preconception",
      title: "Preconception Dysglycemia Follow-up (Fasting Glucose 112 mg/dL · HbA1c 6.1%)",
      rationale:
        "Preconception panel showed impaired fasting glucose (112 mg/dL) and HbA1c 6.1%.",
      evidence_source: "FHIR Observation/obs-hba1c-2026-09 (Malaffi HIE Synthetic)",
      rule_version: "RB-METABOLIC-v1.2.0",
      owner: "Primary Care / Endocrinology",
      status: "OPEN",
      priority: "HIGH",
      verified_by: null,
      closure_evidence: null,
    },
    {
      id: "OBL-202",
      patient_id: "PAT-AE-5180",
      patient_name: "Fatima Al-Zaabi (Synthetic)",
      life_stage: "Preconception",
      title: "Varicella-Zoster (VZV) IgG Non-Immune Vaccination Verification",
      rationale:
        "Preconception serology indicated VZV IgG non-immune status (<100 mIU/mL).",
      evidence_source: "FHIR DiagnosticReport/rep-vzv-2026-08",
      rule_version: "RB-IMMUNE-v1.2.1",
      owner: "Preventive Care Nurse",
      status: "OPEN",
      priority: "MEDIUM",
      verified_by: null,
      closure_evidence: null,
    },
  ];
}

function makePregnancyObligations(): Obligation[] {
  return [
    {
      ...makeSeedObligations()[0],
      life_stage: "Antenatal (Trimester 1)",
      priority: "URGENT",
      status: "ESCALATED_FOR_REVIEW",
      owner: "Maternal-Fetal Medicine / OB-GYN",
    },
    {
      ...makeSeedObligations()[1],
      life_stage: "Antenatal (Trimester 1)",
      priority: "HIGH",
      status: "DEFERRED_TO_POSTPARTUM",
      owner: "Postpartum Care Pathway",
    },
  ];
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createSseResponse(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const item of events) {
        controller.enqueue(
          encoder.encode(`event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`)
        );
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("PrototypeDemo pure helpers", () => {
  it("parses SAMPLE_IMPORT_CSV and quoted CSV / TSV tables accurately", () => {
    const sampleRows = parseDelimitedTable(SAMPLE_IMPORT_CSV);
    expect(sampleRows).toHaveLength(2);
    expect(sampleRows[0]).toMatchObject({
      title: "Gestational Diabetes OGTT Follow-up",
      priority: "HIGH",
      life_stage: "Antenatal (Trimester 1)",
      owner: "OB-GYN / Endocrinology",
      evidence_source: "FHIR Observation/obs-ogtt-2026-10",
      incoming_evidence_result: "3-hour OGTT normal across all 4 draws (fasting 84 mg/dL)",
    });

    const quotedCsv = [
      "title,rationale,priority,life_stage",
      '"Anemia, Iron Deficiency","Ferritin 10 ng/mL, repeat in 6 weeks",high,Preconception',
      ",Missing title should be skipped,LOW,Preconception",
    ].join("\n");
    const quotedRows = parseDelimitedTable(quotedCsv);
    expect(quotedRows).toHaveLength(1);
    expect(quotedRows[0]).toMatchObject({
      title: "Anemia, Iron Deficiency",
      rationale: "Ferritin 10 ng/mL, repeat in 6 weeks",
      priority: "HIGH",
      life_stage: "Preconception",
    });

    const tsv = [
      "obligation\tdescription\tseverity\tstage\tspecialty",
      "Vitamin D Follow-up\t25-OH Vitamin D 14 ng/mL\turgent\tAntenatal (Trimester 1)\tOB-GYN",
    ].join("\n");
    const tsvRows = parseDelimitedTable(tsv);
    expect(tsvRows).toHaveLength(1);
    expect(tsvRows[0]).toMatchObject({
      title: "Vitamin D Follow-up",
      rationale: "25-OH Vitamin D 14 ng/mL",
      priority: "URGENT",
      owner: "OB-GYN",
    });

    expect(parseDelimitedTable("title,rationale")).toEqual([]);
  });

  it("builds a FHIR R4 transaction Bundle with CarePlan, Tasks, governance tag, and handoff extension", () => {
    const obs: Obligation[] = [
      {
        ...makeSeedObligations()[0],
        life_stage: "Antenatal (Trimester 1)",
        priority: "URGENT",
        status: "VERIFIED_CLOSED",
        verified_by: "Dr. Layla Al-Hashimi (OB-GYN)",
        closure_evidence: "Repeat TSH 2.1 mIU/L",
      },
      {
        ...makeSeedObligations()[1],
        life_stage: "Antenatal (Trimester 1)",
        priority: "HIGH",
        status: "DEFERRED_TO_POSTPARTUM",
      },
      {
        ...makeSeedObligations()[0],
        id: "OBL-103",
        priority: "MEDIUM",
        status: "OPEN",
      },
    ];

    const bundle = buildOutboundFhirBundle(
      obs,
      "Antenatal (Trimester 1)",
      "Pregnancy transition processed with zero PHI.",
      "• Review OBL-101 TSH result\n• Keep OBL-102 deferred to postpartum"
    ) as {
      resourceType: string;
      type: string;
      meta: { tag: Array<{ code: string }> };
      extension?: Array<{ url: string; valueString: string }>;
      entry: Array<{
        request: { method: string; url: string };
        resource: Record<string, unknown>;
      }>;
    };

    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("transaction");
    expect(bundle.meta.tag[0].code).toBe("UAE_PHI_LOCAL_ONLY");
    expect(bundle.extension?.[0]).toEqual({
      url: "urn:reprobridge:extension:clinician-handoff-checklist",
      valueString: "1. Review OBL-101 TSH result | 2. Keep OBL-102 deferred to postpartum",
    });

    expect(bundle.entry).toHaveLength(4);
    const carePlan = bundle.entry[0];
    expect(carePlan.request).toEqual({
      method: "PUT",
      url: "CarePlan/rb-careplan-pat-ae-4092",
    });
    expect(carePlan.resource.resourceType).toBe("CarePlan");
    expect(
      (carePlan.resource.activity as Array<{ detail: { status: string } }>).map(
        (a) => a.detail.status
      )
    ).toEqual(["completed", "on-hold", "in-progress"]);

    const tasks = bundle.entry.slice(1);
    expect(tasks.map((t) => t.resource.status)).toEqual(["completed", "on-hold", "requested"]);
    expect(tasks.map((t) => t.resource.priority)).toEqual(["stat", "urgent", "routine"]);
    expect(tasks[0].resource.note).toEqual([
      { text: obs[0].rationale },
      { text: "Evidence-verified closure by Dr. Layla Al-Hashimi (OB-GYN): Repeat TSH 2.1 mIU/L" },
    ]);
  });

  it("parses streamed sections, handoff checklist items, and detects obligation IDs", () => {
    expect(parseStreamedSections("SUMMARY:\nFirst sentence.\nHANDOFF:\n• Step A\n• Step B")).toEqual({
      summary: "First sentence.",
      handoff: "• Step A\n• Step B",
    });
    expect(parseStreamedSections("SUMMARY:\nPartial chunk without handoff")).toEqual({
      summary: "Partial chunk without handoff",
      handoff: "",
    });

    expect(parseHandoffItems("• First item\n- Second item\n3. Third item")).toEqual([
      "First item",
      "Second item",
      "Third item",
    ]);
    expect(
      parseHandoffItems("1) Verify TSH (OBL-101) target <2.5 2) Schedule postpartum MMR (OBL-102)")
    ).toEqual(["Verify TSH (OBL-101) target <2.5", "Schedule postpartum MMR (OBL-102)"]);

    expect(detectObligationId("Review obl-101 before Friday")).toBe("OBL-101");
    expect(detectObligationId("Check thyroid TSH panel")).toBe("OBL-101");
    expect(detectObligationId("Schedule Rubella MMR postpartum")).toBe("OBL-102");
    expect(detectObligationId("Routine blood pressure check")).toBeNull();
  });

  it("computes urgency chips and trace execution labels", () => {
    const base = makeSeedObligations()[0];
    expect(getUrgentDueChip(base)).toBeNull();
    expect(
      getUrgentDueChip({
        ...base,
        status: "ESCALATED_FOR_REVIEW",
        life_stage: "Antenatal (Trimester 1)",
      })
    ).toBe("Due ≤ 72h");
    expect(
      getUrgentDueChip({
        ...base,
        status: "ESCALATED_FOR_REVIEW",
        life_stage: "Postpartum",
      })
    ).toBe("Pre-discharge ≤ 48h");

    expect(formatExecutionLabel("agentic").label).toBe("Agentic");
    expect(formatExecutionLabel("deterministic_fallback").label).toBe("Fallback");
    expect(formatExecutionLabel("deterministic").label).toBe("Deterministic");
    expect(formatExecutionLabel().label).toBe("Deterministic");
  });
});

describe("spatialNav 2D keyboard navigation", () => {
  it("moves focus to aligned right candidate and ignores boundary arrows & modifiers", () => {
    const container = document.createElement("div");
    const b1 = document.createElement("button");
    const b2 = document.createElement("button");
    b1.setAttribute("role", "tab");
    b2.setAttribute("role", "tab");
    container.append(b1, b2);
    document.body.appendChild(container);

    const makeRect = (left: number) =>
      ({
        left,
        right: left + 100,
        top: 0,
        bottom: 40,
        width: 100,
        height: 40,
        x: left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    b1.getBoundingClientRect = () => makeRect(0);
    b2.getBoundingClientRect = () => makeRect(120);
    b1.checkVisibility = () => true;
    b2.checkVisibility = () => true;

    expect(findSpatialCandidate(container, b1, "ArrowRight", '[role="tab"]')).toBe(b2);
    expect(findSpatialCandidate(container, b2, "ArrowRight", '[role="tab"]')).toBeNull();

    b1.focus();
    const moveRight = {
      key: "ArrowRight",
      defaultPrevented: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      currentTarget: container,
      target: b1,
      nativeEvent: { composedPath: () => [b1] },
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLElement>;

    const moved = handleSpatialKeyDown(moveRight, '[role="tab"]');
    expect(moved).toBe(true);
    expect(moveRight.preventDefault).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(b2);

    const atBoundary = {
      ...moveRight,
      target: b2,
      nativeEvent: { composedPath: () => [b2] },
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLElement>;
    expect(handleSpatialKeyDown(atBoundary, '[role="tab"]')).toBe(false);
    expect(atBoundary.preventDefault).not.toHaveBeenCalled();

    const withModifier = {
      ...moveRight,
      ctrlKey: true,
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLElement>;
    expect(handleSpatialKeyDown(withModifier, '[role="tab"]')).toBe(false);

    container.remove();
  });
});

describe("<PrototypeDemo /> component workflows", () => {
  let obligationsByPatient: Record<string, Obligation[]>;
  let auditState: Array<{
    id: number;
    obligation_id: string | null;
    event_type: string;
    actor: string;
    summary: string;
    created_at: string;
  }>;

  beforeEach(() => {
    obligationsByPatient = {
      "PAT-AE-4092": makeSeedObligations(),
      "PAT-AE-5180": makeFatimaObligations(),
      "PAT-AE-6304": [],
    };
    auditState = [
      {
        id: 1,
        obligation_id: "OBL-101",
        event_type: "CARE_GAP_DETECTED",
        actor: "RuleEngine (RB-THYROID-v1.4.0)",
        summary: "Logged preconception TSH 4.8 mIU/L follow-up obligation.",
        created_at: "2026-11-20T09:00:00Z",
      },
      {
        id: 2,
        obligation_id: "OBL-102",
        event_type: "CARE_GAP_DETECTED",
        actor: "RuleEngine (RB-IMMUNE-v1.2.1)",
        summary: "Logged Rubella IgG non-immune obligation.",
        created_at: "2026-11-20T09:05:00Z",
      },
      {
        id: 3,
        obligation_id: "OBL-201",
        event_type: "CARE_GAP_DETECTED",
        actor: "RuleEngine (RB-METABOLIC-v1.2.0)",
        summary: "Logged preconception dysglycemia obligation.",
        created_at: "2026-11-20T09:10:00Z",
      },
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const parsed = new URL(url, "http://localhost");
      const pathname = parsed.pathname;
      const patientId = parsed.searchParams.get("patient_id") ?? "PAT-AE-4092";
      const method = (init?.method ?? "GET").toUpperCase();

      if (pathname === "/api/health" && method === "GET") {
        return createJsonResponse({
          status: "ok",
          residency_policy: "UAE_PHI_LOCAL_ONLY",
          ai_provider: {
            provider: "openrouter",
            configured: true,
            model: "google/gemma-4-31b-it:free",
          },
          database: {
            provider: "neon-postgres",
            connected: true,
            branch: "main",
            pooled: true,
            detail: "Connected to Neon PostgreSQL.",
          },
        });
      }

      if (pathname === "/api/obligations" && method === "GET") {
        const obls = obligationsByPatient[patientId] ?? [];
        const oblIds = new Set(obls.map((o) => o.id));
        return createJsonResponse({
          patient_id: patientId,
          obligations: obls,
          audit_events: auditState.filter(
            (ev) => !ev.obligation_id || oblIds.has(ev.obligation_id)
          ),
        });
      }

      if (pathname === "/api/transitions/pregnancy/stream" && method === "POST") {
        obligationsByPatient[patientId] = makePregnancyObligations();
        auditState = [
          {
            id: 4,
            obligation_id: "OBL-101",
            event_type: "LIFE_STAGE_TRANSITION",
            actor: "Deterministic Rule Engine",
            summary: "OBL-101 transitioned under FHIR_PREGNANCY_CONFIRMED to ESCALATED_FOR_REVIEW (URGENT).",
            created_at: "2026-11-20T10:00:00Z",
          },
          {
            id: 5,
            obligation_id: null,
            event_type: "AGENT_BRIEF_GENERATED",
            actor: "AgentHarness (google/gemma-4-31b-it:free)",
            summary: "De-identified brief generated; zero PHI transmitted.",
            created_at: "2026-11-20T10:00:05Z",
          },
          ...auditState,
        ];

        const privacyReport = {
          payload: {
            residency_policy: "UAE_PHI_LOCAL_ONLY",
            case_token: "ANON-CASE-1234ABCD",
            transition_event: "FHIR_PREGNANCY_CONFIRMED",
          },
          redacted_fields: ["patient_id", "patient_name", "evidence_source"],
          permitted_fields: ["case_token", "transition_event", "rule_version", "priority", "status"],
          phi_check_passed: true,
        };
        const trace = [
          {
            node: "detect_open_obligations",
            execution: "deterministic",
            phi_exposed: false,
            detail: "Identified 2 open obligation(s).",
          },
          {
            node: "evaluate_life_stage_transition",
            execution: "deterministic",
            phi_exposed: false,
            detail: "OBL-101 escalated to URGENT; OBL-102 deferred to postpartum.",
          },
          {
            node: "apply_uae_privacy_firewall",
            execution: "deterministic",
            phi_exposed: false,
            detail: "Stripped 3 PHI fields; case ANON-CASE-1234ABCD.",
          },
          {
            node: "synthesize_coordination_brief",
            execution: "agentic",
            phi_exposed: false,
            detail: "Drafted clinician handoff brief via OpenRouter.",
          },
        ];

        return createSseResponse([
          {
            event: "deterministic_complete",
            data: {
              event_type: "FHIR_PREGNANCY_CONFIRMED",
              obligations: obligationsByPatient[patientId],
              audit_events: auditState,
              privacy_report: privacyReport,
              trace: trace.slice(0, 3),
            },
          },
          {
            event: "token",
            data: {
              delta: "SUMMARY:\nPregnancy transition escalated TSH follow-up.\nHANDOFF:\n• Repeat TSH (OBL-101)\n• Defer MMR (OBL-102)",
              model: "google/gemma-4-31b-it:free",
            },
          },
          {
            event: "complete",
            data: {
              event_type: "FHIR_PREGNANCY_CONFIRMED",
              agent_summary: "Pregnancy transition escalated TSH follow-up and deferred live MMR.",
              specialist_handoff:
                "• Repeat TSH for OBL-101 (<2.5 mIU/L target)\n• Keep OBL-102 MMR deferred until postpartum",
              ai_metadata: {
                mode: "openrouter",
                provider: "openrouter",
                model: "google/gemma-4-31b-it:free",
                fallback_reason: null,
              },
              privacy_report: privacyReport,
              trace,
              obligations: obligationsByPatient[patientId],
              audit_events: auditState,
            },
          },
        ]);
      }

      if (pathname === "/api/obligations/OBL-101/evidence" && method === "GET") {
        return createJsonResponse({
          obligation_id: "OBL-101",
          evidence: [
            {
              id: "EVD-TSH-2026-10",
              obligation_id: "OBL-101",
              fhir_resource_type: "Observation",
              code_display: "Thyrotropin (TSH) [LOINC 3016-3]",
              result_value: "TSH 2.1 mIU/L (Normalized)",
              reference_range: "<2.5 mIU/L",
              source_facility: "Cleveland Clinic Abu Dhabi · Malaffi HIE",
              accession_id: "MAL-LAB-2026-88412",
              clinician_suggestion: "Dr. Layla Al-Hashimi (OB-GYN)",
              summary_note: "Repeat TSH 2.1 mIU/L verified (Accession #MAL-LAB-2026-88412).",
              recorded_at: "2026-11-20T10:30:00Z",
            },
          ],
        });
      }

      if (pathname === "/api/obligations/OBL-101/verify" && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          clinician_name: string;
          closure_evidence: string;
        };
        obligationsByPatient["PAT-AE-4092"] = obligationsByPatient["PAT-AE-4092"].map((o) =>
          o.id === "OBL-101"
            ? {
                ...o,
                status: "VERIFIED_CLOSED",
                verified_by: body.clinician_name,
                closure_evidence: body.closure_evidence,
              }
            : o
        );
        return createJsonResponse({
          obligation: obligationsByPatient["PAT-AE-4092"][0],
          audit_events: auditState,
        });
      }

      if (pathname === "/api/obligations/OBL-102/verify" && method === "POST") {
        return createJsonResponse(
          {
            detail:
              "Clinical safety guard: live-vaccine obligation is contraindicated during pregnancy and cannot be closed until the Postpartum transition is triggered.",
          },
          409
        );
      }

      if (pathname === "/api/obligations/import" && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          obligations: Array<{
            patient_id?: string;
            title: string;
            rationale: string;
            priority?: string;
            life_stage?: string;
            owner?: string;
            evidence_source?: string;
          }>;
        };
        const targetPid = body.obligations[0]?.patient_id ?? "PAT-AE-4092";
        const currentList = obligationsByPatient[targetPid] ?? [];
        const added = body.obligations.map((item, idx) => ({
          id: `OBL-${103 + idx}`,
          patient_id: targetPid,
          patient_name: "Amina Al-Mansoori (Synthetic)",
          life_stage: item.life_stage ?? "Preconception",
          title: item.title,
          rationale: item.rationale,
          evidence_source: item.evidence_source ?? "CSV Table Import",
          rule_version: "RB-CUSTOM-v1.0.0",
          owner: item.owner ?? "OB-GYN / Primary Care",
          status: "OPEN",
          priority: item.priority ?? "MEDIUM",
          verified_by: null,
          closure_evidence: null,
        }));
        obligationsByPatient[targetPid] = [...currentList, ...added];
        return createJsonResponse({
          imported_count: added.length,
          obligations: obligationsByPatient[targetPid],
          audit_events: auditState,
        });
      }

      if (pathname === "/api/obligations/OBL-101/explain" && method === "POST") {
        return createJsonResponse({
          obligation_id: "OBL-101",
          headline: "Elevated Thyroid-Stimulating Hormone (Preconception)",
          explanation:
            "TSH of 4.8 mIU/L sits above the 4.0 preconception upper limit and will require tighter control below 2.5 mIU/L upon pregnancy confirmation.",
          key_points: [
            "Preconception upper cutoff is 4.0 mIU/L; first-trimester target narrows to 0.1–2.5 mIU/L.",
            "Repeat TSH and free T4 testing confirms clinician-approved management.",
          ],
          disclaimer:
            "Assistive de-identified explanation only — does not diagnose or prescribe. Final verification requires clinician approval.",
          ai_metadata: {
            mode: "openrouter",
            provider: "openrouter",
            model: "google/gemma-4-31b-it:free",
            fallback_reason: null,
          },
          privacy_report: {
            payload: {
              residency_policy: "UAE_PHI_LOCAL_ONLY",
              case_token: "ANON-CASE-1234ABCD",
            },
            redacted_fields: ["patient_id", "patient_name", "evidence_source"],
            permitted_fields: ["case_token", "finding_title", "clinical_rationale"],
            phi_check_passed: true,
          },
          audit_events: [
            {
              id: 9,
              obligation_id: "OBL-101",
              event_type: "AI_EXPLANATION_GENERATED",
              actor: "AIExplainer (google/gemma-4-31b-it:free)",
              summary: "Generated de-identified explanation for OBL-101 (0 PHI transmitted).",
              created_at: "2026-11-20T10:35:00Z",
            },
            ...auditState,
          ],
        });
      }

      return createJsonResponse({ detail: `Unhandled mock route: ${method} ${url}` }, 404);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearDocsSessionPrefs();
  });

  it("renders initial patient passport, compact navbar controls, and invokes onBackToTutorial", async () => {
    const user = userEvent.setup();
    const onBackToTutorial = vi.fn();

    render(<PrototypeDemo onBackToTutorial={onBackToTutorial} />);

    const main = screen.getByRole("main");
    expect(await within(main).findByText(/Amina Al-Mansoori \(Synthetic\)/)).toBeInTheDocument();
    expect(within(main).getByText("PAT-AE-4092")).toBeInTheDocument();
    expect(within(main).getByText("Preconception")).toBeInTheDocument();
    expect(screen.getByText("UAE Local · Live")).toBeInTheDocument();
    const passportHeading = within(main).getByText("Clinical Obligation Passport (2)");
    const spineHeading = within(main).getByText(
      "Cross-System Care Continuity Spine (1 Patient · 3 Disconnected EMRs)"
    );
    const mubadalaCare = within(main).getByText("Mubadala Primary Care");
    expect(
      passportHeading.compareDocumentPosition(spineHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      passportHeading.compareDocumentPosition(mubadalaCare) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    expect(
      within(main).getByText("Subclinical Hypothyroidism Follow-up (TSH 4.8 mIU/L)")
    ).toBeInTheDocument();
    expect(
      within(main).getByText("Rubella IgG Non-Immune Vaccination Verification")
    ).toBeInTheDocument();

    // Compact status popover contains environment details without crowding navbar
    expect(screen.getByText("Malaffi HIE · HL7 FHIR R4")).toBeInTheDocument();
    expect(screen.getByText("UAE PHI Local-Only")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to Tutorial" }));
    expect(onBackToTutorial).toHaveBeenCalledTimes(1);
  });

  it("streams pregnancy transition, updates obligation states, and displays trace + UAE privacy firewall", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(<PrototypeDemo onBackToTutorial={vi.fn()} />);

    const main = screen.getByRole("main");
    await within(main).findByText("Clinical Obligation Passport (2)");
    await user.click(within(main).getByRole("button", { name: /Trigger Pregnancy Transition/i }));

    expect(
      await within(main).findByText(
        "Pregnancy transition escalated TSH follow-up and deferred live MMR."
      )
    ).toBeInTheDocument();

    const harnessEl = document.getElementById("hybrid-care-resolution-harness");
    expect(harnessEl).not.toBeNull();
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
      expect(scrollSpy.mock.instances).toContain(harnessEl);
    });

    scrollSpy.mockClear();
    await user.click(within(main).getByRole("button", { name: /View AI Brief/i }));
    await waitFor(() => {
      expect(scrollSpy).toHaveBeenCalled();
      expect(scrollSpy.mock.instances).toContain(harnessEl);
    });
    scrollSpy.mockRestore();
    expect(within(main).getByText("Antenatal (Trimester 1)")).toBeInTheDocument();
    expect(within(main).getByText("ESCALATED_FOR_REVIEW")).toBeInTheDocument();
    expect(within(main).getByText("DEFERRED_TO_POSTPARTUM")).toBeInTheDocument();
    expect(within(main).getByText("Due ≤ 72h")).toBeInTheDocument();

    // 4 LangGraph trace step tabs + Privacy Firewall report
    expect(
      within(main).getByRole("tab", { name: /Detect Open Obligations/i })
    ).toBeInTheDocument();
    expect(
      within(main).getByRole("tab", { name: /Evaluate Transition Rules/i })
    ).toBeInTheDocument();
    expect(within(main).getByRole("tab", { name: /UAE Privacy Firewall/i })).toBeInTheDocument();
    expect(
      within(main).getByRole("tab", { name: /Synthesize Handoff Brief/i })
    ).toBeInTheDocument();
    expect(
      within(main).getByText(/UAE Data Residency Firewall — Zero PHI Sent Outside UAE/i)
    ).toBeInTheDocument();

    // Option B layout order: Patient/Value-Prop Header -> Obligation Passport -> Care-Site Spine -> Harness
    const patientHeading = within(main).getByText(/Amina Al-Mansoori \(Synthetic\)/);
    const passportHeading = within(main).getByText("Clinical Obligation Passport (2)");
    const spineHeading = within(main).getByText(
      "Cross-System Care Continuity Spine (1 Patient · 3 Disconnected EMRs)"
    );
    const harnessHeading = within(main).getByText(
      "Hybrid Care-Resolution Harness (Deterministic Rules + OpenRouter Synthesis)"
    );
    expect(
      patientHeading.compareDocumentPosition(passportHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      passportHeading.compareDocumentPosition(spineHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      spineHeading.compareDocumentPosition(harnessHeading) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("verifies clinician closure with incoming Neon evidence and blocks deferred MMR via HTTP 409 safety guard", async () => {
    const user = userEvent.setup();
    render(<PrototypeDemo onBackToTutorial={vi.fn()} />);

    const main = screen.getByRole("main");
    await within(main).findByText("Clinical Obligation Passport (2)");
    await user.click(within(main).getByRole("button", { name: /Trigger Pregnancy Transition/i }));
    await within(main).findByText("DEFERRED_TO_POSTPARTUM");

    // 1. Trigger HTTP 409 Clinical Safety Guard on deferred OBL-102
    await user.click(within(main).getByRole("button", { name: /Test Safety Guard/i }));
    const guardAlert = await within(main).findByRole("alert");
    expect(guardAlert).toHaveTextContent("Deterministic Safety Guard Intercepted (HTTP 409");
    expect(guardAlert).toHaveTextContent("contraindicated during pregnancy");

    // 2. Open Clinician Verify & Close on OBL-101 and approve incoming FHIR evidence
    const verifyButtons = within(main).getAllByRole("button", {
      name: /Clinician Verify & Close/i,
    });
    await user.click(verifyButtons[0]);

    const dialog = await screen.findByRole("dialog", {
      name: /OBL-101: Subclinical Hypothyroidism/i,
    });
    expect(
      await within(dialog).findByText("TSH 2.1 mIU/L (Normalized)")
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Approve & Verify Closure/i }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /OBL-101: Subclinical Hypothyroidism/i })
      ).not.toBeInTheDocument();
    });
    expect(await within(main).findByText("VERIFIED_CLOSED")).toBeInTheDocument();
    expect(within(main).getByText(/Verified by Dr\. Layla Al-Hashimi/i)).toBeInTheDocument();
  });

  it("supports CSV table intake, outbound FHIR R4 export modal, and clinician-only Clinical Documents drawer", async () => {
    const user = userEvent.setup();
    render(<PrototypeDemo onBackToTutorial={vi.fn()} />);

    const main = screen.getByRole("main");
    await within(main).findByText("Clinical Obligation Passport (2)");

    // 1. Import CSV rows via intake modal
    await user.click(within(main).getByRole("button", { name: /Import Table \/ Add Finding/i }));
    const intakeDialog = await screen.findByRole("dialog", {
      name: /Import Clinical Table or Input Finding Manually/i,
    });
    await user.click(
      within(intakeDialog).getByRole("tab", { name: /Import CSV \/ Spreadsheet Table/i })
    );
    await user.click(within(intakeDialog).getByRole("button", { name: /Import 2 Row\(s\)/i }));

    expect(await within(main).findByText("Clinical Obligation Passport (4)")).toBeInTheDocument();
    expect(within(main).getByText("Gestational Diabetes OGTT Follow-up")).toBeInTheDocument();

    // 2. Open Outbound HL7 FHIR R4 modal
    await user.click(within(main).getByRole("button", { name: /EMR Write-Back \(FHIR R4\)/i }));
    const fhirDialog = await screen.findByRole("dialog", {
      name: /Outbound HL7 FHIR R4 Transaction Bundle/i,
    });
    expect(within(fhirDialog).getByText(/"resourceType": "Bundle"/)).toBeInTheDocument();
    expect(within(fhirDialog).getByText(/"resourceType": "CarePlan"/)).toBeInTheDocument();
    await user.click(within(fhirDialog).getByRole("button", { name: /Close FHIR R4 export dialog/i }));

    // 3. Open Clinician-Only Clinical Source Documents Drawer from OBL-101
    const docButtons = within(main).getAllByRole("button", {
      name: /View Clinical Report \(Clinician Ref\)/i,
    });
    await user.click(docButtons[0]);

    const docsDialog = await screen.findByRole("dialog", { name: /Clinical Source Documents/i });
    expect(within(docsDialog).getByText("Clinical Source Documents")).toBeInTheDocument();
    expect(
      within(docsDialog).getByText("Clinician Reference Only · Excluded from AI")
    ).toBeInTheDocument();
    expect(
      within(docsDialog).getByText("CLINICAL CHEMISTRY & ENDOCRINOLOGY LABORATORY REPORT")
    ).toBeInTheDocument();
    expect(within(docsDialog).getByText("4.80")).toBeInTheDocument();
  });

  it("renders a compact Population Cohort Switcher, opens searchable/sortable registry, and switches to Fatima Al-Zaabi (PAT-AE-5180)", async () => {
    const user = userEvent.setup();
    render(<PrototypeDemo onBackToTutorial={vi.fn()} />);

    const cohortStrip = screen.getByRole("region", { name: /Population Cohort Switcher/i });
    expect(within(cohortStrip).getByText("3 Patients")).toBeInTheDocument();
    expect(within(cohortStrip).getByText("1/3")).toBeInTheDocument();

    // Prev/Next stepper precedes the Switch patient button (left-anchored geometry)
    const nextBtn = within(cohortStrip).getByRole("button", { name: "Next patient" });
    const prevBtn = within(cohortStrip).getByRole("button", { name: "Previous patient" });
    const switchBtn = within(cohortStrip).getByRole("button", { name: /Switch patient/i });
    expect(nextBtn.compareDocumentPosition(switchBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Compact switcher omits clinical track, life-stage badge, and (Synthetic) suffix
    expect(within(switchBtn).getByText("Amina Al-Mansoori")).toBeInTheDocument();
    expect(within(cohortStrip).queryByText(/Endocrine & Rubella Continuity/i)).not.toBeInTheDocument();
    expect(within(cohortStrip).queryByText(/\(Synthetic\)/i)).not.toBeInTheDocument();

    // Step forward to Fatima (2/3) and back to Amina (1/3)
    await user.click(nextBtn);
    expect(await within(cohortStrip).findByText("2/3")).toBeInTheDocument();
    const main = screen.getByRole("main");
    expect(await within(main).findByText(/Fatima Al-Zaabi \(Synthetic\)/)).toBeInTheDocument();

    await user.click(prevBtn);
    expect(await within(cohortStrip).findByText("1/3")).toBeInTheDocument();
    expect(await within(main).findByText(/Amina Al-Mansoori \(Synthetic\)/)).toBeInTheDocument();

    // Open searchable/sortable Population Registry dialog
    await user.click(within(cohortStrip).getByRole("button", { name: /Switch patient/i }));
    const registry = await screen.findByRole("dialog", { name: /Population Registry/i });

    expect(within(registry).getByText("Amina Al-Mansoori (Synthetic)")).toBeInTheDocument();
    expect(within(registry).getByText("Fatima Al-Zaabi (Synthetic)")).toBeInTheDocument();
    expect(within(registry).getByText("Sara Al-Nuaimi (Synthetic)")).toBeInTheDocument();

    // Test sortable column header semantics (aria-sort updates on Patient column)
    const patientSortBtn = within(registry).getByRole("button", { name: "Patient" });
    await user.click(patientSortBtn);
    expect(patientSortBtn.closest("th")).toHaveAttribute("aria-sort", "ascending");

    // Search narrows down to Fatima Al-Zaabi
    const searchInput = within(registry).getByRole("searchbox", {
      name: /Search patients by name, MRN, track, or facility/i,
    });
    await user.type(searchInput, "Fatima");
    expect(within(registry).queryByText("Sara Al-Nuaimi (Synthetic)")).not.toBeInTheDocument();
    expect(within(registry).getByText("1–1")).toBeInTheDocument();

    // Select Fatima to switch the main workspace
    await user.click(within(registry).getByRole("button", { name: /Open Workspace/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Population Registry/i })).not.toBeInTheDocument();
    });

    expect(await within(main).findByText(/Fatima Al-Zaabi \(Synthetic\)/)).toBeInTheDocument();
    expect(within(main).getByText("PAT-AE-5180")).toBeInTheDocument();
    expect(within(main).getByText("Al Bateen Primary Clinic")).toBeInTheDocument();
    expect(
      within(main).getByText("Preconception Dysglycemia Follow-up (Fasting Glucose 112 mg/dL · HbA1c 6.1%)")
    ).toBeInTheDocument();
    expect(
      within(main).getByText("Varicella-Zoster (VZV) IgG Non-Immune Vaccination Verification")
    ).toBeInTheDocument();
  });
});

describe("<FloatingDocsTab /> & <ClinicalDocumentsDrawer /> directional docking and session cookies", () => {
  beforeEach(() => {
    clearDocsSessionPrefs();
  });

  afterEach(() => {
    clearDocsSessionPrefs();
    vi.restoreAllMocks();
  });

  it("renders docked right by default and invokes onOpen on click", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();

    render(<FloatingDocsTab count={5} onOpen={onOpen} />);
    const tab = screen.getByRole("button", { name: /Open Clinical Source Documents \(5 synthetic records\)/i });

    expect(tab).toHaveAttribute("data-dock-side", "right");
    expect(tab.className).toContain("rounded-l-xl");
    expect(tab.className).toContain("border-r-0");

    await user.click(tab);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("docks flush against documentElement.clientWidth on the right so a vertical scrollbar never obscures it", () => {
    const prevDescriptor = Object.getOwnPropertyDescriptor(document.documentElement, "clientWidth");
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      get: () => 1008,
    });

    try {
      render(<FloatingDocsTab count={5} onOpen={vi.fn()} />);
      const tab = screen.getByRole("button", { name: /Open Clinical Source Documents/i });
      // Default fallback tab width is 44px -> 1008 - 44 = 964px (not window.innerWidth 1024 - 44 = 980px)
      expect(tab.style.left).toBe("964px");
    } finally {
      if (prevDescriptor) {
        Object.defineProperty(document.documentElement, "clientWidth", prevDescriptor);
      } else {
        delete (document.documentElement as unknown as { clientWidth?: number }).clientWidth;
      }
    }
  });

  it("snaps flush to the left edge after dragging across screen, persists session cookie, and suppresses trailing click", () => {
    const onOpen = vi.fn();
    const onDockChange = vi.fn();
    render(<FloatingDocsTab count={5} onOpen={onOpen} onDockChange={onDockChange} />);
    const tab = screen.getByRole("button", { name: /Open Clinical Source Documents/i });

    const startX = window.innerWidth - 20;
    fireEvent.pointerDown(tab, { button: 0, pointerId: 1, clientX: startX, clientY: 320 });
    fireEvent.pointerMove(tab, { pointerId: 1, clientX: 20, clientY: 220 });
    expect(tab).toHaveAttribute("data-dragging", "true");
    expect(tab.className).toContain("rounded-xl");

    fireEvent.pointerUp(tab, { pointerId: 1, clientX: 20, clientY: 220 });
    expect(tab).toHaveAttribute("data-dragging", "false");
    expect(tab).toHaveAttribute("data-dock-side", "left");
    expect(tab.className).toContain("rounded-r-xl");
    expect(tab.className).toContain("border-l-0");

    // Trailing browser click after pointerUp must not open the drawer
    fireEvent.click(tab);
    expect(onOpen).not.toHaveBeenCalled();

    expect(onDockChange).toHaveBeenCalledWith("left", expect.any(Number));
    expect(document.cookie).toContain(DOCS_PREFS_COOKIE);
    expect(readDocsSessionPrefs().side).toBe("left");
  });

  it("snaps between left and right edges via ArrowLeft and ArrowRight keyboard navigation", () => {
    render(<FloatingDocsTab count={5} onOpen={vi.fn()} />);
    const tab = screen.getByRole("button", { name: /Open Clinical Source Documents/i });

    fireEvent.keyDown(tab, { key: "ArrowLeft" });
    expect(tab).toHaveAttribute("data-dock-side", "left");
    expect(tab.className).toContain("rounded-r-xl");
    expect(readDocsSessionPrefs().side).toBe("left");

    fireEvent.keyDown(tab, { key: "ArrowRight" });
    expect(tab).toHaveAttribute("data-dock-side", "right");
    expect(tab.className).toContain("rounded-l-xl");
    expect(readDocsSessionPrefs().side).toBe("right");
  });

  it("opens ClinicalDocumentsDrawer from the docked left edge after dragging FloatingDocsTab to left", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const pathname = new URL(url, "http://localhost").pathname;
      if (pathname === "/api/health") {
        return createJsonResponse({
          status: "ok",
          residency_policy: "UAE_PHI_LOCAL_ONLY",
          ai_provider: { provider: "openrouter", configured: true, model: "google/gemma-4-31b-it:free" },
          database: { provider: "neon-postgres", connected: true, branch: "main", pooled: true, detail: "Connected" },
        });
      }
      if (pathname === "/api/obligations") {
        return createJsonResponse({
          patient_id: "PAT-AE-4092",
          obligations: makeSeedObligations(),
          audit_events: [],
        });
      }
      return createJsonResponse({ detail: "Not mocked" }, 404);
    });

    render(<PrototypeDemo onBackToTutorial={vi.fn()} />);
    await screen.findByText("Clinical Obligation Passport (2)");

    const tab = screen.getByRole("button", { name: /Open Clinical Source Documents \(5 synthetic records\)/i });
    fireEvent.keyDown(tab, { key: "ArrowLeft" });
    expect(tab).toHaveAttribute("data-dock-side", "left");

    await user.click(tab);
    const docsDialog = await screen.findByRole("dialog", { name: /Clinical Source Documents/i });
    expect(docsDialog).toHaveAttribute("data-side", "left");
  });

  it("resizes ClinicalDocumentsDrawer width via edge drag and keyboard on both sides and persists in session cookie", () => {
    const onWidthChange = vi.fn();
    const { rerender } = render(
      <ClinicalDocumentsDrawer
        isOpen={true}
        onClose={vi.fn()}
        currentLifeStage="Preconception"
        obligations={makeSeedObligations()}
        side="right"
        drawerWidth={720}
        onDrawerWidthChange={onWidthChange}
      />
    );

    const dialog = screen.getByRole("dialog", { name: /Clinical Source Documents/i });
    expect(dialog).toHaveAttribute("data-side", "right");
    expect(dialog.style.getPropertyValue("--rb-drawer-width")).toBe("720px");

    const separator = within(dialog).getByRole("separator", {
      name: /Resize Clinical Documents drawer width/i,
    });
    expect(separator.className).toContain("left-0");

    // Drag left edge further left by 100px -> widens right-docked drawer from 720 to 820
    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 200 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 200 });

    expect(dialog.style.getPropertyValue("--rb-drawer-width")).toBe("820px");
    expect(onWidthChange).toHaveBeenLastCalledWith(820);
    expect(readDocsSessionPrefs().drawerWidth).toBe(820);

    // Rerender docked on left edge with controlled drawerWidth update: separator flips to right-0 and ArrowRight widens (+32px)
    rerender(
      <ClinicalDocumentsDrawer
        isOpen={true}
        onClose={vi.fn()}
        currentLifeStage="Preconception"
        obligations={makeSeedObligations()}
        side="left"
        drawerWidth={700}
        onDrawerWidthChange={onWidthChange}
      />
    );

    expect(dialog).toHaveAttribute("data-side", "left");
    expect(separator.className).toContain("right-0");
    expect(dialog.style.getPropertyValue("--rb-drawer-width")).toBe("700px");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(dialog.style.getPropertyValue("--rb-drawer-width")).toBe("732px");
    expect(onWidthChange).toHaveBeenLastCalledWith(732);
    expect(readDocsSessionPrefs().drawerWidth).toBe(732);

    // Drag right edge further right by 60px -> widens left-docked drawer from 732 to 792
    fireEvent.pointerDown(separator, { button: 0, pointerId: 2, clientX: 732 });
    fireEvent.pointerMove(separator, { pointerId: 2, clientX: 792 });
    fireEvent.pointerUp(separator, { pointerId: 2, clientX: 792 });

    expect(dialog.style.getPropertyValue("--rb-drawer-width")).toBe("792px");
    expect(readDocsSessionPrefs().drawerWidth).toBe(792);
  });
});

describe("<ClinicalMetricVisualizer /> clinical range bars", () => {
  it("visualizes TSH 4.8 mIU/L with life-stage target shifting and VERIFIED_CLOSED normalization", () => {
    const tshObl = makeSeedObligations()[0];
    const { rerender } = render(<ClinicalMetricVisualizer obligation={tshObl} />);

    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "4.8");
    expect(screen.getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByText("Ref: 0.4–4.0 mIU/L")).toBeInTheDocument();

    // Pregnancy transition tightens target to T1 0.1–2.5 mIU/L
    rerender(
      <ClinicalMetricVisualizer
        obligation={{ ...tshObl, life_stage: "Antenatal (Trimester 1)", status: "ESCALATED_FOR_REVIEW" }}
      />
    );
    expect(screen.getByText("T1 Target: 0.1–2.5 mIU/L")).toBeInTheDocument();
    expect(screen.getByText("T1 target <2.5")).toBeInTheDocument();

    // Clinician verified closure updates meter value to 2.1 and NORMALIZED badge
    rerender(
      <ClinicalMetricVisualizer
        obligation={{
          ...tshObl,
          life_stage: "Antenatal (Trimester 1)",
          status: "VERIFIED_CLOSED",
          verified_by: "Dr. Layla Al-Hashimi (OB-GYN)",
          closure_evidence: "Repeat TSH 2.1 mIU/L normalized after levothyroxine titration.",
        }}
      />
    );
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "2.1");
    expect(screen.getByText("NORMALIZED")).toBeInTheDocument();
  });

  it("extracts and renders multiple metrics for dysglycemia, preeclampsia BP, and imported Ferritin", () => {
    const dysglycemiaObl = makeFatimaObligations()[0];
    expect(extractClinicalMetrics(dysglycemiaObl)).toHaveLength(2);

    const { rerender } = render(<ClinicalMetricVisualizer obligation={dysglycemiaObl} />);
    const glucoseMeters = screen.getAllByRole("meter");
    expect(glucoseMeters).toHaveLength(2);
    expect(glucoseMeters[0]).toHaveAttribute("aria-valuenow", "112");
    expect(glucoseMeters[1]).toHaveAttribute("aria-valuenow", "6.1");

    const bpObl: Obligation = {
      id: "OBL-301",
      patient_id: "PAT-AE-6304",
      patient_name: "Sara Al-Nuaimi (Synthetic)",
      life_stage: "Preconception",
      title: "Preeclampsia Low-Dose Aspirin Prophylaxis Window (BP 138/88 mmHg)",
      rationale: "History of prior preterm preeclampsia and baseline BP 138/88 mmHg.",
      evidence_source: "FHIR Observation/obs-bp-2026-09 (Malaffi HIE Synthetic)",
      rule_version: "RB-PREECLAMPSIA-v1.3.0",
      owner: "Primary Care / Maternal-Fetal Medicine",
      status: "OPEN",
      priority: "HIGH",
      verified_by: null,
      closure_evidence: null,
    };
    rerender(<ClinicalMetricVisualizer obligation={bpObl} />);
    const bpMeters = screen.getAllByRole("meter");
    expect(bpMeters).toHaveLength(2);
    expect(bpMeters[0]).toHaveAttribute("aria-valuenow", "138");
    expect(bpMeters[1]).toHaveAttribute("aria-valuenow", "88");

    const ferritinObl: Obligation = {
      ...bpObl,
      id: "OBL-303",
      rule_version: "RB-CUSTOM-v1.0.0",
      title: "Iron Deficiency Anemia Ferritin Check",
      rationale: "Preconception ferritin 11 ng/mL; requires oral iron supplementation.",
    };
    rerender(<ClinicalMetricVisualizer obligation={ferritinObl} />);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "11");
    expect(screen.getByText("LOW")).toBeInTheDocument();
  });
});

describe("<ObligationExplainerPopover /> & OBL Explain workflow", () => {
  it("parses partial and complete SSE explanation streams accurately", () => {
    expect(parseStreamedExplanation("HEADLINE:\nElevated TSH")).toEqual({
      headline: "Elevated TSH",
      explanation: "",
      key_points: [],
    });
    expect(
      parseStreamedExplanation(
        "HEADLINE:\nElevated TSH\nEXPLANATION:\nAbove target.\nNeeds T4 check.\nKEY_POINTS:\n• Target <2.5\n- Follow OB-GYN"
      )
    ).toEqual({
      headline: "Elevated TSH",
      explanation: "Above target. Needs T4 check.",
      key_points: ["Target <2.5", "Follow OB-GYN"],
    });
  });

  it("opens floating AI Clinical Explainer from OBL-101 Explain button, plays ElevenLabs neural audio, and pauses on close", async () => {
    const user = userEvent.setup();

    const playMock = vi.fn().mockResolvedValue(undefined);
    const pauseMock = vi.fn();
    let createdAudioUrl = "";

    const prevAudio = (globalThis as { Audio?: unknown }).Audio;
    const prevCreateObjectURL = URL.createObjectURL;
    const prevRevokeObjectURL = URL.revokeObjectURL;

    class MockAudio {
      src: string;
      playbackRate = 1;
      currentTime = 0;
      ended = false;
      onplay: (() => void) | null = null;
      onpause: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) {
        this.src = src;
        createdAudioUrl = src;
      }
      play = playMock;
      pause = pauseMock;
    }

    (globalThis as { Audio: unknown }).Audio = MockAudio;
    URL.createObjectURL = vi.fn(() => "blob:reprobridge-elevenlabs-audio");
    URL.revokeObjectURL = vi.fn();

    let requestedTtsText = "";
    const obls = makeSeedObligations();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const pathname = new URL(url, "http://localhost").pathname;
      const method = (init?.method ?? "GET").toUpperCase();

      if (pathname === "/api/health") {
        return createJsonResponse({
          status: "ok",
          residency_policy: "UAE_PHI_LOCAL_ONLY",
          ai_provider: { provider: "openrouter", configured: true, model: "google/gemma-4-31b-it:free" },
          audio_provider: { provider: "elevenlabs", configured: true, model: "eleven_v4" },
          database: { provider: "neon-postgres", connected: true, branch: "main", pooled: true, detail: "Connected" },
        });
      }
      if (pathname === "/api/obligations") {
        return createJsonResponse({ patient_id: "PAT-AE-4092", obligations: obls, audit_events: [] });
      }
      if (pathname === "/api/obligations/OBL-101/explain/stream" && method === "POST") {
        const explanationData = {
          obligation_id: "OBL-101",
          headline: "Elevated Thyroid-Stimulating Hormone (Preconception)",
          explanation:
            "TSH of 4.8 mIU/L sits above the 4.0 preconception upper limit and tightens under 2.5 in Trimester 1.",
          key_points: ["Preconception cutoff is 4.0 mIU/L.", "Requires repeat TSH + free T4 review."],
          disclaimer: "Assistive de-identified explanation only — does not diagnose or prescribe.",
          ai_metadata: {
            mode: "openrouter",
            provider: "openrouter",
            model: "google/gemma-4-31b-it:free",
            fallback_reason: null,
          },
          privacy_report: {
            payload: { residency_policy: "UAE_PHI_LOCAL_ONLY", case_token: "ANON-CASE-1234ABCD" },
            redacted_fields: ["patient_name"],
            permitted_fields: ["case_token"],
            phi_check_passed: true,
          },
        };
        return createSseResponse([
          {
            event: "firewall_verified",
            data: { obligation_id: "OBL-101", privacy_report: explanationData.privacy_report },
          },
          {
            event: "token",
            data: {
              delta: "HEADLINE:\nElevated Thyroid-Stimulating Hormone (Preconception)\nEXPLANATION:\nTSH of 4.8 mIU/L ",
              model: "google/gemma-4-31b-it:free",
            },
          },
          {
            event: "complete",
            data: explanationData,
          },
        ]);
      }
      if (pathname === "/api/obligations/OBL-101/explain/audio" && method === "POST") {
        const parsedBody = JSON.parse(String(init?.body ?? "{}")) as { text?: string };
        requestedTtsText = parsedBody.text ?? "";
        return new Response(new Uint8Array([73, 68, 51]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }
      return createJsonResponse({ detail: "Not mocked" }, 404);
    });

    try {
      render(<PrototypeDemo onBackToTutorial={vi.fn()} />);
      const main = screen.getByRole("main");
      await within(main).findByText("Clinical Obligation Passport (2)");

      await user.click(
        within(main).getByRole("button", {
          name: /Explain OBL-101: Subclinical Hypothyroidism Follow-up/i,
        })
      );

      const explainer = await screen.findByRole("dialog", { name: /AI Clinical Explainer/i });
      expect(
        await within(explainer).findByText("Elevated Thyroid-Stimulating Hormone (Preconception)")
      ).toBeInTheDocument();
      expect(within(explainer).getByText("UAE Firewall · 0 PHI")).toBeInTheDocument();
      expect(within(explainer).getByText("ElevenLabs")).toBeInTheDocument();

      await user.click(within(explainer).getByRole("button", { name: /Listen/i }));
      await waitFor(() => {
        expect(playMock).toHaveBeenCalledTimes(1);
      });
      expect(createdAudioUrl).toBe("blob:reprobridge-elevenlabs-audio");
      expect(requestedTtsText).toContain("TSH of 4.8 mIU/L");

      await user.click(within(explainer).getByRole("button", { name: /Close AI explainer/i }));
      expect(pauseMock).toHaveBeenCalled();
      expect(screen.queryByRole("dialog", { name: /AI Clinical Explainer/i })).not.toBeInTheDocument();
    } finally {
      vi.restoreAllMocks();
      if (prevAudio !== undefined) {
        (globalThis as { Audio?: unknown }).Audio = prevAudio;
      } else {
        delete (globalThis as { Audio?: unknown }).Audio;
      }
      URL.createObjectURL = prevCreateObjectURL;
      URL.revokeObjectURL = prevRevokeObjectURL;
    }
  });
});

describe("<IntegrationsDrawer /> & <FloatingIntegrationsTab /> HIE/EMR Integrations Hub", () => {
  it("opens HIE & EMR Integrations Hub from floating tab, displays Malaffi and Oracle Health logos, and adds a custom EMR", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const pathname = new URL(url, "http://localhost").pathname;
      if (pathname === "/api/health") {
        return createJsonResponse({
          status: "ok",
          residency_policy: "UAE_PHI_LOCAL_ONLY",
          ai_provider: { provider: "openrouter", configured: true, model: "google/gemma-4-31b-it:free" },
          database: { provider: "neon-postgres", connected: true, branch: "main", pooled: true, detail: "Connected" },
        });
      }
      if (pathname === "/api/obligations") {
        return createJsonResponse({
          patient_id: "PAT-AE-4092",
          obligations: makeSeedObligations(),
          audit_events: [],
        });
      }
      return createJsonResponse({ detail: "Not mocked" }, 404);
    });

    render(<PrototypeDemo onBackToTutorial={vi.fn()} />);
    await screen.findByText("Clinical Obligation Passport (2)");

    const floatingTab = screen.getByRole("button", {
      name: /Open HIE & EMR Integrations Hub \(4 connected\)/i,
    });
    await user.click(floatingTab);

    const dialog = await screen.findByRole("dialog", {
      name: /HIE & EMR Integrations Hub/i,
    });
    expect(within(dialog).getByText("Malaffi (Abu Dhabi HIE)")).toBeInTheDocument();
    expect(within(dialog).getByText("Oracle Health (Cerner Millennium)")).toBeInTheDocument();
    expect(within(dialog).getByText("Epic Systems (EpicCare & Stork OB)")).toBeInTheDocument();
    expect(within(dialog).getByAltText("Malaffi (Abu Dhabi HIE) logo")).toBeInTheDocument();
    expect(within(dialog).getByAltText("Oracle Health (Cerner Millennium) logo")).toBeInTheDocument();

    // Add a custom hospital EMR integration
    await user.click(within(dialog).getByRole("button", { name: /Add EMR \/ Hospital/i }));
    await user.type(
      within(dialog).getByPlaceholderText(/e\.g\. Allscripts Sunrise \/ NMC Royal EHR/i),
      "NMC Royal Sunrise EHR"
    );
    await user.click(within(dialog).getByRole("button", { name: /Connect Endpoint/i }));

    expect(within(dialog).getByText("NMC Royal Sunrise EHR")).toBeInTheDocument();
    expect(within(dialog).getByText(/5 Connected/)).toBeInTheDocument();

    vi.restoreAllMocks();
  });
});

describe("<PatientSearchOnboarding /> & Tutorial -> Search -> AI Reconciliation flow", () => {
  afterEach(() => {
    window.location.hash = "";
    vi.restoreAllMocks();
  });

  it("parses streamed questionnaire markers incrementally via parseStreamedQuestionnaire", () => {
    const raw = [
      "CONTEXT_NOTE:",
      "Confirm 5th vs 8th week gestation and thyroid regimen.",
      "Q1_QUESTION:",
      "What pregnancy stage are we at today?",
      "Q1_OPTIONS:",
      "8th week gestation | 5th week gestation | Still Preconception",
      "Q2_QUESTION:",
      "What medications are we on?",
      "Q2_OPTIONS:",
      "Folic Acid 400 mcg | Levothyroxine 25 mcg externally",
      "Q3_QUESTION:",
      "Were outside repeat TSH labs drawn?",
      "Q3_OPTIONS:",
      "No outside labs yet | Repeat TSH pending upload",
    ].join("\n");

    const parsed = parseStreamedQuestionnaire(raw);
    expect(parsed.context_note).toBe("Confirm 5th vs 8th week gestation and thyroid regimen.");
    expect(parsed.questions).toHaveLength(3);
    expect(parsed.questions[0].question).toBe("What pregnancy stage are we at today?");
    expect(parsed.questions[0].options).toEqual([
      "8th week gestation",
      "5th week gestation",
      "Still Preconception",
    ]);
    expect(parsed.questions[2].options).toEqual([
      "No outside labs yet",
      "Repeat TSH pending upload",
    ]);
  });

  it("routes Tutorial -> Search page -> AI-streamed reconciliation questionnaire -> auto-updated full view", async () => {
    const user = userEvent.setup();
    window.location.hash = "";
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});

    let currentObs = makeSeedObligations();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const pathname = new URL(url, "http://localhost").pathname;
      const method = (init?.method ?? "GET").toUpperCase();

      if (pathname === "/api/health") {
        return createJsonResponse({
          status: "ok",
          residency_policy: "UAE_PHI_LOCAL_ONLY",
          ai_provider: { provider: "openrouter", configured: true, model: "google/gemma-4-31b-it:free" },
          database: { provider: "neon-postgres", connected: true, branch: "main", pooled: true, detail: "Connected" },
        });
      }

      if (pathname === "/api/patients" && method === "GET") {
        return createJsonResponse({
          patients: [
            {
              patient_id: "PAT-AE-4092",
              patient_name: "Amina Al-Mansoori (Synthetic)",
              age_sex: "32Y · F",
              clinical_track: "Endocrine & Rubella Continuity",
              facility_a: "Mubadala Primary Care",
              facility_b: "Corniche OB-GYN",
              life_stage: currentObs[0].life_stage,
              total_obligations: 2,
              open_count: 2,
              urgent_count: 0,
              deferred_count: 0,
              closed_count: 0,
            },
            {
              patient_id: "PAT-AE-5180",
              patient_name: "Fatima Al-Zaabi (Synthetic)",
              age_sex: "29Y · F",
              clinical_track: "Metabolic & Varicella Continuity",
              facility_a: "Al Bateen Primary Clinic",
              facility_b: "Corniche OB-GYN",
              life_stage: "Preconception",
              total_obligations: 2,
              open_count: 2,
              urgent_count: 0,
              deferred_count: 0,
              closed_count: 0,
            },
          ],
          cohort_totals: {
            total_patients: 2,
            total_open: 4,
            total_urgent: 0,
            total_deferred: 0,
            total_closed: 0,
          },
        });
      }

      if (pathname === "/api/obligations" && method === "GET") {
        return createJsonResponse({
          patient_id: "PAT-AE-4092",
          obligations: currentObs,
          audit_events: [],
        });
      }

      if (
        pathname === "/api/patients/PAT-AE-4092/reconcile-questions/stream" &&
        method === "POST"
      ) {
        return createSseResponse([
          {
            event: "firewall_verified",
            data: {
              patient_id: "PAT-AE-4092",
              privacy_report: {
                payload: { residency_policy: "UAE_PHI_LOCAL_ONLY", case_token: "ANON-CASE-A1B2C3D4" },
                redacted_fields: ["patient_id", "patient_name"],
                permitted_fields: ["case_token", "finding_title"],
                phi_check_passed: true,
              },
            },
          },
          {
            event: "token",
            data: { delta: "CONTEXT_NOTE:\nVerify 5th vs 8th week gestation.\n", model: "google/gemma-4-31b-it:free" },
          },
          {
            event: "complete",
            data: {
              patient_id: "PAT-AE-4092",
              context_note:
                "Cross-check gestational week (5th-week referral vs 8th-week scan) and active thyroid regimen.",
              questions: [
                {
                  id: "pregnancy_stage",
                  category: "Pregnancy Stage & Dating",
                  question:
                    "What pregnancy stage are we at today? HIE shows 5th week, which may actually be 8th week on ultrasound.",
                  data_shows: "HIE Record: Preconception · 5th-week referral flag",
                  options: [
                    "8th week gestation (Antenatal Trimester 1 confirmed by scan)",
                    "5th week gestation (Matches referral note)",
                    "Still Preconception (Not currently pregnant)",
                  ],
                  placeholder: "Enter gestational week...",
                },
                {
                  id: "medications",
                  category: "Medication Reconciliation",
                  question:
                    "What medications are we on? Is it different from what current HIE data shows?",
                  data_shows: "HIE List: Folic Acid 400 mcg daily",
                  options: [
                    "Matches HIE data (Folic Acid 400 mcg only)",
                    "Started levothyroxine 25 mcg externally",
                  ],
                  placeholder: "Enter medications...",
                },
                {
                  id: "scenario_specific",
                  category: "Thyroid & Rubella Scenario Check",
                  question: "Were outside TSH labs drawn or an MMR shot documented?",
                  data_shows: "Documents: TSH 4.8 mIU/L & Rubella Non-Immune",
                  options: ["No outside labs yet — keep both open"],
                  placeholder: "Note external records...",
                },
              ],
              disclaimer: "Assistive reconciliation only.",
              ai_metadata: {
                mode: "openrouter",
                provider: "openrouter",
                model: "google/gemma-4-31b-it:free",
                fallback_reason: null,
              },
              privacy_report: {
                payload: { residency_policy: "UAE_PHI_LOCAL_ONLY" },
                redacted_fields: ["patient_id", "patient_name"],
                permitted_fields: ["case_token"],
                phi_check_passed: true,
              },
            },
          },
        ]);
      }

      if (pathname === "/api/patients/PAT-AE-4092/reconcile-submit" && method === "POST") {
        currentObs = makePregnancyObligations();
        return createJsonResponse({
          patient_id: "PAT-AE-4092",
          target_life_stage: "Antenatal (Trimester 1)",
          transition_triggered: "FHIR_PREGNANCY_CONFIRMED",
          transition_result: {
            event_type: "FHIR_PREGNANCY_CONFIRMED",
            agent_summary: "Pregnancy transition escalated TSH follow-up and deferred live MMR.",
            specialist_handoff: "• Review OBL-101 urgent TSH follow-up.",
            ai_metadata: {
              mode: "openrouter",
              provider: "openrouter",
              model: "google/gemma-4-31b-it:free",
              fallback_reason: null,
            },
            privacy_report: {
              payload: { residency_policy: "UAE_PHI_LOCAL_ONLY", case_token: "ANON-CASE-1234" },
              redacted_fields: ["patient_id", "patient_name"],
              permitted_fields: ["case_token"],
              phi_check_passed: true,
            },
            trace: [
              {
                node: "detect_open_obligations",
                execution: "deterministic",
                phi_exposed: false,
                detail: "Identified 2 open obligations.",
              },
            ],
            obligations: currentObs,
            audit_events: [
              {
                id: 50,
                obligation_id: "OBL-101",
                event_type: "CLINICAL_SCENARIO_RECONCILED",
                actor: "Dr. Layla Al-Hashimi (OB-GYN)",
                summary:
                  "Reconciled clinical context for PAT-AE-4092 (Antenatal Trimester 1): 8th week gestation, levothyroxine 25 mcg.",
                created_at: "2026-11-22T14:30:00Z",
              },
            ],
          },
          reconciliation: {
            patient_id: "PAT-AE-4092",
            reconciled_stage: "Antenatal (Trimester 1)",
            pregnancy_stage_answer: "8th week gestation (Antenatal Trimester 1 confirmed by scan)",
            medications_answer: "Started levothyroxine 25 mcg externally",
            scenario_answer: "No outside labs yet — keep both open",
            additional_info: "Ultrasound CRL confirmed 8w2d.",
            clinician_name: "Dr. Layla Al-Hashimi (OB-GYN)",
            reconciled_at: "2026-11-22T14:30:00Z",
            transition_triggered: "FHIR_PREGNANCY_CONFIRMED",
          },
          obligations: currentObs,
          audit_events: [],
        });
      }

      return createJsonResponse({ detail: `Unhandled mock route: ${method} ${url}` }, 404);
    });

    render(<App />);

    // 1. Start on TutorialHome and click Launch Live Prototype -> opens Patient Search Page
    await user.click(screen.getAllByRole("button", { name: /Launch Live Prototype/i })[0]);
    expect(
      await screen.findByRole("heading", { name: /Search & Select Patient Record/i })
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#search");

    // 2. Search narrows cohort to Amina, then click Select Patient & Reconcile
    const searchInput = screen.getByRole("searchbox", {
      name: /Search patients by name, MRN, track, or facility/i,
    });
    await user.type(searchInput, "Amina");
    expect(screen.queryByText(/Fatima Al-Zaabi \(Synthetic\)/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Select Patient & Reconcile/i }));

    // 3. AI-streamed questionnaire loads with zero-PHI verification & scenario questions
    expect(
      await screen.findByText(/What pregnancy stage are we at today\?/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/UAE Firewall Verified · 0 PHI Sent to AI/i)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: /8th week gestation \(Antenatal Trimester 1 confirmed by scan\)/i,
      })
    );
    await user.click(
      screen.getByRole("button", { name: /Started levothyroxine 25 mcg externally/i })
    );
    await user.click(
      screen.getByRole("button", { name: /No outside labs yet — keep both open/i })
    );
    await user.type(
      screen.getByLabelText(/Any additional information/i),
      "Ultrasound CRL confirmed 8w2d."
    );

    // Deterministic preview banner confirms Antenatal rule auto-trigger
    expect(screen.getByText(/Deterministic Rule Engine Preview:/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Confirm & Open Full Patient View/i }));

    // 4. Full workbench opens at #demo with Reconciled Context banner & escalated Antenatal obligations
    const main = await screen.findByRole("main");
    expect(window.location.hash).toBe("#demo");
    expect(
      await within(main).findByText(/Clinician-Reconciled Scenario & Document Context/i)
    ).toBeInTheDocument();
    expect(within(main).getByText(/Ultrasound CRL confirmed 8w2d\./i)).toBeInTheDocument();
    expect(within(main).getByText("ESCALATED_FOR_REVIEW")).toBeInTheDocument();
    expect(within(main).getByText("DEFERRED_TO_POSTPARTUM")).toBeInTheDocument();

    // Returning via Change Patient / Reconcile opens Search Page again
    await user.click(within(main).getByRole("button", { name: /Change Patient \/ Reconcile/i }));
    expect(
      await screen.findByRole("heading", { name: /Search & Select Patient Record/i })
    ).toBeInTheDocument();
  });
});
