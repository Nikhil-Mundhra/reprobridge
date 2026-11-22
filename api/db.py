import os
from datetime import UTC, datetime
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    case,
    create_engine,
    func,
    or_,
    select,
    text,
)
from sqlalchemy.engine import Engine
from sqlalchemy.pool import NullPool

load_dotenv(".env.local")
load_dotenv(".env")

_schema_initialized = False

metadata = MetaData()

obligations_table = Table(
    "clinical_obligations",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("patient_id", String(64), nullable=False),
    Column("patient_name", String(128), nullable=False),
    Column("life_stage", String(64), nullable=False),
    Column("title", String(256), nullable=False),
    Column("rationale", Text, nullable=False),
    Column("evidence_source", String(256), nullable=False),
    Column("rule_version", String(32), nullable=False),
    Column("owner", String(128), nullable=False),
    Column("status", String(32), nullable=False),
    Column("priority", String(32), nullable=False),
    Column("parent_obligation_id", String(64), nullable=True),
    Column("trigger_event_date", String(32), nullable=True),
    Column("due_window_start", String(32), nullable=True),
    Column("due_window_end", String(32), nullable=True),
    Column("due_label", String(128), nullable=True),
    Column("closure_policy", String(64), nullable=True),
    Column("protocol_code", String(64), nullable=True),
    Column("verified_by", String(128), nullable=True),
    Column("closure_evidence", Text, nullable=True),
    Column("updated_at", DateTime(timezone=True), nullable=False),
)

_OBLIGATION_OPTIONAL_DEFAULTS: dict[str, Any] = {
    "parent_obligation_id": None,
    "trigger_event_date": None,
    "due_window_start": None,
    "due_window_end": None,
    "due_label": None,
    "closure_policy": "CLINICIAN_EVIDENCE",
    "protocol_code": None,
}

_OBLIGATION_MIGRATION_DDL: tuple[str, ...] = (
    "ALTER TABLE clinical_obligations ADD COLUMN IF NOT EXISTS parent_obligation_id VARCHAR(64)",
    "ALTER TABLE clinical_obligations ADD COLUMN IF NOT EXISTS trigger_event_date VARCHAR(32)",
    "ALTER TABLE clinical_obligations ADD COLUMN IF NOT EXISTS due_window_start VARCHAR(32)",
    "ALTER TABLE clinical_obligations ADD COLUMN IF NOT EXISTS due_window_end VARCHAR(32)",
    "ALTER TABLE clinical_obligations ADD COLUMN IF NOT EXISTS due_label VARCHAR(128)",
    "ALTER TABLE clinical_obligations ADD COLUMN IF NOT EXISTS closure_policy VARCHAR(64)",
    "ALTER TABLE clinical_obligations ADD COLUMN IF NOT EXISTS protocol_code VARCHAR(64)",
)

