import { type CSSProperties, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Building2,
  CheckCircle2,
  EyeOff,
  FileText,
  FlaskConical,
  Lock,
  Printer,
  Search,
  ShieldCheck,
  Stethoscope,
  Syringe,
  X,
} from "lucide-react";
import { handleSpatialKeyDown } from "./spatialNav";
import {
  clampDrawerWidth,
  DEFAULT_DRAWER_WIDTH,
  getMaxDrawerWidth,
  MIN_DRAWER_WIDTH,
  readDocsSessionPrefs,
  writeDocsSessionPrefs,
  type DocsDockSide,
} from "./demo/docsSessionPrefs";

export interface DrawerObligationSummary {
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

interface ClinicalDocumentsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  initialDocId?: string | null;
  currentLifeStage: string;
  obligations: DrawerObligationSummary[];
  patientId?: string;
  clinicianLabel?: string;
  side?: DocsDockSide;
  drawerWidth?: number;
  onDrawerWidthChange?: (width: number) => void;
}

type DocCategory = "lab" | "serology" | "ob_note" | "immunization" | "imported";

interface AnalyteRow {
  testName: string;
  loinc: string;
  value: string;
  unit: string;
  flag?: "HIGH" | "NON-IMMUNE" | "POSITIVE" | "NORMALIZED" | "NORMAL" | "ADMINISTERED";
  referenceRange: string;
  method?: string;
  priorDelta?: string;
  highlight?: boolean;
}

interface ClinicalDocument {
  id: string;
  linkedObligationId: string | null;
  category: DocCategory;
  stageTag: "Preconception" | "Antenatal" | "Postpartum";
  dayTag: string;
  shortTitle: string;
  documentTitle: string;
  facilityName: string;
  facilitySubline: string;
  emrSystem: string;
  licenseCode: string;
  accessionId: string;
  encounterId: string;
  fhirReference: string;
  collectedAt: string;
  receivedAt: string;
  reportedAt: string;
  specimenType: string;
  orderingPhysician: string;
  performingPhysician: string;
  reportStatus: "FINAL" | "VERIFIED" | "AMENDED";
  transferBanner?: string;
  analytes: AnalyteRow[];
  clinicalNotes: string[];
  rxOrder?: {
    medication: string;
    sig: string;
    prescriber: string;
    dispenseStatus: string;
  };
  signatureBlock: {
    signedBy: string;
    credentials: string;
    signedAt: string;
    registryNote: string;
  };
  searchTokens: string;
}

// Lazy probe for discrete `display` transitions (modern-web-guidance: animate-to-from-top-layer)
let cachedDisplayTransitionSupport: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (cachedDisplayTransitionSupport !== undefined) return cachedDisplayTransitionSupport;
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  cachedDisplayTransitionSupport = getComputedStyle(probe).display === "block";
  probe.remove();
  return cachedDisplayTransitionSupport;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.CSS?.supports?.("overlay", "auto")) &&
    canTransitionDisplay()
  );
}

async function closeDialogWithAnimation(dialog: HTMLDialogElement): Promise<void> {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((resolve) => window.setTimeout(resolve, 400)),
      ]);
    }
    if (!dialog.hasAttribute("data-closing")) return;
    dialog.removeAttribute("data-closing");
  }
  if (dialog.open) {
    dialog.close();
  }
}

/** Deterministic SVG Code-128 style barcode for realistic lab accession headers. */
function AccessionBarcode({ value }: { value: string }) {
  const bars = useMemo(() => {
    const out: { x: number; w: number }[] = [];
    let cursor = 0;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      const pattern = [
        (code % 2) + 1,
        ((code >> 1) % 2) + 1,
        ((code >> 2) % 3) + 1,
        ((code >> 3) % 2) + 1,
      ];
      pattern.forEach((width, idx) => {
        if (idx % 2 === 0) {
          out.push({ x: cursor, w: width });
        }
        cursor += width + 1;
      });
    }
    return { items: out, totalWidth: Math.max(cursor, 96) };
  }, [value]);

  return (
    <div className="inline-flex flex-col items-end">
      <svg
        viewBox={`0 0 ${bars.totalWidth} 28`}
        className="h-7 w-36 text-slate-900"
        role="img"
        aria-label={`Synthetic accession barcode ${value}`}
      >
        {bars.items.map((bar, idx) => (
          <rect key={idx} x={bar.x} y={0} width={bar.w} height={28} fill="currentColor" />
        ))}
      </svg>
      <span className="mt-0.5 font-mono text-[10px] tracking-wider text-slate-600">*{value}*</span>
    </div>
  );
}

