import type { FacilityStage, PatientCohortSummary } from "./types";

export const DEFAULT_PATIENT_COHORT: PatientCohortSummary[] = [
  {
    patient_id: "PAT-AE-4092",
    patient_name: "Amira Al-Mansoori (Synthetic)",
    age_sex: "31Y · F · G1P0",
    clinical_track: "Hashimoto's (Age 16, 2011 Note) → Pregnancy Intake (Age 31, 2026)",
    facility_a: "Hospital A · Al Ain Adolescent Clinic (2011)",
    facility_b: "Hospital B · Corniche OB-GYN (2026)",
    life_stage: "Antenatal (Trimester 1)",
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
    clinical_track: "GDM Postpartum OGTT & Varicella",
    facility_a: "Al Bateen Primary Clinic",
    facility_b: "Corniche OB-GYN",
    life_stage: "Preconception",
    total_obligations: 2,
    open_count: 2,
    urgent_count: 0,
    deferred_count: 0,
    closed_count: 0,
  },
  {
    patient_id: "PAT-AE-6304",
    patient_name: "Sara Al-Nuaimi (Synthetic)",
    age_sex: "36Y · F",
    clinical_track: "Postpartum BP & HPV Continuity",
    facility_a: "Khalifa City Family Medicine",
    facility_b: "Danat Al Emarat Maternity",
    life_stage: "Preconception",
    total_obligations: 2,
    open_count: 2,
    urgent_count: 0,
    deferred_count: 0,
    closed_count: 0,
  },
  {
    patient_id: "PAT-AE-7415",
    patient_name: "Mariam Al-Dhaheri (Synthetic)",
    age_sex: "31Y · F",
    clinical_track: "Perinatal Mental Health & Cervical Screening",
    facility_a: "Al Ain Primary Women's Clinic",
    facility_b: "Tawam OB-GYN & Perinatal Psychiatry",
    life_stage: "Preconception",
    total_obligations: 2,
    open_count: 2,
    urgent_count: 0,
    deferred_count: 0,
    closed_count: 0,
  },
  {
    patient_id: "PAT-AE-8529",
    patient_name: "Hessa Al-Mazrouei (Synthetic)",
    age_sex: "27Y · F",
    clinical_track: "Endometriosis Evaluation Continuity",
    facility_a: "Yas Island Family Medicine",
    facility_b: "Cleveland Clinic Abu Dhabi Gynecology",
    life_stage: "Preconception",
    total_obligations: 1,
    open_count: 1,
    urgent_count: 0,
    deferred_count: 0,
    closed_count: 0,
  },
];

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
  { shortTitle: string; title: string; accent: string; badge: string }