audit_events_table = Table(
    "audit_events",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("obligation_id", String(64), nullable=True),
    Column("event_type", String(64), nullable=False),
    Column("actor", String(128), nullable=False),
    Column("summary", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
)

clinical_evidence_table = Table(
    "clinical_evidence",
    metadata,
    Column("id", String(64), primary_key=True),
    Column("obligation_id", String(64), nullable=False),
    Column("fhir_resource_type", String(64), nullable=False),
    Column("code_display", String(256), nullable=False),
    Column("result_value", String(256), nullable=False),
    Column("reference_range", String(128), nullable=True),
    Column("source_facility", String(256), nullable=False),
    Column("accession_id", String(128), nullable=False),
    Column("clinician_suggestion", String(128), nullable=False),
    Column("summary_note", Text, nullable=False),
    Column("recorded_at", DateTime(timezone=True), nullable=False),
)


def _normalize_database_url(raw_url: str) -> str:
    """Ensure SQLAlchemy uses the psycopg v3 driver for Neon PostgreSQL."""
    if raw_url.startswith("postgres://"):
        raw_url = raw_url.replace("postgres://", "postgresql://", 1)
    if raw_url.startswith("postgresql://") and "+psycopg" not in raw_url:
        raw_url = raw_url.replace("postgresql://", "postgresql+psycopg://", 1)
    return raw_url


def get_engine() -> Engine | None:
    """Create a serverless-safe SQLAlchemy engine using the pooled Neon DATABASE_URL.

    Uses NullPool and disables psycopg3 auto-prepared statements (prepare_threshold=None)
    for compatibility with Neon's PgBouncer transaction-mode pooler on Vercel serverless.
    """
    raw_url = os.getenv("DATABASE_URL", "").strip()
    if not raw_url:
        return None
    return create_engine(
        _normalize_database_url(raw_url),
        poolclass=NullPool,
        pool_pre_ping=True,
        connect_args={"prepare_threshold": None},
    )


def get_direct_engine() -> Engine | None:
    """Create a direct (unpooled) SQLAlchemy engine for DDL / schema migrations.

    Uses DATABASE_URL_UNPOOLED per Neon best practices so DDL never runs over PgBouncer.
    """
    raw_url = (
        os.getenv("DATABASE_URL_UNPOOLED", "").strip() or os.getenv("DATABASE_URL", "").strip()
    )
    if not raw_url:
        return None
    return create_engine(
        _normalize_database_url(raw_url),
        poolclass=NullPool,
        pool_pre_ping=True,
    )


PATIENT_COHORT_META: dict[str, dict[str, Any]] = {
    "PAT-AE-4092": {
        "patient_id": "PAT-AE-4092",
        "patient_name": "Amina Al-Mansoori (Synthetic)",
        "age_sex": "32Y · F",
        "clinical_track": "Endocrine & Rubella Continuity",
        "facility_a": "Mubadala Primary Care",
        "facility_b": "Corniche OB-GYN",
        "id_base": 100,
    },
    "PAT-AE-5180": {
        "patient_id": "PAT-AE-5180",
        "patient_name": "Fatima Al-Zaabi (Synthetic)",
        "age_sex": "29Y · F",
        "clinical_track": "GDM Postpartum OGTT & Varicella",
        "facility_a": "Al Bateen Primary Clinic",
        "facility_b": "Corniche OB-GYN",
        "id_base": 200,
    },
    "PAT-AE-6304": {
        "patient_id": "PAT-AE-6304",
        "patient_name": "Sara Al-Nuaimi (Synthetic)",
        "age_sex": "36Y · F",
        "clinical_track": "Postpartum BP & HPV Continuity",
        "facility_a": "Khalifa City Family Medicine",
        "facility_b": "Danat Al Emarat Maternity",
        "id_base": 300,
    },
    "PAT-AE-7415": {
        "patient_id": "PAT-AE-7415",
        "patient_name": "Mariam Al-Dhaheri (Synthetic)",
        "age_sex": "31Y · F",
        "clinical_track": "Perinatal Mental Health & Cervical Screening",
        "facility_a": "Al Ain Primary Women's Clinic",
        "facility_b": "Tawam OB-GYN & Perinatal Psychiatry",
        "id_base": 400,
    },
    "PAT-AE-8529": {
        "patient_id": "PAT-AE-8529",
        "patient_name": "Hessa Al-Mazrouei (Synthetic)",
        "age_sex": "27Y · F",
        "clinical_track": "Endometriosis Evaluation Continuity",
        "facility_a": "Yas Island Family Medicine",
        "facility_b": "Cleveland Clinic Abu Dhabi Gynecology",
        "id_base": 500,
    },
}

SEED_OBLIGATIONS: list[dict[str, Any]] = [
    {
        "id": "OBL-101",
        "patient_id": "PAT-AE-4092",
        "patient_name": "Amina Al-Mansoori (Synthetic)",
        "life_stage": "Preconception",
        "title": "Subclinical Hypothyroidism Follow-up (TSH 4.8 mIU/L)",
        "rationale": (
            "Preconception lab showed elevated TSH (4.8 mIU/L). Requires repeat TSH + "
            "free T4 and endocrinology/OB review before conception or immediately upon pregnancy."
        ),
        "evidence_source": "FHIR Observation/obs-tsh-2026-09 (Malaffi HIE Synthetic)",
        "rule_version": "RB-THYROID-v1.4.0",
        "owner": "Primary Care / OB-GYN",
        "status": "OPEN",
        "priority": "HIGH",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-09-14",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": None,
        "closure_policy": "CLINICIAN_EVIDENCE",
        "protocol_code": "ATA-THYROID-T1",
        "verified_by": None,
        "closure_evidence": None,
    },
    {
        "id": "OBL-102",
        "patient_id": "PAT-AE-4092",
        "patient_name": "Amina Al-Mansoori (Synthetic)",
        "life_stage": "Preconception",
        "title": "Rubella IgG Non-Immune Vaccination Verification",
        "rationale": (
            "Preconception screening indicated Rubella IgG non-immune status. "
            "MMR vaccination contraindicated during pregnancy; verify immunization or postpartum deferral."
        ),
        "evidence_source": "FHIR DiagnosticReport/rep-rubella-2026-08",
        "rule_version": "RB-IMMUNE-v1.2.1",
        "owner": "Preventive Care Nurse",
        "status": "OPEN",
        "priority": "MEDIUM",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-08-22",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": None,
        "closure_policy": "CLINICIAN_EVIDENCE",
        "protocol_code": "DOH-IMMUNE-MMR",
        "verified_by": None,
        "closure_evidence": None,
    },
]

ADDITIONAL_SEED_OBLIGATIONS: list[dict[str, Any]] = [
    {
        "id": "OBL-201",
        "patient_id": "PAT-AE-5180",
        "patient_name": "Fatima Al-Zaabi (Synthetic)",
        "life_stage": "Preconception",
        "title": "GDM & Dysglycemia OGTT Follow-up (Fasting Glucose 112 mg/dL · HbA1c 6.1%)",
        "rationale": (
            "Preconception panel showed impaired fasting glucose (112 mg/dL) and HbA1c 6.1% with "
            "prior confirmed gestational diabetes (GDM). Requires early antenatal OGTT and, after "
            "delivery, a protocol-timed postpartum 75g OGTT (ADA 2026: 4–12 weeks postpartum). "
            "A booked appointment alone leaves testing open; result review is tracked separately."
        ),
        "evidence_source": "FHIR Observation/obs-hba1c-2026-09 (Malaffi HIE Synthetic)",
        "rule_version": "RB-METABOLIC-v2.0.0",
        "owner": "Primary Care / Endocrinology",
        "status": "OPEN",
        "priority": "HIGH",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-09-18",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": "Completed OGTT required (booking alone insufficient)",
        "closure_policy": "COMPLETED_TEST_NOT_BOOKING",
        "protocol_code": "ADA-2026-OGTT-4-12W",
        "verified_by": None,
        "closure_evidence": None,
    },
    {
        "id": "OBL-202",
        "patient_id": "PAT-AE-5180",
        "patient_name": "Fatima Al-Zaabi (Synthetic)",
        "life_stage": "Preconception",
        "title": "Varicella-Zoster (VZV) IgG Non-Immune Vaccination Verification",
        "rationale": (
            "Preconception serology indicated VZV IgG non-immune status (<100 mIU/mL). "
            "Live-attenuated Varicella vaccine is contraindicated during pregnancy; defer to "
            "postpartum pre-discharge pathway."
        ),
        "evidence_source": "FHIR DiagnosticReport/rep-vzv-2026-08",
        "rule_version": "RB-IMMUNE-v1.2.1",
        "owner": "Preventive Care Nurse",
        "status": "OPEN",
        "priority": "MEDIUM",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-08-27",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": None,
        "closure_policy": "CLINICIAN_EVIDENCE",
        "protocol_code": "DOH-IMMUNE-VZV",
        "verified_by": None,
        "closure_evidence": None,
    },
    {
        "id": "OBL-301",
        "patient_id": "PAT-AE-6304",
        "patient_name": "Sara Al-Nuaimi (Synthetic)",
        "life_stage": "Preconception",
        "title": "Hypertensive Disorder & Postpartum BP Continuity (BP 138/88 mmHg)",
        "rationale": (
            "History of prior preterm preeclampsia and baseline BP 138/88 mmHg. Requires low-dose "
            "aspirin (150 mg nightly) evaluation between 12 and 16 weeks gestation and structured "
            "postpartum blood pressure follow-up after delivery (SMFM ≤72h target for severe HTN; "
            "≤10-day remote BP monitoring achieves 92.2% capture vs 43.7% office-based)."
        ),
        "evidence_source": "FHIR Observation/obs-bp-2026-09 (Malaffi HIE Synthetic)",
        "rule_version": "RB-PREECLAMPSIA-v2.0.0",
        "owner": "Primary Care / Maternal-Fetal Medicine",
        "status": "OPEN",
        "priority": "HIGH",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-09-21",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": "BP assessment required · Severe readings escalate",
        "closure_policy": "POSTPARTUM_BP_ASSESSMENT",
        "protocol_code": "SMFM-72H-POSTPARTUM-BP",
        "verified_by": None,
        "closure_evidence": None,
    },
    {
        "id": "OBL-302",
        "patient_id": "PAT-AE-6304",
        "patient_name": "Sara Al-Nuaimi (Synthetic)",
        "life_stage": "Preconception",
        "title": "Incomplete HPV 9-Valent Immunization Series (Dose 2 of 3)",
        "rationale": (
            "Preconception immunization review showed HPV 9-valent series incomplete (1 of 3 doses "
            "received). Routine HPV vaccination is deferred during pregnancy; resume series "
            "immediately postpartum."
        ),
        "evidence_source": "FHIR ImmunizationRecommendation/rec-hpv-2026-08",
        "rule_version": "RB-HPV-v1.1.0",
        "owner": "Preventive Care Nurse",
        "status": "OPEN",
        "priority": "MEDIUM",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-08-29",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": None,
        "closure_policy": "CLINICIAN_EVIDENCE",
        "protocol_code": "DOH-IMMUNE-HPV",
        "verified_by": None,
        "closure_evidence": None,
    },
    {
        "id": "OBL-401",
        "patient_id": "PAT-AE-7415",
        "patient_name": "Mariam Al-Dhaheri (Synthetic)",
        "life_stage": "Preconception",
        "title": "Positive Perinatal Depression & Anxiety Screen (EPDS 15 · GAD-7 12)",
        "rationale": (
            "Validated screening returned elevated scores (EPDS 15/30, GAD-7 12/21; Item 10 negative "
            "at intake). Per ACOG guidelines, a questionnaire score is a screening signal rather than "
            "a diagnosis or closure: requires structured clinical assessment, follow-up treatment/monitoring "
            "linkage, and immediate routing to the approved urgent pathway if any safety concern arises."
        ),
        "evidence_source": "FHIR QuestionnaireResponse/qr-epds-2026-09 (Malaffi HIE Synthetic)",
        "rule_version": "RB-PERINATAL-MH-v1.0.0",
        "owner": "Perinatal Behavioral Health / OB-GYN",
        "status": "OPEN",
        "priority": "HIGH",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-09-25",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": "Clinical assessment required (score alone cannot close)",
        "closure_policy": "MENTAL_HEALTH_ASSESSMENT",
        "protocol_code": "ACOG-PERINATAL-MH",
        "verified_by": None,
        "closure_evidence": None,
    },
    {
        "id": "OBL-402",
        "patient_id": "PAT-AE-7415",
        "patient_name": "Mariam Al-Dhaheri (Synthetic)",
        "life_stage": "Preconception",
        "title": "Abnormal Cervical Screening Follow-up (Pre-Pregnancy HPV16+ · HSIL Cytology)",
        "rationale": (
            "Pre-pregnancy cervical screening showed high-risk HPV16 positive with HSIL cytology and "
            "no completed colposcopy on record. Inadequate follow-up ranges from 4%–75% across care "
            "settings. Must reconcile original HPV/cytology result, interim procedures, and pregnancy "
            "status under Abu Dhabi DoH / ASCCP guidelines (colposcopy triage in pregnancy; ECC and "
            "routine excisional treatment deferred until ≥6 weeks postpartum)."
        ),
        "evidence_source": "FHIR DiagnosticReport/rep-cervical-2026-07 (Malaffi HIE Synthetic)",
        "rule_version": "RB-CERVICAL-v1.0.0",
        "owner": "Colposcopy Clinic / OB-GYN",
        "status": "OPEN",
        "priority": "HIGH",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-07-19",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": "Reconcile HPV/cytology & pregnancy status (DoH / ASCCP)",
        "closure_policy": "CERVICAL_ALGORITHM_RECONCILIATION",
        "protocol_code": "DOH-AD-CERVICAL-PREG",
        "verified_by": None,
        "closure_evidence": None,
    },
    {
        "id": "OBL-501",
        "patient_id": "PAT-AE-8529",
        "patient_name": "Hessa Al-Mazrouei (Synthetic)",
        "life_stage": "Preconception",
        "title": "Suspected Endometriosis Evaluation (3 Recurring Visits · Normal Pelvic Ultrasound)",
        "rationale": (
            "Three documented visits over 14 months for severe cyclic pelvic pain, dysmenorrhea "
            "causing missed workdays, and deep dyspareunia. Recent transvaginal ultrasound reported "
            "normal. WHO documents an average 4–12 year diagnostic delay; NICE NG73 advises that a "
            "normal examination or ultrasound can coexist with endometriosis and specialist referral "
            "signal must be preserved until evaluated under an approved gynecology pathway."
        ),
        "evidence_source": "FHIR Condition/cond-pelvic-pain-2026-09 (Malaffi HIE Synthetic)",
        "rule_version": "RB-ENDO-v1.0.0",
        "owner": "Gynecology / Endometriosis Referral Pathway",
        "status": "OPEN",
        "priority": "HIGH",
        "parent_obligation_id": None,
        "trigger_event_date": "2026-09-10",
        "due_window_start": None,
        "due_window_end": None,
        "due_label": "Specialist review required (normal scan cannot close)",
        "closure_policy": "ENDOMETRIOSIS_PATHWAY_REVIEW",
        "protocol_code": "NICE-NG73-ENDO",
        "verified_by": None,
        "closure_evidence": None,
    },
]

ALL_SEED_OBLIGATIONS: list[dict[str, Any]] = SEED_OBLIGATIONS + ADDITIONAL_SEED_OBLIGATIONS

SEED_AUDIT_EVENTS: list[dict[str, Any]] = [
    {
        "obligation_id": "OBL-101",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-THYROID-v1.4.0)",
        "summary": "Logged preconception TSH 4.8 mIU/L follow-up obligation from FHIR Observation/obs-tsh-2026-09.",
    },
    {
        "obligation_id": "OBL-102",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-IMMUNE-v1.2.1)",
        "summary": "Logged Rubella IgG non-immune obligation from FHIR DiagnosticReport/rep-rubella-2026-08.",
    },
    {
        "obligation_id": "OBL-201",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-METABOLIC-v2.0.0)",
        "summary": "Logged GDM / preconception dysglycemia (HbA1c 6.1%, FBG 112 mg/dL) OGTT obligation from FHIR Observation/obs-hba1c-2026-09.",
    },
    {
        "obligation_id": "OBL-202",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-IMMUNE-v1.2.1)",
        "summary": "Logged Varicella (VZV) IgG non-immune obligation from FHIR DiagnosticReport/rep-vzv-2026-08.",
    },
    {
        "obligation_id": "OBL-301",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-PREECLAMPSIA-v2.0.0)",
        "summary": "Logged hypertensive disorder & postpartum BP continuity obligation (BP 138/88 mmHg) from FHIR Observation/obs-bp-2026-09.",
    },
    {
        "obligation_id": "OBL-302",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-HPV-v1.1.0)",
        "summary": "Logged incomplete HPV 9-valent series (Dose 2/3) from FHIR ImmunizationRecommendation/rec-hpv-2026-08.",
    },
    {
        "obligation_id": "OBL-401",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-PERINATAL-MH-v1.0.0)",
        "summary": "Logged positive perinatal depression & anxiety screening signal (EPDS 15, GAD-7 12) from FHIR QuestionnaireResponse/qr-epds-2026-09.",
    },
    {
        "obligation_id": "OBL-402",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-CERVICAL-v1.0.0)",
        "summary": "Logged pre-pregnancy abnormal cervical screening (HPV16+, HSIL cytology) reconciliation obligation from FHIR DiagnosticReport/rep-cervical-2026-07.",
    },
    {
        "obligation_id": "OBL-501",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-ENDO-v1.0.0)",
        "summary": "Logged recurring pelvic pain & suspected endometriosis evaluation signal (3 visits · normal TVUS preserved per NICE NG73) from FHIR Condition/cond-pelvic-pain-2026-09.",
    },
]