const BASE_CLINICAL_DOCUMENTS: ClinicalDocument[] = [
  {
    id: "DOC-LAB-01",
    linkedObligationId: "OBL-101",
    category: "lab",
    stageTag: "Preconception",
    dayTag: "Day 0",
    shortTitle: "Preconception Endocrine Lab (TSH 4.8)",
    documentTitle: "CLINICAL CHEMISTRY & ENDOCRINOLOGY LABORATORY REPORT",
    facilityName: "MUBADALA PRIMARY CARE DIAGNOSTICS",
    facilitySubline: "Al Maryah Island · Abu Dhabi, UAE · ISO 15189 / CAP Synthetic Lab Layout",
    emrSystem: "Epic Beaker · Malaffi HIE",
    licenseCode: "DoH-SYN-MF4092",
    accessionId: "ACC-2026-0914-8821",
    encounterId: "ENC-MPC-2026-4410",
    fhirReference: "Observation/obs-tsh-2026-09",
    collectedAt: "14-Sep-2026 08:12 +04:00",
    receivedAt: "14-Sep-2026 08:40 +04:00",
    reportedAt: "14-Sep-2026 09:30 +04:00",
    specimenType: "Serum (SST Gold Top · Fasting)",
    orderingPhysician: "Dr. Tariq Al-Nuaimi, MRCGP (Family Medicine)",
    performingPhysician: "Dr. Hessa Al-Dhaheri, FRCPath (Clinical Pathology)",
    reportStatus: "FINAL",
    analytes: [
      {
        testName: "Thyrotropin (TSH), Ultrasensitive",
        loinc: "3016-3",
        value: "4.80",
        unit: "mIU/L",
        flag: "HIGH",
        referenceRange: "0.40 – 4.00 (Non-Pregnant) | < 2.50 (Trimester 1)",
        method: "ECLIA (Cobas e801)",
        highlight: true,
      },
      {
        testName: "Free Thyroxine (Free T4)",
        loinc: "3024-7",
        value: "13.4",
        unit: "pmol/L",
        flag: "NORMAL",
        referenceRange: "12.0 – 22.0",
        method: "ECLIA",
      },
      {
        testName: "Hemoglobin (Whole Blood)",
        loinc: "718-7",
        value: "12.8",
        unit: "g/dL",
        flag: "NORMAL",
        referenceRange: "12.0 – 15.5",
        method: "Photometry",
      },
      {
        testName: "Hemoglobin A1c (NGSP)",
        loinc: "4548-4",
        value: "5.2",
        unit: "%",
        flag: "NORMAL",
        referenceRange: "4.0 – 5.6",
        method: "HPLC",
      },
    ],
    clinicalNotes: [
      "INTERPRETATION: Elevated serum TSH (4.80 mIU/L) with normal Free T4 (13.4 pmol/L) consistent with subclinical hypothyroidism.",
      "PRECONCEPTION / PREGNANCY ADVISORY: For patients planning pregnancy or entering Trimester 1, TSH > 2.50 mIU/L warrants repeat thyroid panel and OB-GYN / Endocrinology evaluation per illustrative clinical guidance (Rule RB-THYROID-v1.4.0).",
      "SPECIMEN INTEGRITY: No hemolysis, icterus, or lipemia detected. Automated validation passed.",
    ],
    signatureBlock: {
      signedBy: "Dr. Hessa Al-Dhaheri, MD, FRCPath",
      credentials: "Consultant Clinical Pathologist · Synthetic Laboratory Director",
      signedAt: "14-Sep-2026 09:30 +04:00",
      registryNote: "Electronically verified & published to Abu Dhabi Malaffi HIE (Synthetic Feed)",
    },
    searchTokens: "tsh thyroid 4.8 hypothyroidism 3016-3 free t4 hba1c mubadala epic preconception obl-101",
  },
  {
    id: "DOC-SER-02",
    linkedObligationId: "OBL-102",
    category: "serology",
    stageTag: "Preconception",
    dayTag: "Day 0",
    shortTitle: "Preconception Serology (Rubella Non-Immune)",
    documentTitle: "INFECTIOUS DISEASE & PRENATAL SEROLOGY DIAGNOSTIC REPORT",
    facilityName: "MUBADALA PRIMARY CARE DIAGNOSTICS",
    facilitySubline: "Reference Virology & Immunology Unit · Abu Dhabi, UAE",
    emrSystem: "Epic Beaker · Malaffi HIE",
    licenseCode: "DoH-SYN-MF4092",
    accessionId: "ACC-2026-0822-3310",
    encounterId: "ENC-MPC-2026-3908",
    fhirReference: "DiagnosticReport/rep-rubella-2026-08",
    collectedAt: "22-Aug-2026 09:05 +04:00",
    receivedAt: "22-Aug-2026 09:35 +04:00",
    reportedAt: "22-Aug-2026 11:15 +04:00",
    specimenType: "Serum (SST Gold Top · Refrigerated)",
    orderingPhysician: "Dr. Tariq Al-Nuaimi, MRCGP (Family Medicine)",
    performingPhysician: "Dr. Khalid Al-Mazrouei, MD (Medical Microbiology)",
    reportStatus: "FINAL",
    analytes: [
      {
        testName: "Rubella Virus IgG Antibody (Quantitative)",
        loinc: "25514-1",
        value: "< 5.0",
        unit: "IU/mL",
        flag: "NON-IMMUNE",
        referenceRange: "< 5.0 Non-Immune | 5.0–9.9 Equivocal | ≥ 10.0 Immune",
        method: "CMIA (Architect)",
        highlight: true,
      },
      {
        testName: "Hepatitis B Surface Antigen (HBsAg)",
        loinc: "5196-1",
        value: "Non-Reactive",
        unit: "S/CO 0.14",
        flag: "NORMAL",
        referenceRange: "Non-Reactive (< 1.00)",
        method: "CMIA",
      },
      {
        testName: "Varicella-Zoster Virus (VZV) IgG",
        loinc: "15410-4",
        value: "Positive (Immune)",
        unit: "Index 3.42",
        flag: "NORMAL",
        referenceRange: "Immune (Index > 1.10)",
        method: "EIA",
      },
      {
        testName: "ABO Group & Rh(D) Typing",
        loinc: "882-1",
        value: "O Positive",
        unit: "—",
        flag: "NORMAL",
        referenceRange: "Qualitative",
        method: "Column Agglutination",
      },
    ],
    clinicalNotes: [
      "INTERPRETATION: Patient lacks protective IgG antibody titers against Rubella (< 5.0 IU/mL; Non-Immune).",
      "CONTRAINDICATION WARNING: MMR is a live-attenuated vaccine. Administer prior to conception (avoid pregnancy for 28 days) OR, if pregnancy is confirmed before vaccination, DEFER strictly to immediate postpartum prior to discharge (Rule RB-IMMUNE-v1.2.1).",
    ],
    signatureBlock: {
      signedBy: "Dr. Khalid Al-Mazrouei, MD",
      credentials: "Consultant Microbiologist · Reference Virology Lab (Synthetic)",
      signedAt: "22-Aug-2026 11:15 +04:00",
      registryNote: "Transmitted via HL7 FHIR R4 DiagnosticReport to Malaffi HIE",
    },
    searchTokens: "rubella igg non-immune mmr vaccine 25514-1 serology hbsag varicella mubadala obl-102",
  },
  {
    id: "DOC-OB-03",
    linkedObligationId: "OBL-101",
    category: "ob_note",
    stageTag: "Antenatal",
    dayTag: "Day 142",
    shortTitle: "Antenatal Confirmation & Dating Ultrasound",
    documentTitle: "OBSTETRIC INTAKE & FIRST-TRIMESTER DATING ULTRASOUND SUMMARY",
    facilityName: "CORNICHE OB-GYN SPECIALIST CLINIC",
    facilitySubline: "Maternal-Fetal Medicine & Antenatal Care · Abu Dhabi, UAE",
    emrSystem: "Oracle Health (Cerner) · Malaffi HIE",
    licenseCode: "DoH-SYN-CRN108",
    accessionId: "US-CORN-2027-0203-19",
    encounterId: "ENC-CORN-2027-0203",
    fhirReference: "Condition/cond-pregnancy-confirmed-2027",
    collectedAt: "03-Feb-2027 10:00 +04:00",
    receivedAt: "03-Feb-2027 10:15 +04:00",
    reportedAt: "03-Feb-2027 10:42 +04:00",
    specimenType: "Transvaginal Ultrasound + Quantitative Serum β-hCG",
    orderingPhysician: "Dr. Layla Al-Hashimi, MD, FACOG (OB-GYN)",
    performingPhysician: "Dr. Layla Al-Hashimi, MD, FACOG (OB-GYN)",
    reportStatus: "VERIFIED",
    transferBanner:
      "CROSS-PROVIDER CONTINUITY: Patient registered at Corniche OB-GYN (Oracle Health) 142 days after preconception care at Mubadala Primary Care (Epic). Prior unresolved obligations surfaced via ReproBridge Passport.",
    analytes: [
      {
        testName: "Quantitative Serum β-hCG",
        loinc: "21198-7",
        value: "42,850",
        unit: "mIU/mL",
        flag: "POSITIVE",
        referenceRange: "7–8 Weeks Gestation: 7,650 – 229,000",
        method: "ECLIA",
        highlight: true,
      },
      {
        testName: "Crown-Rump Length (CRL)",
        loinc: "11957-8",
        value: "13.2",
        unit: "mm",
        flag: "NORMAL",
        referenceRange: "Corresponds to 7w 4d EGA",
        method: "Transvaginal US",
      },
      {
        testName: "Fetal Cardiac Activity",
        loinc: "55283-6",
        value: "154",
        unit: "bpm",
        flag: "NORMAL",
        referenceRange: "120 – 170 bpm (Regular)",
        method: "M-Mode Doppler",
      },
      {
        testName: "Estimated Date of Delivery (EDD)",
        loinc: "11778-8",
        value: "18-Sep-2027",
        unit: "—",
        flag: "NORMAL",
        referenceRange: "Confirmed by CRL",
        method: "Hadlock",
      },
    ],
    clinicalNotes: [
      "IMPRESSION: Single live intrauterine pregnancy at 7 weeks 4 days gestation. Normal yolk sac; no subchorionic hemorrhage.",
      "CARE-GAP RECONCILIATION: External preconception labs from Hospital A (Mubadala Primary Care) revealed elevated TSH (4.80 mIU/L) and Rubella non-immune status. Urgent repeat thyroid panel ordered today; live MMR vaccination explicitly deferred to postpartum discharge.",
    ],
    signatureBlock: {
      signedBy: "Dr. Layla Al-Hashimi, MD, FACOG",
      credentials: "Consultant Obstetrician & Gynecologist · Corniche OB-GYN (Synthetic)",
      signedAt: "03-Feb-2027 10:42 +04:00",
      registryNote: "Triggers deterministic event FHIR_PREGNANCY_CONFIRMED across Malaffi HIE",
    },
    searchTokens: "pregnancy confirmed antenatal ultrasound crl hcg 7w4d corniche oracle layla handoff transfer",
  },
  {
    id: "DOC-LAB-04",
    linkedObligationId: "OBL-101",
    category: "lab",
    stageTag: "Antenatal",
    dayTag: "Day 148",
    shortTitle: "Repeat Thyroid Panel & Levothyroxine e-Rx",
    documentTitle: "ANTENATAL ENDOCRINE FOLLOW-UP LAB & THERAPEUTIC VERIFICATION",
    facilityName: "CLEVELAND CLINIC ABU DHABI · CLINICAL LABS",
    facilitySubline: "Al Maryah Island · Abu Dhabi, UAE · Malaffi HIE Connected Reference Lab",
    emrSystem: "Epic · Malaffi HIE Lab Feed",
    licenseCode: "DoH-SYN-CCAD01",
    accessionId: "MAL-LAB-2026-88412",
    encounterId: "ENC-CCAD-2027-0209",
    fhirReference: "Observation/EVD-TSH-2026-10",
    collectedAt: "09-Feb-2027 07:55 +04:00",
    receivedAt: "09-Feb-2027 08:15 +04:00",
    reportedAt: "09-Feb-2027 09:48 +04:00",
    specimenType: "Serum (SST Gold Top · Pre-Dose)",
    orderingPhysician: "Dr. Layla Al-Hashimi, MD, FACOG (OB-GYN)",
    performingPhysician: "Dr. Rami Al-Qasimi, MD (Endocrinology Lab Review)",
    reportStatus: "VERIFIED",
    analytes: [
      {
        testName: "Thyrotropin (TSH), Repeat Antenatal",
        loinc: "3016-3",
        value: "2.10",
        unit: "mIU/L",
        flag: "NORMALIZED",
        referenceRange: "Trimester 1 Target: < 2.50 mIU/L",
        method: "ECLIA (Cobas e801)",
        priorDelta: "Prior 4.80 (▼ -56%)",
        highlight: true,
      },
      {
        testName: "Free Thyroxine (Free T4)",
        loinc: "3024-7",
        value: "15.8",
        unit: "pmol/L",
        flag: "NORMAL",
        referenceRange: "12.0 – 22.0",
        method: "ECLIA",
        priorDelta: "Prior 13.4",
      },
      {
        testName: "Thyroid Peroxidase Antibody (Anti-TPO)",
        loinc: "8099-4",
        value: "18",
        unit: "IU/mL",
        flag: "NORMAL",
        referenceRange: "< 35 (Negative)",
        method: "ECLIA",
      },
    ],
    rxOrder: {
      medication: "Levothyroxine Sodium 50 mcg Oral Tablet",
      sig: "Take 1 tablet by mouth once daily, 30–60 minutes before breakfast; separate from prenatal iron/calcium by ≥ 4 hours.",
      prescriber: "Dr. Layla Al-Hashimi, MD (OB-GYN)",
      dispenseStatus: "Active & Dispensed · Malaffi e-Rx #RX-2027-90412",
    },
    clinicalNotes: [
      "QUALIFYING CLOSURE EVIDENCE (OBL-101): Repeat antenatal TSH normalized to 2.10 mIU/L (within Trimester 1 target < 2.50 mIU/L) following clinician-approved Levothyroxine 50 mcg initiation.",
      "FOLLOW-UP PLAN: Recheck TSH every 4 weeks through mid-gestation per routine antenatal endocrine monitoring.",
    ],
    signatureBlock: {
      signedBy: "Dr. Layla Al-Hashimi, MD, FACOG",
      credentials: "Reviewing OB-GYN · Linked to Evidence ID EVD-TSH-2026-10",
      signedAt: "09-Feb-2027 11:05 +04:00",
      registryNote: "Qualifying evidence available in Neon Postgres for Clinician Verify & Close",
    },
    searchTokens: "repeat tsh 2.1 normalized levothyroxine 50 mcg cleveland clinic mal-lab-2026-88412 evd-tsh obl-101",
  },
  {
    id: "DOC-IMM-05",
    linkedObligationId: "OBL-102",
    category: "immunization",
    stageTag: "Postpartum",
    dayTag: "Day 410",
    shortTitle: "Postpartum Discharge & MMR Immunization",
    documentTitle: "POSTPARTUM DISCHARGE & IMMUNIZATION ADMINISTRATION RECORD",
    facilityName: "ABU DHABI MATERNITY WARD · CORNICHE HOSPITAL",
    facilitySubline: "Postpartum Inpatient Unit · Malaffi Immunization Registry Feed",
    emrSystem: "Inpatient EHR · Malaffi Registry",
    licenseCode: "DoH-SYN-MAT410",
    accessionId: "MAL-IMM-2026-55901",
    encounterId: "ENC-ADM-2027-0918",
    fhirReference: "Immunization/EVD-MMR-2026-11",
    collectedAt: "20-Sep-2027 09:20 +04:00",
    receivedAt: "20-Sep-2027 09:22 +04:00",
    reportedAt: "20-Sep-2027 09:35 +04:00",
    specimenType: "Subcutaneous Immunization · Pre-Discharge",
    orderingPhysician: "Dr. Mariam Al-Suwaidi, MD (Postpartum OB-GYN)",
    performingPhysician: "RN Fatima Al-Kaabi, BSN (Immunization Nurse)",
    reportStatus: "VERIFIED",
    transferBanner:
      "POSTPARTUM WAKE-UP COMPLETED: Pregnancy live-vaccine contraindication lifted after delivery (SVD at 39w2d). Deferred OBL-102 reactivated and fulfilled prior to hospital discharge.",
    analytes: [
      {
        testName: "MMR Vaccine (Measles, Mumps, Rubella Live)",
        loinc: "CVX 03",
        value: "0.5 mL SC",
        unit: "Left Deltoid",
        flag: "ADMINISTERED",
        referenceRange: "Lot #MMR-2026-AE · Exp 11/2028",
        method: "Subcutaneous Injection",
        highlight: true,
      },
      {
        testName: "Pregnancy Contraindication Status",
        loinc: "Rule Check",
        value: "Lifted (Postpartum Day 2)",
        unit: "—",
        flag: "NORMALIZED",
        referenceRange: "Post-delivery verification complete",
        method: "RB-IMMUNE-v1.2.1",
      },
      {
        testName: "Post-Vaccination Observation (15 min)",
        loinc: "Safety",
        value: "No Adverse Reaction",
        unit: "Stable",
        flag: "NORMAL",
        referenceRange: "Afebrile · Vitals WNL",
        method: "Inpatient Nursing",
      },
    ],
    clinicalNotes: [
      "QUALIFYING CLOSURE EVIDENCE (OBL-102): Pre-discharge MMR vaccine administered without complication (Lot #MMR-2026-AE; Malaffi Immunization Registry #MAL-IMM-2026-55901).",
      "DISCHARGE COUNSELING: MMR vaccination is compatible with breastfeeding; advised to avoid conception for 28 days post-vaccination.",
    ],
    signatureBlock: {
      signedBy: "Dr. Mariam Al-Suwaidi, MD",
      credentials: "Postpartum OB-GYN · Linked to Evidence ID EVD-MMR-2026-11",
      signedAt: "20-Sep-2027 09:35 +04:00",
      registryNote: "Recorded in Malaffi Immunization Registry (Synthetic Demonstration Record)",
    },
    searchTokens: "postpartum mmr vaccine cvx 03 rubella lot mmr-2026-ae corniche maternity mariam mal-imm-2026-55901 obl-102",
  },
];