> = {
  detect_open_obligations: {
    shortTitle: "Detect",
    title: "Detect Open Obligations",
    accent: "border-t-teal-500",
    badge: "bg-teal-100 text-teal-800",
  },
  evaluate_life_stage_transition: {
    shortTitle: "Evaluate",
    title: "Evaluate Transition Rules",
    accent: "border-t-sky-500",
    badge: "bg-sky-100 text-sky-800",
  },
  apply_uae_privacy_firewall: {
    shortTitle: "Firewall",
    title: "UAE Privacy Firewall",
    accent: "border-t-indigo-500",
    badge: "bg-indigo-100 text-indigo-800",
  },
  synthesize_coordination_brief: {
    shortTitle: "Synthesize",
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
  "OBL-201": {
    resourceType: "Observation",
    id: "obs-hba1c-2026-09",
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "4548-4",
          display: "Hemoglobin A1c/Hemoglobin.total in Blood",
        },
      ],
    },
    subject: { reference: "Patient/PAT-AE-5180" },
    effectiveDateTime: "2026-09-18T08:45:00+04:00",
    valueQuantity: { value: 6.1, unit: "%", system: "http://unitsofmeasure.org", code: "%" },
    interpretation: [{ coding: [{ code: "H", display: "Prediabetes / Impaired" }] }],
    meta: { source: "urn:malaffi:hie:synthetic-albateen-lab" },
  },
  "OBL-202": {
    resourceType: "DiagnosticReport",
    id: "rep-vzv-2026-08",
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "15410-4",
          display: "Varicella zoster virus IgG Ab [Units/volume] in Serum",
        },
      ],
    },
    subject: { reference: "Patient/PAT-AE-5180" },
    effectiveDateTime: "2026-08-27T10:20:00+04:00",
    conclusion:
      "VZV IgG Non-Immune (<100 mIU/mL). Live Varicella vaccine deferred if pregnant; vaccinate postpartum.",
    meta: { source: "urn:malaffi:hie:synthetic-albateen-serology" },
  },
  "OBL-301": {
    resourceType: "Observation",
    id: "obs-bp-2026-09",
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "85354-9",
          display: "Blood pressure panel with all children optional",
        },
      ],
    },
    subject: { reference: "Patient/PAT-AE-6304" },
    effectiveDateTime: "2026-09-21T11:10:00+04:00",
    component: [
      { code: { text: "Systolic BP" }, valueQuantity: { value: 138, unit: "mmHg" } },
      { code: { text: "Diastolic BP" }, valueQuantity: { value: 88, unit: "mmHg" } },
    ],
    meta: { source: "urn:malaffi:hie:synthetic-khalifacity-vitals" },
  },
  "OBL-302": {
    resourceType: "ImmunizationRecommendation",
    id: "rec-hpv-2026-08",
    patient: { reference: "Patient/PAT-AE-6304" },
    date: "2026-08-29T09:00:00+04:00",
    recommendation: [
      {
        vaccineCode: [{ coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "165", display: "HPV 9-valent" }] }],
        doseNumberPositiveInt: 2,
        seriesDosesPositiveInt: 3,
        forecastStatus: { text: "Due (Defer during pregnancy; complete postpartum)" },
      },
    ],
    meta: { source: "urn:malaffi:hie:synthetic-immunization-registry" },
  },
  "OBL-401": {
    resourceType: "QuestionnaireResponse",
    id: "qr-epds-2026-09",
    status: "completed",
    subject: { reference: "Patient/PAT-AE-7415" },
    authored: "2026-09-25T10:15:00+04:00",
    item: [
      { linkId: "epds-total", text: "Edinburgh Postnatal Depression Scale (EPDS)", answer: [{ valueInteger: 15 }] },
      { linkId: "gad7-total", text: "GAD-7 Anxiety Scale", answer: [{ valueInteger: 12 }] },
      { linkId: "epds-item10", text: "Self-harm safety item", answer: [{ valueString: "Negative at intake (re-check on follow-up)" }] },
    ],
    meta: { source: "urn:malaffi:hie:synthetic-alain-behavioral-screen" },
  },
  "OBL-402": {
    resourceType: "DiagnosticReport",
    id: "rep-cervical-2026-07",
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: "10524-7",
          display: "Microscopic observation in Cervix by Cyto stain (Pap) + High-Risk HPV",
        },
      ],
    },
    subject: { reference: "Patient/PAT-AE-7415" },
    effectiveDateTime: "2026-07-19T09:40:00+04:00",
    conclusion:
      "Pre-pregnancy HPV16 Positive with HSIL cytology. No interim colposcopy documented; reconcile with pregnancy status per Abu Dhabi DoH / ASCCP algorithm.",
    meta: { source: "urn:malaffi:hie:synthetic-alain-cytology" },
  },
  "OBL-501": {
    resourceType: "Condition",
    id: "cond-pelvic-pain-2026-09",
    clinicalStatus: { coding: [{ code: "active" }] },
    code: { text: "Recurring severe dysmenorrhea & chronic cyclic pelvic pain (suspected endometriosis)" },
    subject: { reference: "Patient/PAT-AE-8529" },
    recordedDate: "2026-09-10",
    note: [
      {
        text: "3 documented visits over 14 months with missed workdays; transvaginal ultrasound normal. Per NICE NG73, normal scan does not exclude endometriosis.",
      },
    ],
    meta: { source: "urn:malaffi:hie:synthetic-yas-family-medicine" },
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
  CLINICAL_SAFETY_ESCALATED: {
    label: "Urgent Safety Escalated",
    dot: "bg-rose-600",
    tag: "bg-rose-50 text-rose-800 border-rose-200",
    category: "safety",
  },
  CLINICAL_SIGNAL_PRESERVED: {
    label: "Signal Preserved",
    dot: "bg-indigo-500",
    tag: "bg-indigo-50 text-indigo-800 border-indigo-200",
    category: "safety",
  },
  CHILD_OBLIGATION_CREATED: {
    label: "Linked Follow-up",
    dot: "bg-teal-600",
    tag: "bg-teal-50 text-teal-800 border-teal-200",
    category: "transition",
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
    dayTag: "Age 16 → 31",
    facility: "Mubadala Primary Care",
    emrSystem: "Epic",
  },
  {
    stageIndex: 1,
    dayTag: "Age 32 · Now",
    facility: "Corniche OB-GYN",
    emrSystem: "Oracle",
  },
  {
    stageIndex: 2,
    dayTag: "Postpartum",
    facility: "Abu Dhabi Maternity Ward",
    emrSystem: "Inpatient",
  },
];