SEED_CLINICAL_EVIDENCE: list[dict[str, Any]] = [
    {
        "id": "EVD-TSH-2026-10",
        "obligation_id": "OBL-101",
        "fhir_resource_type": "Observation",
        "code_display": "Thyrotropin (TSH) [LOINC 3016-3] + Free T4",
        "result_value": "TSH 2.1 mIU/L (Normalized) · Levothyroxine 50 mcg initiated",
        "reference_range": "Trimester 1 target <2.5 mIU/L",
        "source_facility": "Cleveland Clinic Abu Dhabi · Malaffi HIE",
        "accession_id": "MAL-LAB-2026-88412",
        "clinician_suggestion": "Dr. Layla Al-Hashimi (OB-GYN)",
        "summary_note": (
            "Repeat TSH 2.1 mIU/L verified (Accession #MAL-LAB-2026-88412, within Trimester 1 "
            "target <2.5 mIU/L); levothyroxine 50 mcg initiated and documented in Malaffi HIE."
        ),
    },
    {
        "id": "EVD-MMR-2026-11",
        "obligation_id": "OBL-102",
        "fhir_resource_type": "Immunization",
        "code_display": "MMR (Measles, Mumps, Rubella) Vaccine [CVX 03]",
        "result_value": "0.5 mL SC administered pre-discharge (Lot #MMR-2026-AE)",
        "reference_range": "Postpartum contraindication lifted",
        "source_facility": "Corniche Hospital Abu Dhabi · Malaffi Immunization Registry",
        "accession_id": "MAL-IMM-2026-55901",
        "clinician_suggestion": "Dr. Mariam Al-Suwaidi (Postpartum OB-GYN)",
        "summary_note": (
            "Postpartum MMR vaccine administered prior to discharge (Lot #MMR-2026-AE, "
            "Registry #MAL-IMM-2026-55901); recorded in Malaffi Immunization Registry."
        ),
    },
    {
        "id": "EVD-OGTT-2026-10",
        "obligation_id": "OBL-201",
        "fhir_resource_type": "Observation",
        "code_display": "75g Oral Glucose Tolerance Test (OGTT) + HbA1c [LOINC 14749-6]",
        "result_value": "Fasting 89 mg/dL · 1h 164 mg/dL · 2h 138 mg/dL · MNT initiated",
        "reference_range": "IADPSG Antenatal Targets (<92 / <180 / <153 mg/dL)",
        "source_facility": "Corniche OB-GYN · Malaffi HIE",
        "accession_id": "MAL-LAB-2026-91204",
        "clinician_suggestion": "Dr. Noura Al-Ketbi (Maternal Endocrinology)",
        "summary_note": (
            "Early antenatal 75g OGTT within glycemic targets (89/164/138 mg/dL, Accession "
            "#MAL-LAB-2026-91204); medical nutrition therapy & SMBG plan documented."
        ),
    },
    {
        "id": "EVD-VZV-2026-11",
        "obligation_id": "OBL-202",
        "fhir_resource_type": "Immunization",
        "code_display": "Varicella Virus Live Vaccine [CVX 21]",
        "result_value": "0.5 mL SC Dose 1 administered pre-discharge (Lot #VZV-2026-AE)",
        "reference_range": "Postpartum contraindication lifted",
        "source_facility": "Corniche Hospital Abu Dhabi · Malaffi Immunization Registry",
        "accession_id": "MAL-IMM-2026-60418",
        "clinician_suggestion": "Dr. Mariam Al-Suwaidi (Postpartum OB-GYN)",
        "summary_note": (
            "Postpartum Varicella Dose 1 administered prior to discharge (Lot #VZV-2026-AE, "
            "Registry #MAL-IMM-2026-60418); Dose 2 scheduled at 4–8 weeks."
        ),
    },
    {
        "id": "EVD-ASA-2026-10",
        "obligation_id": "OBL-301",
        "fhir_resource_type": "MedicationRequest",
        "code_display": "Aspirin 150 mg Enteric-Coated Tablet (Preeclampsia Prophylaxis)",
        "result_value": "Initiated at 12w4d gestation · Home BP 124/78 mmHg",
        "reference_range": "Start 12–16 weeks gestation",
        "source_facility": "Danat Al Emarat Maternity · Malaffi e-Rx",
        "accession_id": "MAL-RX-2026-77310",
        "clinician_suggestion": "Dr. Layla Al-Hashimi (MFM / OB-GYN)",
        "summary_note": (
            "Low-dose aspirin 150 mg nightly initiated at 12w4d within prophylaxis window "
            "(Malaffi e-Rx #MAL-RX-2026-77310); repeat BP 124/78 mmHg stabilized."
        ),
    },
    {
        "id": "EVD-HPV-2026-11",
        "obligation_id": "OBL-302",
        "fhir_resource_type": "Immunization",
        "code_display": "HPV 9-Valent Recombinant Vaccine (Dose 2 of 3) [CVX 165]",
        "result_value": "0.5 mL IM Dose 2 administered pre-discharge (Lot #HPV-2026-AE)",
        "reference_range": "Postpartum deferral lifted",
        "source_facility": "Danat Al Emarat Postpartum Clinic · Malaffi Immunization Registry",
        "accession_id": "MAL-IMM-2026-71892",
        "clinician_suggestion": "Dr. Mariam Al-Suwaidi (Postpartum OB-GYN)",
        "summary_note": (
            "Postpartum HPV 9-valent Dose 2 administered pre-discharge (Lot #HPV-2026-AE, "
            "Registry #MAL-IMM-2026-71892); Dose 3 scheduled in 4 months."
        ),
    },
    {
        "id": "EVD-EPDS-2026-10",
        "obligation_id": "OBL-401",
        "fhir_resource_type": "ClinicalImpression",
        "code_display": "Structured Perinatal Behavioral Health Assessment & Follow-up Plan",
        "result_value": "Clinical assessment completed · No active safety concern · CBT + 4-week monitoring",
        "reference_range": "ACOG screening -> clinical assessment -> treatment/monitoring",
        "source_facility": "Tawam Perinatal Psychiatry · Malaffi HIE",
        "accession_id": "MAL-BH-2026-44109",
        "clinician_suggestion": "Dr. Huda Al-Mheiri (Perinatal Psychiatry)",
        "summary_note": (
            "Structured perinatal mental health clinical assessment completed following EPDS 15 / "
            "GAD-7 12 screen (Accession #MAL-BH-2026-44109); safety screen negative, psychotherapy "
            "treatment and 4-week follow-up monitoring plan established."
        ),
    },
    {
        "id": "EVD-CERV-2026-10",
        "obligation_id": "OBL-402",
        "fhir_resource_type": "Procedure",
        "code_display": "Antenatal Colposcopy Triage (Abu Dhabi DoH / ASCCP Algorithm)",
        "result_value": "Colposcopy completed · Invasive disease excluded · ECC deferred · Postpartum plan set",
        "reference_range": "Rule out invasion in pregnancy; defer excision ≥6w postpartum",
        "source_facility": "Tawam Colposcopy & OB-GYN Clinic · Malaffi HIE",
        "accession_id": "MAL-COLP-2026-33912",
        "clinician_suggestion": "Dr. Aisha Al-Shamsi (Gynecologic Oncology / OB-GYN)",
        "summary_note": (
            "Reconciled pre-pregnancy HPV16+/HSIL cytology with pregnancy status via specialist "
            "colposcopy (Accession #MAL-COLP-2026-33912): invasive cancer excluded, no ECC performed, "
            "definitive re-evaluation queued at ≥6 weeks postpartum per Abu Dhabi DoH / ASCCP."
        ),
    },
    {
        "id": "EVD-ENDO-2026-10",
        "obligation_id": "OBL-501",
        "fhir_resource_type": "DiagnosticReport",
        "code_display": "Gynecology Endometriosis Specialist Pathway Review (NICE NG73)",
        "result_value": "Specialist endometriosis clinic review completed · Pelvic MRI + pathway plan",
        "reference_range": "Normal TVUS does not exclude endometriosis (NICE NG73)",
        "source_facility": "Cleveland Clinic Abu Dhabi Gynecology · Malaffi HIE",
        "accession_id": "MAL-GYN-2026-51208",
        "clinician_suggestion": "Dr. Salma Al-Qubaisi (Complex Gynecology)",
        "summary_note": (
            "Specialist gynecology endometriosis clinic review completed despite prior normal pelvic "
            "ultrasound (Accession #MAL-GYN-2026-51208); approved diagnostic pathway and specialist "
            "pelvic MRI / longitudinal symptom management plan documented."
        ),
    },
]