const FATIMA_CLINICAL_DOCUMENTS: ClinicalDocument[] = [
  {
    id: "DOC-FAT-01",
    linkedObligationId: "OBL-201",
    category: "lab",
    stageTag: "Preconception",
    dayTag: "Day 0",
    shortTitle: "Preconception Metabolic Panel (HbA1c 6.1%)",
    documentTitle: "PRECONCEPTION METABOLIC & GLYCEMIC RISK LABORATORY REPORT",
    facilityName: "AL BATEEN PRIMARY CLINIC DIAGNOSTICS",
    facilitySubline: "Abu Dhabi, UAE · ISO 15189 / CAP Synthetic Lab Layout",
    emrSystem: "Epic Beaker · Malaffi HIE",
    licenseCode: "DoH-SYN-ALB02",
    accessionId: "ACC-2026-0918-5180",
    encounterId: "ENC-ALB-2026-2219",
    fhirReference: "Observation/obs-hba1c-2026-09",
    collectedAt: "18-Sep-2026 07:45 +04:00",
    receivedAt: "18-Sep-2026 08:10 +04:00",
    reportedAt: "18-Sep-2026 08:45 +04:00",
    specimenType: "Whole Blood (EDTA) + Fasting Fluoride Oxalate",
    orderingPhysician: "Dr. Ahmed Al-Mazrouei, MD (Family Medicine)",
    performingPhysician: "Dr. Hessa Al-Dhaheri, FRCPath (Clinical Pathology)",
    reportStatus: "FINAL",
    analytes: [
      {
        testName: "Hemoglobin A1c (NGSP)",
        loinc: "4548-4",
        value: "6.1",
        unit: "%",
        flag: "HIGH",
        referenceRange: "Normal < 5.7 | Prediabetes 5.7 – 6.4",
        method: "HPLC",
        highlight: true,
      },
      {
        testName: "Fasting Plasma Glucose",
        loinc: "1558-6",
        value: "112",
        unit: "mg/dL",
        flag: "HIGH",
        referenceRange: "70 – 99 mg/dL",
        method: "Hexokinase",
        highlight: true,
      },
      {
        testName: "Serum Creatinine",
        loinc: "2160-0",
        value: "0.68",
        unit: "mg/dL",
        flag: "NORMAL",
        referenceRange: "0.50 – 1.00",
        method: "Enzymatic",
      },
    ],
    clinicalNotes: [
      "INTERPRETATION: Preconception impaired fasting glucose (112 mg/dL) and elevated HbA1c (6.1%) indicating high risk for early gestational diabetes.",
      "CARE CONTINUITY NOTE: Escalate immediately for early 75g OGTT and medical nutrition therapy upon pregnancy confirmation (Rule RB-METABOLIC-v1.2.0).",
    ],
    signatureBlock: {
      signedBy: "Dr. Hessa Al-Dhaheri, MD, FRCPath",
      credentials: "Consultant Clinical Pathologist · Synthetic Laboratory Director",
      signedAt: "18-Sep-2026 08:45 +04:00",
      registryNote: "Electronically verified & published to Abu Dhabi Malaffi HIE (Synthetic Feed)",
    },
    searchTokens: "hba1c 6.1 fasting glucose 112 dysglycemia ogtt al bateen obl-201 4548-4",
  },
  {
    id: "DOC-FAT-02",
    linkedObligationId: "OBL-202",
    category: "serology",
    stageTag: "Preconception",
    dayTag: "Day 0",
    shortTitle: "Preconception Serology (VZV Non-Immune)",
    documentTitle: "PRENATAL IMMUNITY & VARICELLA SEROLOGY REPORT",
    facilityName: "AL BATEEN PRIMARY CLINIC DIAGNOSTICS",
    facilitySubline: "Reference Immunology Unit · Abu Dhabi, UAE",
    emrSystem: "Epic Beaker · Malaffi HIE",
    licenseCode: "DoH-SYN-ALB02",
    accessionId: "ACC-2026-0827-5182",
    encounterId: "ENC-ALB-2026-1904",
    fhirReference: "DiagnosticReport/rep-vzv-2026-08",
    collectedAt: "27-Aug-2026 09:30 +04:00",
    receivedAt: "27-Aug-2026 09:55 +04:00",
    reportedAt: "27-Aug-2026 10:20 +04:00",
    specimenType: "Serum (SST Gold Top)",
    orderingPhysician: "Dr. Ahmed Al-Mazrouei, MD (Family Medicine)",
    performingPhysician: "Dr. Khalid Al-Mazrouei, MD (Medical Microbiology)",
    reportStatus: "FINAL",
    analytes: [
      {
        testName: "Varicella-Zoster Virus (VZV) IgG",
        loinc: "15410-4",
        value: "82",
        unit: "mIU/mL",
        flag: "NON-IMMUNE",
        referenceRange: "< 100 Non-Immune | ≥ 150 Protective",
        method: "CLIA",
        highlight: true,
      },
      {
        testName: "Rubella Virus IgG Antibody",
        loinc: "25514-1",
        value: "48.2",
        unit: "IU/mL",
        flag: "NORMAL",
        referenceRange: "≥ 10.0 Immune",
        method: "CMIA",
      },
    ],
    clinicalNotes: [
      "INTERPRETATION: VZV IgG non-immune (82 mIU/mL). Live-attenuated Varicella vaccine is contraindicated during pregnancy; defer strictly to postpartum discharge if conception occurs first (Rule RB-IMMUNE-v1.2.1).",
    ],
    signatureBlock: {
      signedBy: "Dr. Khalid Al-Mazrouei, MD",
      credentials: "Consultant Microbiologist · Reference Virology Lab (Synthetic)",
      signedAt: "27-Aug-2026 10:20 +04:00",
      registryNote: "Transmitted via HL7 FHIR R4 DiagnosticReport to Malaffi HIE",
    },
    searchTokens: "varicella vzv igg non-immune 15410-4 serology al bateen obl-202",
  },
  {
    id: "DOC-FAT-03",
    linkedObligationId: "OBL-201",
    category: "ob_note",
    stageTag: "Antenatal",
    dayTag: "Day 98",
    shortTitle: "Antenatal Intake & Early Metabolic Escalation",
    documentTitle: "OBSTETRIC INTAKE & EARLY PREGNANCY CONFIRMATION SUMMARY",
    facilityName: "CORNICHE OB-GYN SPECIALIST CLINIC",
    facilitySubline: "Maternal-Fetal Medicine & Antenatal Care · Abu Dhabi, UAE",
    emrSystem: "Oracle Health (Cerner) · Malaffi HIE",
    licenseCode: "DoH-SYN-CRN108",
    accessionId: "US-CORN-2027-0109-51",
    encounterId: "ENC-CORN-2027-0109",
    fhirReference: "Condition/cond-pregnancy-fatima-2027",
    collectedAt: "09-Jan-2027 11:00 +04:00",
    receivedAt: "09-Jan-2027 11:15 +04:00",
    reportedAt: "09-Jan-2027 11:40 +04:00",
    specimenType: "Transvaginal Ultrasound + Serum β-hCG",
    orderingPhysician: "Dr. Noura Al-Ketbi, MD (Maternal Endocrinology / OB)",
    performingPhysician: "Dr. Layla Al-Hashimi, MD, FACOG (OB-GYN)",
    reportStatus: "VERIFIED",
    transferBanner:
      "CROSS-PROVIDER CONTINUITY: Registered at Corniche OB-GYN (Oracle Health) 98 days after preconception panel at Al Bateen Primary Clinic (Epic). Dysglycemia OBL-201 escalated; VZV OBL-202 deferred.",
    analytes: [
      {
        testName: "Crown-Rump Length (CRL)",
        loinc: "11957-8",
        value: "16.4",
        unit: "mm",
        flag: "POSITIVE",
        referenceRange: "8w 0d Gestation · Viable IUP",
        method: "Transvaginal US",
        highlight: true,
      },
    ],
    clinicalNotes: [
      "CARE-GAP RECONCILIATION: Preconception HbA1c 6.1% escalated for urgent early 75g OGTT; live VZV vaccine deferred to postpartum.",
    ],
    signatureBlock: {
      signedBy: "Dr. Layla Al-Hashimi, MD, FACOG",
      credentials: "Consultant Obstetrician & Gynecologist · Corniche OB-GYN (Synthetic)",
      signedAt: "09-Jan-2027 11:40 +04:00",
      registryNote: "Triggers deterministic event FHIR_PREGNANCY_CONFIRMED",
    },
    searchTokens: "corniche antenatal ultrasound crl 8w0d fatima obl-201 handoff",
  },
  {
    id: "DOC-FAT-04",
    linkedObligationId: "OBL-201",
    category: "lab",
    stageTag: "Antenatal",
    dayTag: "Day 105",
    shortTitle: "Antenatal 75g OGTT & Nutrition Care Plan",
    documentTitle: "ANTENATAL 75G ORAL GLUCOSE TOLERANCE TEST REPORT",
    facilityName: "CORNICHE OB-GYN · ENDOCRINE LAB",
    facilitySubline: "Malaffi HIE Connected Reference Lab · Abu Dhabi, UAE",
    emrSystem: "Oracle Health · Malaffi HIE",
    licenseCode: "DoH-SYN-CRN108",
    accessionId: "MAL-LAB-2026-91204",
    encounterId: "ENC-CORN-2027-0116",
    fhirReference: "Observation/EVD-OGTT-2026-10",
    collectedAt: "16-Jan-2027 08:00 +04:00",
    receivedAt: "16-Jan-2027 10:10 +04:00",
    reportedAt: "16-Jan-2027 11:05 +04:00",
    specimenType: "Plasma (Fasting, 1h, 2h 75g Glucose Load)",
    orderingPhysician: "Dr. Noura Al-Ketbi, MD (Maternal Endocrinology)",
    performingPhysician: "Dr. Hessa Al-Dhaheri, FRCPath",
    reportStatus: "VERIFIED",
    analytes: [
      {
        testName: "OGTT Fasting / 1h / 2h Glucose",
        loinc: "14749-6",
        value: "89 / 164 / 138",
        unit: "mg/dL",
        flag: "NORMALIZED",
        referenceRange: "IADPSG Targets < 92 / < 180 / < 153 mg/dL",
        method: "Hexokinase",
        highlight: true,
      },
    ],
    clinicalNotes: [
      "QUALIFYING CLOSURE EVIDENCE (OBL-201): Early antenatal 75g OGTT within targets; structured medical nutrition therapy & SMBG initiated.",
    ],
    signatureBlock: {
      signedBy: "Dr. Noura Al-Ketbi, MD",
      credentials: "Maternal Endocrinology · Linked to Evidence ID EVD-OGTT-2026-10",
      signedAt: "16-Jan-2027 11:05 +04:00",
      registryNote: "Qualifying evidence available in Neon Postgres for Clinician Verify & Close",
    },
    searchTokens: "75g ogtt 89 164 138 iadpsg corniche mal-lab-2026-91204 evd-ogtt obl-201",
  },
  {
    id: "DOC-FAT-05",
    linkedObligationId: "OBL-202",
    category: "immunization",
    stageTag: "Postpartum",
    dayTag: "Day 372",
    shortTitle: "Postpartum Discharge & Varicella Immunization",
    documentTitle: "POSTPARTUM DISCHARGE & VARICELLA IMMUNIZATION RECORD",
    facilityName: "CORNICHE MATERNITY WARD",
    facilitySubline: "Postpartum Inpatient Unit · Malaffi Immunization Registry Feed",
    emrSystem: "Inpatient EHR · Malaffi Registry",
    licenseCode: "DoH-SYN-MAT372",
    accessionId: "MAL-IMM-2026-60418",
    encounterId: "ENC-ADM-2027-0820",
    fhirReference: "Immunization/EVD-VZV-2026-11",
    collectedAt: "20-Aug-2027 10:15 +04:00",
    receivedAt: "20-Aug-2027 10:16 +04:00",
    reportedAt: "20-Aug-2027 10:30 +04:00",
    specimenType: "Subcutaneous Immunization · Pre-Discharge",
    orderingPhysician: "Dr. Mariam Al-Suwaidi, MD (Postpartum OB-GYN)",
    performingPhysician: "RN Fatima Al-Kaabi, BSN",
    reportStatus: "VERIFIED",
    analytes: [
      {
        testName: "Varicella Virus Live Vaccine (Dose 1)",
        loinc: "CVX 21",
        value: "0.5 mL SC",
        unit: "Right Deltoid",
        flag: "ADMINISTERED",
        referenceRange: "Lot #VZV-2026-AE · Dose 2 in 4–8w",
        method: "Subcutaneous Injection",
        highlight: true,
      },
    ],
    clinicalNotes: [
      "QUALIFYING CLOSURE EVIDENCE (OBL-202): Postpartum Varicella Dose 1 administered prior to discharge (#MAL-IMM-2026-60418).",
    ],
    signatureBlock: {
      signedBy: "Dr. Mariam Al-Suwaidi, MD",
      credentials: "Postpartum OB-GYN · Linked to Evidence ID EVD-VZV-2026-11",
      signedAt: "20-Aug-2027 10:30 +04:00",
      registryNote: "Recorded in Malaffi Immunization Registry (Synthetic Demonstration Record)",
    },
    searchTokens: "postpartum varicella vzv cvx 21 mal-imm-2026-60418 evd-vzv obl-202",
  },
];