export const PATIENT_FACILITY_STAGES: Record<string, FacilityStage[]> = {
  "PAT-AE-4092": FACILITY_CONTINUITY_STAGES,
  "PAT-AE-5180": [
    {
      stageIndex: 0,
      dayTag: "Day 0",
      facility: "Al Bateen Primary Clinic",
      emrSystem: "Epic",
    },
    {
      stageIndex: 1,
      dayTag: "Day 98",
      facility: "Corniche OB-GYN",
      emrSystem: "Oracle",
    },
    {
      stageIndex: 2,
      dayTag: "Day 372",
      facility: "Corniche Maternity Ward",
      emrSystem: "Inpatient",
    },
  ],
  "PAT-AE-6304": [
    {
      stageIndex: 0,
      dayTag: "Day 0",
      facility: "Khalifa City Family Medicine",
      emrSystem: "Epic",
    },
    {
      stageIndex: 1,
      dayTag: "Day 112",
      facility: "Danat Al Emarat Maternity",
      emrSystem: "Oracle",
    },
    {
      stageIndex: 2,
      dayTag: "Day 386",
      facility: "Danat Al Emarat Postpartum",
      emrSystem: "Inpatient",
    },
  ],
  "PAT-AE-7415": [
    {
      stageIndex: 0,
      dayTag: "Day 0",
      facility: "Al Ain Primary Women's Clinic",
      emrSystem: "Epic",
    },
    {
      stageIndex: 1,
      dayTag: "Day 84",
      facility: "Tawam OB-GYN & Perinatal Psychiatry",
      emrSystem: "Oracle",
    },
    {
      stageIndex: 2,
      dayTag: "Day 350",
      facility: "Tawam Postpartum & Colposcopy Clinic",
      emrSystem: "Inpatient",
    },
  ],
  "PAT-AE-8529": [
    {
      stageIndex: 0,
      dayTag: "Day 0",
      facility: "Yas Island Family Medicine",
      emrSystem: "Epic",
    },
    {
      stageIndex: 1,
      dayTag: "Month 14",
      facility: "Cleveland Clinic Abu Dhabi Gynecology",
      emrSystem: "Epic",
    },
    {
      stageIndex: 2,
      dayTag: "Follow-up",
      facility: "Endometriosis Specialist Pathway",
      emrSystem: "Malaffi HIE",
    },
  ],
};

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