_MEMORY_STORE: list[dict[str, Any]] = [
    {**item, "updated_at": datetime.now(UTC)} for item in ALL_SEED_OBLIGATIONS
]
_MEMORY_AUDIT: list[dict[str, Any]] = [
    {"id": idx + 1, **item, "created_at": datetime.now(UTC)}
    for idx, item in enumerate(SEED_AUDIT_EVENTS)
]
_MEMORY_EVIDENCE: list[dict[str, Any]] = [
    {**item, "recorded_at": datetime.now(UTC)} for item in SEED_CLINICAL_EVIDENCE
]


def ensure_schema_and_seed() -> None:
    """Create tables if missing via the direct (unpooled) connection and seed once."""
    global _schema_initialized
    if _schema_initialized:
        return
    direct_engine = get_direct_engine()
    if direct_engine is None:
        return
    metadata.create_all(direct_engine)
    now = datetime.now(UTC)
    with direct_engine.begin() as conn:
        for ddl in _OBLIGATION_MIGRATION_DDL:
            conn.execute(text(ddl))
        existing_ids = {row[0] for row in conn.execute(select(obligations_table.c.id)).all()}
        missing_obls = [
            {**_OBLIGATION_OPTIONAL_DEFAULTS, **item, "updated_at": now}
            for item in ALL_SEED_OBLIGATIONS
            if item["id"] not in existing_ids
        ]
        if missing_obls:
            conn.execute(obligations_table.insert(), missing_obls)
            missing_ids = {item["id"] for item in missing_obls}
            missing_audits = [
                {**ev, "created_at": now}
                for ev in SEED_AUDIT_EVENTS
                if ev["obligation_id"] in missing_ids
            ]
            if missing_audits:
                conn.execute(audit_events_table.insert(), missing_audits)

        existing_ev_ids = {
            row[0] for row in conn.execute(select(clinical_evidence_table.c.id)).all()
        }
        missing_ev = [
            {**item, "recorded_at": now}
            for item in SEED_CLINICAL_EVIDENCE
            if item["id"] not in existing_ev_ids
        ]
        if missing_ev:
            conn.execute(clinical_evidence_table.insert(), missing_ev)
    _schema_initialized = True