const SARA_CLINICAL_DOCUMENTS: ClinicalDocument[] = [
  {
    id: "DOC-SAR-01",
    linkedObligationId: "OBL-301",
    category: "ob_note",
    stageTag: "Preconception",
    dayTag: "Day 0",
    shortTitle: "Preconception BP & Preeclampsia Risk Intake",
    documentTitle: "PRECONCEPTION HYPERTENSION & OBSTETRIC RISK ASSESSMENT",
    facilityName: "KHALIFA CITY FAMILY MEDICINE CLINIC",
    facilitySubline: "Abu Dhabi, UAE · Ambulatory Care Continuity Feed",
    emrSystem: "Epic Ambulatory · Malaffi HIE",
    licenseCode: "DoH-SYN-KCF03",
    accessionId: "ACC-2026-0921-6304",
    encounterId: "ENC-KCF-2026-3102",
    fhirReference: "Observation/obs-bp-2026-09",
    collectedAt: "21-Sep-2026 10:45 +04:00",
    receivedAt: "21-Sep-2026 10:55 +04:00",
    reportedAt: "21-Sep-2026 11:10 +04:00",
    specimenType: "Automated Oscillometric BP (Seated · Mean of 2)",
    orderingPhysician: "Dr. Omar Al-Mansoori, MD (Family Medicine)",
    performingPhysician: "Dr. Omar Al-Mansoori, MD",
    reportStatus: "FINAL",
    analytes: [
      {
        testName: "Systolic / Diastolic Blood Pressure",
        loinc: "85354-9",
        value: "138 / 88",
        unit: "mmHg",
        flag: "HIGH",
        referenceRange: "< 120 / 80 mmHg · Prior Preterm Preeclampsia",
        method: "Seated Oscillometric",
        highlight: true,
      },
      {
        testName: "Urine Albumin-to-Creatinine Ratio",
        loinc: "14959-1",
        value: "14",
        unit: "mg/g",
        flag: "NORMAL",
        referenceRange: "< 30 mg/g",
        method: "Immunoturbidimetric",
      },
    ],
    clinicalNotes: [
      "TIME-SENSITIVE PREVENTION WINDOW: Elevated preconception BP (138/88 mmHg) + prior preeclampsia history requires low-dose aspirin (150 mg nightly) starting between 12 and 16 weeks gestation (Rule RB-PREECLAMPSIA-v1.3.0).",
    ],
    signatureBlock: {
      signedBy: "Dr. Omar Al-Mansoori, MD",
      credentials: "Family Medicine · Khalifa City Clinic (Synthetic)",
      signedAt: "21-Sep-2026 11:10 +04:00",
      registryNote: "Published via HL7 FHIR R4 Observation to Malaffi HIE",
    },
    searchTokens: "preeclampsia aspirin blood pressure 138/88 khalifa city obl-301 85354-9",
  },
  {
    id: "DOC-SAR-02",
    linkedObligationId: "OBL-302",
    category: "immunization",
    stageTag: "Preconception",
    dayTag: "Day 0",
    shortTitle: "Preconception Immunization Gap (HPV Dose 2/3)",
    documentTitle: "ADULT PREVENTIVE IMMUNIZATION FORECAST REPORT",
    facilityName: "KHALIFA CITY FAMILY MEDICINE CLINIC",
    facilitySubline: "Malaffi Immunization Registry Sync · Abu Dhabi, UAE",
    emrSystem: "Epic · Malaffi Registry",
    licenseCode: "DoH-SYN-KCF03",
    accessionId: "ACC-2026-0829-6305",
    encounterId: "ENC-KCF-2026-2884",
    fhirReference: "ImmunizationRecommendation/rec-hpv-2026-08",
    collectedAt: "29-Aug-2026 08:40 +04:00",
    receivedAt: "29-Aug-2026 08:50 +04:00",
    reportedAt: "29-Aug-2026 09:00 +04:00",
    specimenType: "Registry Immunization Forecast",
    orderingPhysician: "Dr. Omar Al-Mansoori, MD",
    performingPhysician: "RN Salma Al-Dhaheri, BSN",
    reportStatus: "FINAL",
    analytes: [
      {
        testName: "HPV 9-Valent Series Status",
        loinc: "CVX 165",
        value: "1 of 3 Doses Complete",
        unit: "Dose 2 Overdue",
        flag: "NON-IMMUNE",
        referenceRange: "Defer during pregnancy; complete postpartum",
        method: "Registry Audit",
        highlight: true,
      },
    ],
    clinicalNotes: [
      "CLINICAL GUIDANCE: HPV vaccination is not recommended during pregnancy; preserve incomplete Dose 2/3 obligation across antenatal care and reactivate postpartum (Rule RB-HPV-v1.1.0).",
    ],
    signatureBlock: {
      signedBy: "Dr. Omar Al-Mansoori, MD",
      credentials: "Family Medicine · Malaffi Immunization Sync",
      signedAt: "29-Aug-2026 09:00 +04:00",
      registryNote: "Synchronized to ReproBridge Obligation Passport",
    },
    searchTokens: "hpv 9-valent cvx 165 dose 2 incomplete khalifa city obl-302",
  },
  {
    id: "DOC-SAR-03",
    linkedObligationId: "OBL-301",
    category: "ob_note",
    stageTag: "Antenatal",
    dayTag: "Day 112",
    shortTitle: "Antenatal Dating Scan & 12w Aspirin Window",
    documentTitle: "FIRST-TRIMESTER MATERNAL-FETAL MEDICINE CONSULTATION",
    facilityName: "DANAT AL EMARAT MATERNITY HOSPITAL",
    facilitySubline: "MFM & High-Risk Obstetrics · Abu Dhabi, UAE",
    emrSystem: "Oracle Health · Malaffi HIE",
    licenseCode: "DoH-SYN-DAE09",
    accessionId: "US-DAE-2027-0122-63",
    encounterId: "ENC-DAE-2027-0122",
    fhirReference: "Condition/cond-pregnancy-sara-2027",
    collectedAt: "22-Jan-2027 09:15 +04:00",
    receivedAt: "22-Jan-2027 09:30 +04:00",
    reportedAt: "22-Jan-2027 10:00 +04:00",
    specimenType: "First-Trimester Ultrasound + BP Check",
    orderingPhysician: "Dr. Layla Al-Hashimi, MD, FACOG (MFM / OB-GYN)",
    performingPhysician: "Dr. Layla Al-Hashimi, MD, FACOG",
    reportStatus: "VERIFIED",
    transferBanner:
      "CROSS-PROVIDER CONTINUITY: Registered at Danat Al Emarat (Oracle Health) 112 days after Khalifa City Family Medicine intake (Epic). 12–16w low-dose aspirin window flagged URGENT; HPV Dose 2 deferred.",
    analytes: [
      {
        testName: "Crown-Rump Length (CRL)",
        loinc: "11957-8",
        value: "56.0",
        unit: "mm",
        flag: "POSITIVE",
        referenceRange: "12w 1d Gestation · Aspirin Window Open",
        method: "Transabdominal US",
        highlight: true,
      },
    ],
    clinicalNotes: [
      "CARE-GAP RECONCILIATION: Patient enters 12–16w preeclampsia prophylaxis window today; low-dose aspirin 150 mg nightly ordered.",
    ],
    signatureBlock: {
      signedBy: "Dr. Layla Al-Hashimi, MD, FACOG",
      credentials: "MFM / OB-GYN · Danat Al Emarat (Synthetic)",
      signedAt: "22-Jan-2027 10:00 +04:00",
      registryNote: "Triggers deterministic event FHIR_PREGNANCY_CONFIRMED",
    },
    searchTokens: "danat al emarat mfm 12w1d aspirin window sara obl-301 handoff",
  },
  {
    id: "DOC-SAR-04",
    linkedObligationId: "OBL-301",
    category: "lab",
    stageTag: "Antenatal",
    dayTag: "Day 115",
    shortTitle: "Aspirin 150 mg Prophylaxis & BP Stabilization",
    documentTitle: "ANTENATAL PREECLAMPSIA PROPHYLAXIS VERIFICATION",
    facilityName: "DANAT AL EMARAT MATERNITY HOSPITAL",
    facilitySubline: "MFM Hypertension Clinic · Abu Dhabi, UAE",
    emrSystem: "Oracle Health · Malaffi e-Rx",
    licenseCode: "DoH-SYN-DAE09",
    accessionId: "MAL-RX-2026-77310",
    encounterId: "ENC-DAE-2027-0125",
    fhirReference: "MedicationRequest/EVD-ASA-2026-10",
    collectedAt: "25-Jan-2027 09:00 +04:00",
    receivedAt: "25-Jan-2027 09:10 +04:00",
    reportedAt: "25-Jan-2027 09:20 +04:00",
    specimenType: "Clinic BP + Pharmacy Dispense Verification",
    orderingPhysician: "Dr. Layla Al-Hashimi, MD, FACOG (MFM / OB-GYN)",
    performingPhysician: "Dr. Layla Al-Hashimi, MD, FACOG",
    reportStatus: "VERIFIED",
    analytes: [
      {
        testName: "Repeat Antenatal Blood Pressure",
        loinc: "85354-9",
        value: "124 / 78",
        unit: "mmHg",
        flag: "NORMALIZED",
        referenceRange: "Target < 135 / 85 mmHg",
        method: "Seated Oscillometric",
        priorDelta: "Prior 138/88",
        highlight: true,
      },
    ],
    rxOrder: {
      medication: "Aspirin 150 mg Enteric-Coated Oral Tablet",
      sig: "Take 1 tablet by mouth nightly at bedtime through 36 weeks gestation.",
      prescriber: "Dr. Layla Al-Hashimi, MD, FACOG",
      dispenseStatus: "Active & Dispensed · Malaffi e-Rx #MAL-RX-2026-77310",
    },
    clinicalNotes: [
      "QUALIFYING CLOSURE EVIDENCE (OBL-301): Aspirin 150 mg prophylaxis initiated at 12w4d within the 12–16w prophylaxis window; BP improved to 124/78 mmHg.",
    ],
    signatureBlock: {
      signedBy: "Dr. Layla Al-Hashimi, MD, FACOG",
      credentials: "MFM / OB-GYN · Linked to Evidence ID EVD-ASA-2026-10",
      signedAt: "25-Jan-2027 09:20 +04:00",
      registryNote: "Qualifying evidence available in Neon Postgres for Clinician Verify & Close",
    },
    searchTokens: "aspirin 150 mg preeclampsia 124/78 mal-rx-2026-77310 evd-asa obl-301",
  },
  {
    id: "DOC-SAR-05",
    linkedObligationId: "OBL-302",
    category: "immunization",
    stageTag: "Postpartum",
    dayTag: "Day 386",
    shortTitle: "Postpartum HPV 9-Valent Dose 2 Record",
    documentTitle: "POSTPARTUM DISCHARGE & HPV SERIES CONTINUATION RECORD",
    facilityName: "DANAT AL EMARAT POSTPARTUM CLINIC",
    facilitySubline: "Postpartum Unit · Malaffi Immunization Registry Feed",
    emrSystem: "Inpatient EHR · Malaffi Registry",
    licenseCode: "DoH-SYN-DAE09",
    accessionId: "MAL-IMM-2026-71892",
    encounterId: "ENC-DAE-2027-0902",
    fhirReference: "Immunization/EVD-HPV-2026-11",
    collectedAt: "02-Sep-2027 11:05 +04:00",
    receivedAt: "02-Sep-2027 11:06 +04:00",
    reportedAt: "02-Sep-2027 11:15 +04:00",
    specimenType: "Intramuscular Immunization · Pre-Discharge",
    orderingPhysician: "Dr. Mariam Al-Suwaidi, MD (Postpartum OB-GYN)",
    performingPhysician: "RN Salma Al-Dhaheri, BSN",
    reportStatus: "VERIFIED",
    analytes: [
      {
        testName: "HPV 9-Valent Recombinant Vaccine (Dose 2/3)",
        loinc: "CVX 165",
        value: "0.5 mL IM",
        unit: "Left Deltoid",
        flag: "ADMINISTERED",
        referenceRange: "Lot #HPV-2026-AE · Dose 3 in 4 mo",
        method: "Intramuscular Injection",
        highlight: true,
      },
    ],
    clinicalNotes: [
      "QUALIFYING CLOSURE EVIDENCE (OBL-302): Postpartum HPV 9-valent Dose 2 administered prior to discharge (#MAL-IMM-2026-71892).",
    ],
    signatureBlock: {
      signedBy: "Dr. Mariam Al-Suwaidi, MD",
      credentials: "Postpartum OB-GYN · Linked to Evidence ID EVD-HPV-2026-11",
      signedAt: "02-Sep-2027 11:15 +04:00",
      registryNote: "Recorded in Malaffi Immunization Registry (Synthetic Demonstration Record)",
    },
    searchTokens: "postpartum hpv cvx 165 dose 2 mal-imm-2026-71892 evd-hpv obl-302",
  },
];

