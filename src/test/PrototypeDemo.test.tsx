import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PrototypeDemo, {
  SAMPLE_IMPORT_CSV,
  buildOutboundFhirBundle,
  detectObligationId,
  formatExecutionLabel,
  getUrgentDueChip,
  parseDelimitedTable,
  parseHandoffItems,
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

      return createJsonResponse({ detail: `Unhandled mock route: ${method} ${url}` }, 404);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(within(main).getByText("Clinical Obligation Passport (2)")).toBeInTheDocument();
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
    render(<PrototypeDemo onBackToTutorial={vi.fn()} />);

    const main = screen.getByRole("main");
    await within(main).findByText("Clinical Obligation Passport (2)");
    await user.click(within(main).getByRole("button", { name: /Trigger Pregnancy Transition/i }));

    expect(
      await within(main).findByText(
        "Pregnancy transition escalated TSH follow-up and deferred live MMR."
      )
    ).toBeInTheDocument();
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

    // Open searchable/sortable Population Registry dialog
    await user.click(within(cohortStrip).getByRole("button", { name: /Switch Patient/i }));
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

    const main = screen.getByRole("main");
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