def check_database_health() -> dict[str, Any]:
    """Return Neon PostgreSQL connectivity status."""
    engine = get_engine()
    if engine is None:
        return {
            "provider": "in-memory-fallback",
            "connected": False,
            "detail": "DATABASE_URL not configured; using synthetic in-memory store.",
        }
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {
            "provider": "neon-postgres",
            "connected": True,
            "branch": os.getenv("NEON_BRANCH", "unknown"),
            "pooled": "-pooler" in os.getenv("DATABASE_URL", ""),
            "detail": "Connected to Neon PostgreSQL.",
        }
    except Exception as exc:  # noqa: BLE001 -- health probe: report any driver/DNS/auth failure as disconnected
        return {
            "provider": "neon-postgres",
            "connected": False,
            "detail": f"Connection error: {exc}",
        }


def list_obligations(patient_id: str | None = None) -> list[dict[str, Any]]:
    engine = get_engine()
    if engine is None:
        items = [dict(item) for item in _MEMORY_STORE]
        if patient_id and patient_id != "ALL":
            items = [item for item in items if item.get("patient_id") == patient_id]
        return sorted(items, key=lambda item: str(item.get("id", "")))
    ensure_schema_and_seed()
    with engine.connect() as conn:
        stmt = select(obligations_table).order_by(obligations_table.c.id)
        if patient_id and patient_id != "ALL":
            stmt = stmt.where(obligations_table.c.patient_id == patient_id)
        rows = conn.execute(stmt).mappings()
        return [dict(row) for row in rows]