const PATIENT_DOC_PACKS: Record<string, ClinicalDocument[]> = {
  "PAT-AE-4092": BASE_CLINICAL_DOCUMENTS,
  "PAT-AE-5180": FATIMA_CLINICAL_DOCUMENTS,
  "PAT-AE-6304": SARA_CLINICAL_DOCUMENTS,
};

const PATIENT_DEMOGRAPHICS: Record<string, { dobSex: string; emiratesId: string }> = {
  "PAT-AE-4092": { dobSex: "14-Mar-1994 (32Y · F)", emiratesId: "784-1994-0004092-7 (SYN)" },
  "PAT-AE-5180": { dobSex: "08-Nov-1997 (29Y · F)", emiratesId: "784-1997-0005180-3 (SYN)" },
  "PAT-AE-6304": { dobSex: "21-Jun-1990 (36Y · F)", emiratesId: "784-1990-0006304-9 (SYN)" },
};

const SEEDED_DOC_OBLIGATION_IDS = new Set([
  "OBL-101",
  "OBL-102",
  "OBL-201",
  "OBL-202",
  "OBL-301",
  "OBL-302",
]);

function getStageRank(stage: string): number {
  const lowered = stage.toLowerCase();
  if (lowered.includes("postpartum")) return 2;
  if (lowered.includes("antenatal") || lowered.includes("pregnan")) return 1;
  return 0;
}

