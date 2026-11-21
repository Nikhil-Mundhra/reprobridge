import type { FacilityStage } from "./types";

export const SAMPLE_IMPORT_CSV = `title,rationale,priority,life_stage,owner,evidence_source,incoming_evidence_result
Gestational Diabetes OGTT Follow-up,Elevated 1-hour glucose challenge (152 mg/dL); requires 3-hour 100g OGTT confirmation.,HIGH,Antenatal (Trimester 1),OB-GYN / Endocrinology,FHIR Observation/obs-ogtt-2026-10,3-hour OGTT normal across all 4 draws (fasting 84 mg/dL)
Iron Deficiency Anemia Ferritin Check,Preconception ferritin 11 ng/mL; requires oral iron supplementation and 6-week repeat CBC.,MEDIUM,Preconception,Primary Care / OB-GYN,FHIR Observation/obs-ferritin-2026-09,Repeat ferritin 38 ng/mL & Hb 12.6 g/dL after iron therapy`;

export const FLOW_STEPS = [
  { step: 1, label: "Clinical Finding", desc: "FHIR / Malaffi HIE intake" },
  { step: 2, label: "Care-Gap Detection", desc: "Deterministic clinical rules" },
  { step: 3, label: "Obligation Passport", desc: "Auditable longitudinal record" },
  { step: 4, label: "Life-Stage Transition", desc: "Pregnancy & Postpartum events" },
  { step: 5, label: "UAE Firewall + AI", desc: "De-identified OpenRouter brief" },
  { step: 6, label: "Verified Closure", desc: "Clinician evidence sign-off" },
];

export const TRACE_NODE_META: Record<
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

export const SYNTHETIC_FHIR_RECORDS: Record<string, Record<string, unknown>> = {
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

export const AUDIT_EVENT_META: Record<
  string,
  {
    label: string;
    dot: string;
    tag: string;
    category: "closure" | "ai" | "transition" | "intake" | "safety";
  }
> = {
  EVIDENCE_VERIFIED_CLOSURE: {
    label: "Verified Closure",
    dot: "bg-emerald-500",
    tag: "bg-emerald-50 text-emerald-800 border-emerald-200",
    category: "closure",
  },
  CLINICAL_SAFETY_BLOCKED: {
    label: "Safety Guard Blocked",
    dot: "bg-rose-600",
    tag: "bg-rose-50 text-rose-800 border-rose-200",
    category: "safety",
  },
  AGENT_BRIEF_GENERATED: {
    label: "AI Brief (0 PHI)",
    dot: "bg-purple-500",
    tag: "bg-purple-50 text-purple-800 border-purple-200",
    category: "ai",
  },
  LIFE_STAGE_TRANSITION: {
    label: "Life-Stage Rule",
    dot: "bg-sky-500",
    tag: "bg-sky-50 text-sky-800 border-sky-200",
    category: "transition",
  },
  CARE_GAP_DETECTED: {
    label: "Care Gap Intake",
    dot: "bg-amber-500",
    tag: "bg-amber-50 text-amber-800 border-amber-200",
    category: "intake",
  },
  OBLIGATION_IMPORTED: {
    label: "Imported Finding",
    dot: "bg-amber-500",
    tag: "bg-amber-50 text-amber-800 border-amber-200",
    category: "intake",
  },
  EVIDENCE_RECORDED: {
    label: "Evidence Logged",
    dot: "bg-teal-500",
    tag: "bg-teal-50 text-teal-800 border-teal-200",
    category: "intake",
  },
};

export const FACILITY_CONTINUITY_STAGES: FacilityStage[] = [
  {
    stageIndex: 0,
    dayTag: "Day 0",
    facility: "Mubadala Primary Care",
    emrSystem: "Epic",
  },
  {
    stageIndex: 1,
    dayTag: "Day 142",
    facility: "Corniche OB-GYN",
    emrSystem: "Oracle",
  },
  {
    stageIndex: 2,
    dayTag: "Day 410",
    facility: "Abu Dhabi Maternity Ward",
    emrSystem: "Inpatient",
  },
];

export const PRIORITY_STYLES: Record<string, string> = {
  URGENT: "bg-rose-100 text-rose-800 border-rose-200",
  HIGH: "bg-amber-100 text-amber-800 border-amber-200",
  MEDIUM: "bg-sky-100 text-sky-800 border-sky-200",
};

export const STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-slate-100 text-slate-700",
  ESCALATED_FOR_REVIEW: "bg-rose-600 text-white",
  DEFERRED_TO_POSTPARTUM: "bg-indigo-100 text-indigo-800",
  VERIFIED_CLOSED: "bg-emerald-100 text-emerald-800",
};

export const INTERIM_TIPS: Record<string, { title: string; body: string }[]> = {
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