def _derive_life_stage(obligations: list[dict[str, Any]]) -> str:
    if any(o.get("life_stage") == "Postpartum" for o in obligations):
        return "Postpartum"
    if any(str(o.get("life_stage", "")).startswith("Antenatal") for o in obligations):
        return "Antenatal (Trimester 1)"
    if obligations:
        return str(obligations[0].get("life_stage") or "Preconception")
    return "Preconception"


def _build_patient_summary(
    pid: str,
    *,
    patient_name: str | None,
    life_stage: str,
    total_obligations: int,
    open_count: int,
    urgent_count: int,
    deferred_count: int,
    closed_count: int,
) -> dict[str, Any]:
    meta = PATIENT_COHORT_META.get(pid, {})
    return {
        "patient_id": pid,
        "patient_name": meta.get("patient_name") or patient_name or f"Patient {pid}",
        "age_sex": meta.get("age_sex", "Adult · F"),
        "clinical_track": meta.get("clinical_track", "Preventive Care Continuity"),
        "facility_a": meta.get("facility_a", "Primary Care Clinic"),
        "facility_b": meta.get("facility_b", "OB-GYN Specialist Center"),
        "life_stage": life_stage,
        "total_obligations": int(total_obligations),
        "open_count": int(open_count),
        "urgent_count": int(urgent_count),
        "deferred_count": int(deferred_count),
        "closed_count": int(closed_count),
    }


def list_patient_summaries() -> list[dict[str, Any]]:
    """Aggregate obligation counts and active life stage per patient via SQL GROUP BY."""
    engine = get_engine()
    aggregated: dict[str, dict[str, Any]] = {}

    if engine is None:
        by_patient: dict[str, list[dict[str, Any]]] = {}
        for row in _MEMORY_STORE:
            pid = str(row.get("patient_id", "PAT-AE-4092"))
            by_patient.setdefault(pid, []).append(row)
        for pid, rows in by_patient.items():
            aggregated[pid] = _build_patient_summary(
                pid,
                patient_name=rows[0].get("patient_name") if rows else None,
                life_stage=_derive_life_stage(rows),
                total_obligations=len(rows),
                open_count=sum(
                    1
                    for r in rows
                    if r.get("status") not in {"VERIFIED_CLOSED", "DEFERRED_TO_POSTPARTUM"}
                ),
                urgent_count=sum(
                    1
                    for r in rows
                    if r.get("priority") == "URGENT" and r.get("status") != "VERIFIED_CLOSED"
                ),
                deferred_count=sum(1 for r in rows if r.get("status") == "DEFERRED_TO_POSTPARTUM"),
                closed_count=sum(1 for r in rows if r.get("status") == "VERIFIED_CLOSED"),
            )
    else:
        ensure_schema_and_seed()
        stmt = select(
            obligations_table.c.patient_id,
            func.max(obligations_table.c.patient_name).label("patient_name"),
            func.count(obligations_table.c.id).label("total_obligations"),
            func.sum(
                case(
                    (
                        obligations_table.c.status.notin_(
                            ["VERIFIED_CLOSED", "DEFERRED_TO_POSTPARTUM"]
                        ),
                        1,
                    ),
                    else_=0,
                )
            ).label("open_count"),
            func.sum(
                case(
                    (
                        (obligations_table.c.priority == "URGENT")
                        & (obligations_table.c.status != "VERIFIED_CLOSED"),
                        1,
                    ),
                    else_=0,
                )
            ).label("urgent_count"),
            func.sum(
                case(
                    (obligations_table.c.status == "DEFERRED_TO_POSTPARTUM", 1),
                    else_=0,
                )
            ).label("deferred_count"),
            func.sum(case((obligations_table.c.status == "VERIFIED_CLOSED", 1), else_=0)).label(
                "closed_count"
            ),
            func.max(case((obligations_table.c.life_stage == "Postpartum", 1), else_=0)).label(
                "has_postpartum"
            ),
            func.max(case((obligations_table.c.life_stage.like("Antenatal%"), 1), else_=0)).label(
                "has_antenatal"
            ),
            func.max(obligations_table.c.life_stage).label("sample_life_stage"),
        ).group_by(obligations_table.c.patient_id)

        with engine.connect() as conn:
            for row in conn.execute(stmt).mappings():
                pid = str(row["patient_id"])
                if row["has_postpartum"]:
                    stage = "Postpartum"
                elif row["has_antenatal"]:
                    stage = "Antenatal (Trimester 1)"
                else:
                    stage = str(row["sample_life_stage"] or "Preconception")
                aggregated[pid] = _build_patient_summary(
                    pid,
                    patient_name=row["patient_name"],
                    life_stage=stage,
                    total_obligations=int(row["total_obligations"] or 0),
                    open_count=int(row["open_count"] or 0),
                    urgent_count=int(row["urgent_count"] or 0),
                    deferred_count=int(row["deferred_count"] or 0),
                    closed_count=int(row["closed_count"] or 0),
                )

    ordered_ids = list(PATIENT_COHORT_META.keys())
    for pid in sorted(aggregated):
        if pid not in PATIENT_COHORT_META:
            ordered_ids.append(pid)

    summaries: list[dict[str, Any]] = []
    for pid in ordered_ids:
        if pid in aggregated:
            summaries.append(aggregated[pid])
        else:
            summaries.append(
                _build_patient_summary(
                    pid,
                    patient_name=None,
                    life_stage="Preconception",
                    total_obligations=0,
                    open_count=0,
                    urgent_count=0,
                    deferred_count=0,
                    closed_count=0,
                )
            )
    return summaries