function getDocStageRank(stageTag: ClinicalDocument["stageTag"]): number {
  if (stageTag === "Postpartum") return 2;
  if (stageTag === "Antenatal") return 1;
  return 0;
}

function flagBadgeStyle(flag?: AnalyteRow["flag"]): string {
  switch (flag) {
    case "HIGH":
    case "NON-IMMUNE":
      return "border-rose-300 bg-rose-50 text-rose-800";
    case "POSITIVE":
      return "border-amber-300 bg-amber-50 text-amber-900";
    case "NORMALIZED":
    case "ADMINISTERED":
      return "border-emerald-300 bg-emerald-50 text-emerald-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function CategoryIcon({ category }: { category: DocCategory }) {
  switch (category) {
    case "lab":
      return <FlaskConical className="h-3.5 w-3.5 shrink-0 text-teal-700" aria-hidden="true" />;
    case "serology":
      return <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-indigo-700" aria-hidden="true" />;
    case "ob_note":
      return <Stethoscope className="h-3.5 w-3.5 shrink-0 text-sky-700" aria-hidden="true" />;
    case "immunization":
      return <Syringe className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />;
    default:
      return <FileText className="h-3.5 w-3.5 shrink-0 text-slate-600" aria-hidden="true" />;
  }
}

export function getDefaultDocIdForObligation(obligationId: string): string {
  if (obligationId === "OBL-101") return "DOC-LAB-01";
  if (obligationId === "OBL-102") return "DOC-SER-02";
  if (obligationId === "OBL-201") return "DOC-FAT-01";
  if (obligationId === "OBL-202") return "DOC-FAT-02";
  if (obligationId === "OBL-301") return "DOC-SAR-01";
  if (obligationId === "OBL-302") return "DOC-SAR-02";
  return `DOC-IMP-${obligationId}`;
}

export default function ClinicalDocumentsDrawer({
  isOpen,
  onClose,
  initialDocId,
  currentLifeStage,
  obligations,
  patientId: propPatientId,
  clinicianLabel = "Dr. Layla Al-Hashimi, MD (OB-GYN)",
  side = "right",
  drawerWidth: propDrawerWidth,
  onDrawerWidthChange,
}: ClinicalDocumentsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const tableCaptionId = useId();
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    lastWidth: number;
  } | null>(null);

  const activePatientId = propPatientId ?? obligations[0]?.patient_id ?? "PAT-AE-4092";
  const patientPack = PATIENT_DOC_PACKS[activePatientId] ?? BASE_CLINICAL_DOCUMENTS;

  const [width, setWidth] = useState<number>(() =>
    clampDrawerWidth(propDrawerWidth ?? readDocsSessionPrefs().drawerWidth)
  );
  const [isResizing, setIsResizing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<"ALL" | "Preconception" | "Antenatal" | "Postpartum">("ALL");
  const [selectedDocId, setSelectedDocId] = useState<string>(patientPack[0]?.id ?? "DOC-LAB-01");

  useEffect(() => {
    if (typeof propDrawerWidth === "number" && !resizeRef.current) {
      setWidth(clampDrawerWidth(propDrawerWidth));
    }
  }, [propDrawerWidth]);

  useEffect(() => {
    const onResize = () => {
      if (!resizeRef.current) {
        setWidth((prev) => clampDrawerWidth(prev));
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Reset selected doc when switching active patient unless initialDocId was targeted
  useEffect(() => {
    if (!initialDocId && patientPack[0]) {
      setSelectedDocId(patientPack[0].id);
      setStageFilter("ALL");
      setSearchQuery("");
    }
  }, [activePatientId, initialDocId, patientPack]);

  // Dynamically include synthetic clinical reference sheets for any newly imported obligations
  const documents = useMemo<ClinicalDocument[]>(() => {
    const importedDocs: ClinicalDocument[] = obligations
      .filter((o) => !SEEDED_DOC_OBLIGATION_IDS.has(o.id))
      .map((o) => ({
        id: `DOC-IMP-${o.id}`,
        linkedObligationId: o.id,
        category: "imported",
        stageTag: o.life_stage.toLowerCase().includes("postpartum")
          ? "Postpartum"
          : o.life_stage.toLowerCase().includes("antenatal")
            ? "Antenatal"
            : "Preconception",
        dayTag: "Imported",
        shortTitle: o.title,
        documentTitle: "IMPORTED CLINICAL FINDING & LABORATORY REFERENCE SHEET",
        facilityName: "MALAFFI HIE · EXTERNAL FACILITY INTAKE",
        facilitySubline: `${o.evidence_source} · Synthetic Clinical Document`,
        emrSystem: "FHIR R4 / CSV Intake",
        licenseCode: "DoH-SYN-IMP01",
        accessionId: `ACC-IMP-${o.id}`,
        encounterId: `ENC-${o.id}`,
        fhirReference: o.evidence_source,
        collectedAt: "Synthetic Intake Timestamp",
        receivedAt: "Synthetic Intake Timestamp",
        reportedAt: "Current Demo Session",
        specimenType: "Clinical Observation / Intake Record",
        orderingPhysician: o.owner,
        performingPhysician: clinicianLabel,
        reportStatus: "FINAL",
        analytes: [
          {
            testName: o.title,
            loinc: o.rule_version,
            value: o.priority,
            unit: o.status,
            flag: o.priority === "URGENT" || o.priority === "HIGH" ? "HIGH" : "POSITIVE",
            referenceRange: "Clinician review required",
            method: "Imported Record",
            highlight: true,
          },
        ],
        clinicalNotes: [
          `CLINICAL RATIONALE: ${o.rationale}`,
          ...(o.closure_evidence
            ? [`VERIFIED CLOSURE (${o.verified_by ?? "Clinician"}): ${o.closure_evidence}`]
            : []),
        ],
        signatureBlock: {
          signedBy: o.verified_by ?? clinicianLabel,
          credentials: `${o.owner} · Synthetic Intake Record`,
          signedAt: "Current Session",
          registryNote: "Stored locally inside UAE boundary; excluded from external AI calls.",
        },
        searchTokens: `${o.id} ${o.title} ${o.rationale} ${o.evidence_source} ${o.owner}`.toLowerCase(),
      }));

    return [...patientPack, ...importedDocs];
  }, [patientPack, obligations, clinicianLabel]);

  // Sync selected document when opened via a specific obligation link
  useEffect(() => {
    if (isOpen && initialDocId) {
      const exists = documents.some((d) => d.id === initialDocId);
      if (exists) {
        setSelectedDocId(initialDocId);
        setStageFilter("ALL");
        setSearchQuery("");
      }
    }
  }, [isOpen, initialDocId, documents]);

  // Native <dialog> open/close lifecycle + top-layer exit animation & Safari light-dismiss fallback
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.removeAttribute("data-closing");
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      void closeDialogWithAnimation(dialog);
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };

    const handleCancel = (event: Event) => {
      event.preventDefault();
      void closeDialogWithAnimation(dialog);
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);

    // Safari fallback for `closedby="any"` light-dismiss using pointerdown + pointerup rect check
    let cleanupLightDismiss: (() => void) | undefined;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = isOutside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && isOutside(e)) {
          void closeDialogWithAnimation(dialog);
        }
        pressedOutside = false;
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      cleanupLightDismiss = () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
      cleanupLightDismiss?.();
    };
  }, [onClose]);

  const filteredDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (stageFilter !== "ALL" && doc.stageTag !== stageFilter) return false;
      if (!q) return true;
      return (
        doc.searchTokens.includes(q) ||
        doc.documentTitle.toLowerCase().includes(q) ||
        doc.shortTitle.toLowerCase().includes(q) ||
        doc.facilityName.toLowerCase().includes(q) ||
        doc.accessionId.toLowerCase().includes(q)
      );
    });
  }, [documents, searchQuery, stageFilter]);

  const activeDoc =
    filteredDocs.find((d) => d.id === selectedDocId) ??
    documents.find((d) => d.id === selectedDocId) ??
    filteredDocs[0] ??
    documents[0];

  const currentStageRank = getStageRank(currentLifeStage);
  const patientName = obligations[0]?.patient_name ?? "Amina Al-Mansoori (Synthetic)";
  const patientId = activePatientId;
  const demographics = PATIENT_DEMOGRAPHICS[patientId] ?? {
    dobSex: "14-Mar-1994 (32Y · F)",
    emiratesId: "784-1994-0004092-7 (SYN)",
  };
  const linkedObligation = activeDoc?.linkedObligationId
    ? obligations.find((o) => o.id === activeDoc.linkedObligationId) ?? null
    : null;

  function handlePrintDocument() {
    document.body.classList.add("rb-printing-doc");
    const cleanup = () => {
      document.body.classList.remove("rb-printing-doc");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    // Fallback cleanup in case afterprint doesn't fire in some headless/embedded views
    window.setTimeout(() => {
      document.body.classList.remove("rb-printing-doc");
    }, 1500);
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startWidth: width,
      lastWidth: width,
    };
    setIsResizing(true);
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events where pointer capture is unavailable
    }
  }

  function handleResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const session = resizeRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    const dx = e.clientX - session.startX;
    const nextWidth = clampDrawerWidth(
      side === "left" ? session.startWidth + dx : session.startWidth - dx
    );
    session.lastWidth = nextWidth;
    setWidth(nextWidth);
  }

  function finishResize(e: React.PointerEvent<HTMLDivElement>) {
    const session = resizeRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    resizeRef.current = null;
    setIsResizing(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic events where pointer capture was not held
    }
    const finalWidth = clampDrawerWidth(session.lastWidth);
    writeDocsSessionPrefs({ drawerWidth: finalWidth });
    onDrawerWidthChange?.(finalWidth);
  }

  function handleResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = 32;
    let nextWidth: number | null = null;
    if (e.key === "ArrowLeft") {
      nextWidth = clampDrawerWidth(side === "left" ? width - step : width + step);
    } else if (e.key === "ArrowRight") {
      nextWidth = clampDrawerWidth(side === "left" ? width + step : width - step);
    }
    if (nextWidth !== null) {
      e.preventDefault();
      setWidth(nextWidth);
      writeDocsSessionPrefs({ drawerWidth: nextWidth });
      onDrawerWidthChange?.(nextWidth);
    }
  }

  function handleResizeDoubleClick() {
    const resetWidth = clampDrawerWidth(DEFAULT_DRAWER_WIDTH);
    setWidth(resetWidth);
    writeDocsSessionPrefs({ drawerWidth: resetWidth });
    onDrawerWidthChange?.(resetWidth);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-side={side}
      data-resizing={isResizing ? "true" : "false"}
      style={{ "--rb-drawer-width": `${width}px` } as CSSProperties}
      className="rb-doc-drawer"
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div className="relative flex h-full flex-col overflow-hidden bg-slate-100 text-slate-900 shadow-2xl">
        {/* Draggable Width Resize Handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          tabIndex={0}
          aria-label="Resize Clinical Documents drawer width"
          aria-valuemin={MIN_DRAWER_WIDTH}
          aria-valuemax={getMaxDrawerWidth()}
          aria-valuenow={width}
          title="Drag edge to resize width · Double-click to reset"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={finishResize}
          onPointerCancel={finishResize}
          onKeyDown={handleResizeKeyDown}
          onDoubleClick={handleResizeDoubleClick}
          className={`group absolute inset-y-0 z-20 flex w-2.5 touch-none cursor-ew-resize items-center justify-center focus:outline-none focus-visible:bg-teal-500/20 ${
            side === "left" ? "right-0" : "left-0"
          }`}
        >
          <span
            aria-hidden="true"
            className={`h-12 w-1 rounded-full transition-colors ${
              isResizing
                ? "bg-teal-600"
                : "bg-slate-300/80 group-hover:bg-teal-500 group-focus-visible:bg-teal-600"
            }`}
          />
        </div>

        {/* Top Clinician Viewer Bar */}
        <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className="text-sm font-semibold text-slate-900">
                  Clinical Source Documents
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-800">
                  <EyeOff className="h-3 w-3" aria-hidden="true" />
                  Clinician Reference Only · Excluded from AI
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  Synthetic Demo Records
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Viewing as <span className="font-medium text-slate-700">{clinicianLabel}</span> ·
                Raw HIE/EMR reports stay inside the UAE local boundary and are never sent to OpenRouter.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePrintDocument}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                Print / Save PDF
              </button>
              <button
                type="button"
                onClick={() => {
                  if (dialogRef.current) void closeDialogWithAnimation(dialogRef.current);
                }}
                aria-label="Close Clinical Documents panel"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Close
              </button>
            </div>
          </div>
        </header>

        {/* Main 2-Pane Document Workspace */}
        <div
          className={`grid min-h-0 flex-1 ${
            width >= 760 ? "grid-cols-[310px_minmax(0,1fr)]" : "grid-cols-1"
          }`}
        >
          {/* Left Rail: Search + Filter + Document List */}
          <aside
            className={`flex min-h-0 flex-col bg-slate-50 ${
              width >= 760 ? "border-r border-slate-200" : "border-b border-slate-200"
            }`}
          >
            <div className="shrink-0 space-y-2.5 border-b border-slate-200 bg-white p-3.5">
              <label className="relative block">
                <span className="sr-only">Search clinical documents by lab, LOINC, or facility</span>
                <Search
                  className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search TSH, Rubella, LOINC, Corniche..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:outline-none"
                />
              </label>

              <div
                role="tablist"
                aria-label="Filter clinical documents by care stage"
                onKeyDown={(e) =>
                  handleSpatialKeyDown(e, '[role="tab"]', (next) => {
                    const st = next.dataset.stage as typeof stageFilter | undefined;
                    if (st) setStageFilter(st);
                  })
                }
                className="flex flex-wrap gap-1"
              >
                {(["ALL", "Preconception", "Antenatal", "Postpartum"] as const).map((stage) => {
                  const active = stageFilter === stage;
                  return (
                    <button
                      key={stage}
                      type="button"
                      role="tab"
                      data-stage={stage}
                      aria-selected={active}
                      tabIndex={active ? 0 : -1}
                      onClick={() => setStageFilter(stage)}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        active
                          ? "bg-teal-600 text-white shadow-2xs"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}
                    >
                      {stage === "ALL" ? `All (${documents.length})` : stage}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              {filteredDocs.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-center text-xs text-slate-500">
                  No synthetic documents match “{searchQuery}”.
                </p>
              ) : (
                <ul className="space-y-1.5" aria-label="Patient clinical documents">
                  {filteredDocs.map((doc) => {
                    const isSelected = doc.id === activeDoc?.id;
                    const docStageRank = getDocStageRank(doc.stageTag);
                    const isStageReached = docStageRank <= currentStageRank;

                    return (
                      <li key={doc.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedDocId(doc.id)}
                          aria-current={isSelected ? "true" : undefined}
                          className={`w-full rounded-lg border p-2.5 text-left transition ${
                            isSelected
                              ? "border-teal-500 bg-white ring-2 ring-teal-500/15"
                              : "border-slate-200/80 bg-white/70 hover:border-slate-300 hover:bg-white"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold text-slate-500">
                              <CategoryIcon category={doc.category} />
                              {doc.id}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                isStageReached
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {isStageReached ? `${doc.dayTag} · Active` : `${doc.dayTag} · Preview`}
                            </span>
                          </div>
                          <p className="mt-1 text-xs font-semibold leading-snug text-slate-900">
                            {doc.shortTitle}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                            <span className="inline-flex items-center gap-1 truncate">
                              <Building2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                              {doc.emrSystem}
                            </span>
                            {doc.linkedObligationId && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-medium text-slate-700">
                                {doc.linkedObligationId}
                              </span>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-200 bg-white px-3.5 py-2.5 text-[11px] text-slate-500">
              <div className="flex items-center gap-1.5 font-medium text-slate-700">
                <Lock className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                Zero-AI Document Isolation
              </div>
              <p className="mt-0.5 leading-relaxed">
                Documents render locally for clinician verification only. No PDF or report text is
                sent to external LLM endpoints.
              </p>
            </div>
          </aside>

          {/* Right Canvas: Hyper-Realistic Clinical Document Sheet */}
          <section className="min-h-0 overflow-y-auto p-4 sm:p-6">
            {activeDoc && (
              <article className="rb-doc-paper rb-doc-printable mx-auto max-w-3xl overflow-hidden rounded-lg border border-slate-300 shadow-md">
                {/* Top Synthetic Banner Strip */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-5 py-2 text-[10px] font-medium tracking-wider text-slate-200">
                  <span className="uppercase">
                    SYNTHETIC DEMONSTRATION RECORD · NOT A REAL CLINICAL DOCUMENT
                  </span>
                  <span className="font-mono text-teal-300">
                    {activeDoc.licenseCode} · {activeDoc.reportStatus} REPORT
                  </span>
                </div>

                <div className="relative p-5 sm:p-7">
                  {/* Subtle Watermark Stamp */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.045]"
                  >
                    <span className="-rotate-24 whitespace-nowrap font-mono text-4xl font-black tracking-[0.25em] text-slate-900 sm:text-5xl">
                      SYNTHETIC DEMO
                    </span>
                  </div>

                  {/* Facility Header & Barcode */}
                  <div className="relative flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-4">
                    <div>
                      <p className="text-[11px] font-bold tracking-widest text-teal-800">
                        {activeDoc.facilityName}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {activeDoc.facilitySubline}
                      </p>
                      <h3 className="mt-2 font-serif text-base font-bold tracking-tight text-slate-950 sm:text-lg">
                        {activeDoc.documentTitle}
                      </h3>
                    </div>

                    <AccessionBarcode value={activeDoc.accessionId} />
                  </div>

                  {/* Two-Column Patient & Specimen Metadata Block */}
                  <div className="relative mt-4 grid gap-3 rounded border border-slate-300 bg-slate-50/90 p-3.5 text-[11px] sm:grid-cols-2">
                    <dl className="space-y-1">
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">Patient Name</dt>
                        <dd className="text-right font-semibold text-slate-900">{patientName}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">MRN / Patient ID</dt>
                        <dd className="font-mono text-slate-900">{patientId}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">DOB / Sex</dt>
                        <dd className="text-slate-800">{demographics.dobSex}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">Emirates ID</dt>
                        <dd className="font-mono text-slate-700">{demographics.emiratesId}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">Encounter / Source</dt>
                        <dd className="font-mono text-slate-700">{activeDoc.encounterId}</dd>
                      </div>
                    </dl>

                    <dl className="space-y-1 border-t border-slate-200 pt-2 sm:border-l sm:border-t-0 sm:pl-3.5 sm:pt-0">
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">Ordering MD</dt>
                        <dd className="text-right font-medium text-slate-900">
                          {activeDoc.orderingPhysician}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">Specimen</dt>
                        <dd className="text-right text-slate-800">{activeDoc.specimenType}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">Collected</dt>
                        <dd className="font-mono text-slate-800">{activeDoc.collectedAt}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">Reported</dt>
                        <dd className="font-mono text-slate-800">{activeDoc.reportedAt}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="font-semibold uppercase text-slate-500">FHIR Resource</dt>
                        <dd className="font-mono text-teal-800">{activeDoc.fhirReference}</dd>
                      </div>
                    </dl>
                  </div>

                  {/* Cross-Provider Continuity Callout (when applicable) */}
                  {activeDoc.transferBanner && (
                    <div className="relative mt-3.5 rounded border-l-4 border-teal-600 bg-teal-50/80 px-3.5 py-2.5 text-xs text-teal-950">
                      {activeDoc.transferBanner}
                    </div>
                  )}

                  {/* Linked Obligation Status Strip */}
                  {linkedObligation && (
                    <div className="relative mt-3.5 flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-[11px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-500">Linked Passport Entry:</span>
                        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                          {linkedObligation.id}
                        </span>
                        <span className="font-medium text-slate-800">
                          {linkedObligation.rule_version}
                        </span>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          linkedObligation.status === "VERIFIED_CLOSED"
                            ? "bg-emerald-100 text-emerald-800"
                            : linkedObligation.status === "ESCALATED_FOR_REVIEW"
                              ? "bg-rose-100 text-rose-800"
                              : linkedObligation.status === "DEFERRED_TO_POSTPARTUM"
                                ? "bg-indigo-100 text-indigo-800"
                                : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {linkedObligation.status}
                      </span>
                    </div>
                  )}

                  {/* Responsive Clinical Results Table */}
                  <div className="relative mt-4">
                    <div
                      tabIndex={0}
                      role="region"
                      aria-labelledby={tableCaptionId}
                      className="rb-doc-table-wrap rounded border border-slate-300 bg-white"
                    >
                      <table className="rb-doc-table text-xs">
                        <caption
                          id={tableCaptionId}
                          className="border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-slate-700"
                        >
                          Reported Findings & Reference Intervals ({activeDoc.emrSystem})
                        </caption>
                        <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                          <tr>
                            <th scope="col" className="border-b border-slate-300 px-3 py-2 text-left">
                              Test / Observation
                            </th>
                            <th scope="col" className="border-b border-slate-300 px-3 py-2 text-left">
                              Result
                            </th>
                            <th scope="col" className="border-b border-slate-300 px-3 py-2 text-left">
                              Flag
                            </th>
                            <th scope="col" className="border-b border-slate-300 px-3 py-2 text-left">
                              Reference Interval
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {activeDoc.analytes.map((row) => (
                            <tr
                              key={row.testName}
                              className={row.highlight ? "bg-amber-50/70" : "bg-white"}
                            >
                              <th
                                scope="row"
                                className={`px-3 py-2.5 font-semibold text-slate-900 ${
                                  row.highlight ? "bg-amber-50/90" : "bg-white"
                                }`}
                              >
                                <div>{row.testName}</div>
                                <div className="mt-0.5 font-mono text-[10px] font-normal text-slate-500">
                                  {row.loinc}
                                  {row.method ? ` · ${row.method}` : ""}
                                </div>
                              </th>
                              <td data-label="Result" className="px-3 py-2.5 font-mono text-slate-900">
                                <span className={row.highlight ? "font-bold text-slate-950" : ""}>
                                  {row.value}
                                </span>{" "}
                                <span className="text-[11px] text-slate-500">{row.unit}</span>
                                {row.priorDelta && (
                                  <div className="mt-0.5 text-[10px] font-medium text-emerald-700">
                                    {row.priorDelta}
                                  </div>
                                )}
                              </td>
                              <td data-label="Flag" className="px-3 py-2.5">
                                {row.flag && (
                                  <span
                                    className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${flagBadgeStyle(
                                      row.flag
                                    )}`}
                                  >
                                    {row.flag}
                                  </span>
                                )}
                              </td>
                              <td
                                data-label="Reference Interval"
                                className="px-3 py-2.5 text-[11px] text-slate-600"
                              >
                                {row.referenceRange}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Optional Active Prescription Box */}
                  {activeDoc.rxOrder && (
                    <div className="relative mt-4 rounded border border-emerald-300 bg-emerald-50/60 p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-900">
                          Verified Electronic Prescription (e-Rx)
                        </p>
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold text-emerald-800">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          {activeDoc.rxOrder.dispenseStatus}
                        </span>
                      </div>
                      <p className="mt-1.5 font-semibold text-slate-900">
                        {activeDoc.rxOrder.medication}
                      </p>
                      <p className="mt-0.5 text-slate-700">{activeDoc.rxOrder.sig}</p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Prescriber: {activeDoc.rxOrder.prescriber}
                      </p>
                    </div>
                  )}

                  {/* Clinical Interpretation & Footnotes */}
                  <div className="relative mt-4 rounded border border-slate-200 bg-slate-50/80 p-3.5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-600">
                      Clinical Interpretation & Governance Notes
                    </p>
                    <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700">
                      {activeDoc.clinicalNotes.map((note, idx) => (
                        <li key={idx} className="flex gap-2">
                          <span className="font-mono text-slate-400">[{idx + 1}]</span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Electronic Signature Footer */}
                  <footer className="relative mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-slate-300 pt-3.5 text-[11px]">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                        Electronically Verified By
                      </p>
                      <p className="mt-0.5 font-serif text-sm font-semibold italic text-slate-900">
                        {activeDoc.signatureBlock.signedBy}
                      </p>
                      <p className="text-slate-600">{activeDoc.signatureBlock.credentials}</p>
                    </div>

                    <div className="text-left sm:text-right">
                      <p className="font-mono text-[10px] text-slate-500">
                        Verified: {activeDoc.signatureBlock.signedAt}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {activeDoc.signatureBlock.registryNote}
                      </p>
                      <p className="mt-1 font-mono text-[10px] font-semibold text-amber-800">
                        SYNTHETIC DATA · ILLUSTRATIVE CLINICAL RULES · CLINICIAN SIGN-OFF REQUIRED
                      </p>
                    </div>
                  </footer>
                </div>
              </article>
            )}
          </section>
        </div>
      </div>
    </dialog>
  );
}