def query_patients(
    q: str = "",
    stage: str = "ALL",
    triage: str = "ALL",
    sort: str = "urgency",
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """Filter, sort, and paginate the patient cohort with global cohort totals."""
    all_summaries = list_patient_summaries()
    cohort_totals = {
        "total_patients": len(all_summaries),
        "total_open": sum(p["open_count"] for p in all_summaries),
        "total_urgent": sum(p["urgent_count"] for p in all_summaries),
        "total_deferred": sum(p["deferred_count"] for p in all_summaries),
        "total_closed": sum(p["closed_count"] for p in all_summaries),
    }

    query_text = q.strip().lower()
    stage_norm = stage.strip().lower()
    triage_norm = triage.strip().lower()
    sort_norm = sort.strip().lower()

    cohort_order = {p["patient_id"]: idx for idx, p in enumerate(all_summaries)}
    filtered: list[dict[str, Any]] = []
    for p in all_summaries:
        if query_text:
            haystack = " ".join(
                [
                    str(p.get("patient_id", "")),
                    str(p.get("patient_name", "")),
                    str(p.get("clinical_track", "")),
                    str(p.get("facility_a", "")),
                    str(p.get("facility_b", "")),
                ]
            ).lower()
            if query_text not in haystack:
                continue

        if (
            stage_norm
            and stage_norm != "all"
            and not str(p.get("life_stage", "")).lower().startswith(stage_norm)
        ):
            continue

        if triage_norm == "urgent" and p["urgent_count"] <= 0:
            continue
        if triage_norm == "open" and p["open_count"] <= 0:
            continue
        if triage_norm == "deferred" and p["deferred_count"] <= 0:
            continue
        if triage_norm == "closed" and not (
            p["total_obligations"] > 0 and p["closed_count"] == p["total_obligations"]
        ):
            continue

        filtered.append(p)

    if sort_norm == "name":
        filtered.sort(key=lambda p: str(p.get("patient_name", "")).lower())
    elif sort_norm == "stage":

        def _stage_rank(p: dict[str, Any]) -> tuple[int, int]:
            ls = str(p.get("life_stage", "")).lower()
            rank = 0 if ls == "postpartum" else 1 if ls.startswith("antenatal") else 2
            return (rank, cohort_order.get(p["patient_id"], 9999))

        filtered.sort(key=_stage_rank)
    else:
        filtered.sort(
            key=lambda p: (
                -p["urgent_count"],
                -p["open_count"],
                cohort_order.get(p["patient_id"], 9999),
            )
        )

    total = len(filtered)
    safe_offset = max(0, offset)
    safe_limit = max(1, min(limit, 100))
    page = filtered[safe_offset : safe_offset + safe_limit]
    return {
        "patients": page,
        "total": total,
        "cohort_totals": cohort_totals,
        "limit": safe_limit,
        "offset": safe_offset,
        "has_more": safe_offset + len(page) < total,
    }


def list_audit_events(
    obligation_ids: set[str] | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 500))
    engine = get_engine()
    if engine is None:
        events = list(reversed([dict(item) for item in _MEMORY_AUDIT]))
        if obligation_ids is not None:
            events = [
                e
                for e in events
                if e.get("obligation_id") in obligation_ids or e.get("obligation_id") is None
            ]
        return events[:safe_limit]
    ensure_schema_and_seed()
    with engine.connect() as conn:
        stmt = select(audit_events_table).order_by(audit_events_table.c.id.desc())
        if obligation_ids is not None:
            if obligation_ids:
                stmt = stmt.where(
                    or_(
                        audit_events_table.c.obligation_id.in_(obligation_ids),
                        audit_events_table.c.obligation_id.is_(None),
                    )
                )
            else:
                stmt = stmt.where(audit_events_table.c.obligation_id.is_(None))
        stmt = stmt.limit(safe_limit)
        rows = conn.execute(stmt).mappings()
        return [dict(row) for row in rows]


def append_audit_event(
    event_type: str,
    actor: str,
    summary: str,
    obligation_id: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    payload = {
        "obligation_id": obligation_id,
        "event_type": event_type,
        "actor": actor,
        "summary": summary,
        "created_at": now,
    }
    engine = get_engine()
    if engine is None:
        record = {"id": len(_MEMORY_AUDIT) + 1, **payload}
        _MEMORY_AUDIT.append(record)
        return dict(record)
    ensure_schema_and_seed()
    with engine.begin() as conn:
        result = conn.execute(audit_events_table.insert().values(**payload))
        inserted_id = result.inserted_primary_key[0] if result.inserted_primary_key else None
        return {"id": inserted_id, **payload}


def update_obligation(obligation_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    updates = {**updates, "updated_at": datetime.now(UTC)}
    engine = get_engine()
    if engine is None:
        for item in _MEMORY_STORE:
            if item["id"] == obligation_id:
                item.update(updates)
                return dict(item)
        return None
    ensure_schema_and_seed()
    with engine.begin() as conn:
        conn.execute(
            obligations_table.update()
            .where(obligations_table.c.id == obligation_id)
            .values(**updates)
        )
        row = (
            conn.execute(select(obligations_table).where(obligations_table.c.id == obligation_id))
            .mappings()
            .first()
        )
        return dict(row) if row else None


def list_evidence_for_obligation(obligation_id: str) -> list[dict[str, Any]]:
    """Fetch incoming HIE / FHIR clinical evidence records for an obligation."""
    engine = get_engine()
    if engine is None:
        return [
            dict(item)
            for item in reversed(_MEMORY_EVIDENCE)
            if item["obligation_id"] == obligation_id
        ]
    ensure_schema_and_seed()
    with engine.connect() as conn:
        rows = conn.execute(
            select(clinical_evidence_table)
            .where(clinical_evidence_table.c.obligation_id == obligation_id)
            .order_by(clinical_evidence_table.c.recorded_at.desc())
        ).mappings()
        return [dict(row) for row in rows]


def create_obligation(item: dict[str, Any]) -> dict[str, Any]:
    """Insert a new clinical obligation (manual entry or CSV/table import)."""
    now = datetime.now(UTC)
    record = {
        "id": item["id"],
        "patient_id": item.get("patient_id") or "PAT-AE-4092",
        "patient_name": item.get("patient_name") or "Amina Al-Mansoori (Synthetic)",
        "life_stage": item.get("life_stage") or "Preconception",
        "title": item["title"],
        "rationale": item["rationale"],
        "evidence_source": item.get("evidence_source") or "Manual Clinician Intake",
        "rule_version": item.get("rule_version") or "RB-CUSTOM-v1.0.0",
        "owner": item.get("owner") or "OB-GYN / Primary Care",
        "status": item.get("status") or "OPEN",
        "priority": (item.get("priority") or "MEDIUM").upper(),
        "parent_obligation_id": item.get("parent_obligation_id"),
        "trigger_event_date": item.get("trigger_event_date"),
        "due_window_start": item.get("due_window_start"),
        "due_window_end": item.get("due_window_end"),
        "due_label": item.get("due_label"),
        "closure_policy": item.get("closure_policy") or "CLINICIAN_EVIDENCE",
        "protocol_code": item.get("protocol_code"),
        "verified_by": None,
        "closure_evidence": None,
        "updated_at": now,
    }
    engine = get_engine()
    if engine is None:
        _MEMORY_STORE[:] = [o for o in _MEMORY_STORE if o["id"] != record["id"]]
        _MEMORY_STORE.append(record)
        return dict(record)
    ensure_schema_and_seed()
    with engine.begin() as conn:
        conn.execute(obligations_table.delete().where(obligations_table.c.id == record["id"]))
        conn.execute(obligations_table.insert().values(**record))
    return dict(record)


def create_evidence_record(item: dict[str, Any]) -> dict[str, Any]:
    """Insert a new incoming clinical evidence record into Neon Postgres."""
    now = datetime.now(UTC)
    record = {
        "id": item["id"],
        "obligation_id": item["obligation_id"],
        "fhir_resource_type": item.get("fhir_resource_type") or "Observation",
        "code_display": item["code_display"],
        "result_value": item["result_value"],
        "reference_range": item.get("reference_range"),
        "source_facility": item.get("source_facility") or "Malaffi HIE / Imported Table",
        "accession_id": item.get("accession_id") or f"IMP-{int(now.timestamp())}",
        "clinician_suggestion": item.get("clinician_suggestion") or "Dr. Layla Al-Hashimi (OB-GYN)",
        "summary_note": item["summary_note"],
        "recorded_at": now,
    }
    engine = get_engine()
    if engine is None:
        _MEMORY_EVIDENCE[:] = [e for e in _MEMORY_EVIDENCE if e["id"] != record["id"]]
        _MEMORY_EVIDENCE.append(record)
        return dict(record)
    ensure_schema_and_seed()
    with engine.begin() as conn:
        conn.execute(
            clinical_evidence_table.delete().where(clinical_evidence_table.c.id == record["id"])
        )
        conn.execute(clinical_evidence_table.insert().values(**record))
    return dict(record)


def reset_obligations(patient_id: str = "PAT-AE-4092") -> dict[str, Any]:
    """Reset synthetic demo data back to initial preconception state."""
    now = datetime.now(UTC)
    engine = get_engine()
    if engine is None:
        _MEMORY_STORE.clear()
        _MEMORY_STORE.extend([{**item, "updated_at": now} for item in ALL_SEED_OBLIGATIONS])
        _MEMORY_AUDIT.clear()
        _MEMORY_AUDIT.extend(
            [
                {"id": idx + 1, **item, "created_at": now}
                for idx, item in enumerate(SEED_AUDIT_EVENTS)
            ]
        )
        _MEMORY_EVIDENCE.clear()
        _MEMORY_EVIDENCE.extend([{**item, "recorded_at": now} for item in SEED_CLINICAL_EVIDENCE])
    else:
        ensure_schema_and_seed()
        with engine.begin() as conn:
            conn.execute(obligations_table.delete())
            conn.execute(audit_events_table.delete())
            conn.execute(clinical_evidence_table.delete())
            conn.execute(
                obligations_table.insert(),
                [{**item, "updated_at": now} for item in ALL_SEED_OBLIGATIONS],
            )
            conn.execute(
                audit_events_table.insert(),
                [{**item, "created_at": now} for item in SEED_AUDIT_EVENTS],
            )
            conn.execute(
                clinical_evidence_table.insert(),
                [{**item, "recorded_at": now} for item in SEED_CLINICAL_EVIDENCE],
            )

    obls = list_obligations(patient_id=patient_id)
    obl_ids = None if patient_id == "ALL" else {str(o["id"]) for o in obls}
    return {
        "patient_id": patient_id,
        "obligations": obls,
        "audit_events": list_audit_events(obligation_ids=obl_ids),
        "patients": list_patient_summaries(),
        "cohort_totals": query_patients(limit=1)["cohort_totals"],
    }
