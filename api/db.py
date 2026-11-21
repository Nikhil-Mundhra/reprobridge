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
    Column("verified_by", String(128), nullable=True),
    Column("closure_evidence", Text, nullable=True),
    Column("updated_at", DateTime(timezone=True), nullable=False),
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
        "clinical_track": "Metabolic & Varicella Continuity",
        "facility_a": "Al Bateen Primary Clinic",
        "facility_b": "Corniche OB-GYN",
        "id_base": 200,
    },
    "PAT-AE-6304": {
        "patient_id": "PAT-AE-6304",
        "patient_name": "Sara Al-Nuaimi (Synthetic)",
        "age_sex": "36Y · F",
        "clinical_track": "Preeclampsia & HPV Continuity",
        "facility_a": "Khalifa City Family Medicine",
        "facility_b": "Danat Al Emarat Maternity",
        "id_base": 300,
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
        "title": "Preconception Dysglycemia Follow-up (Fasting Glucose 112 mg/dL · HbA1c 6.1%)",
        "rationale": (
            "Preconception panel showed impaired fasting glucose (112 mg/dL) and HbA1c 6.1%. "
            "Requires early first-trimester 75g OGTT and medical nutrition / endocrine titration "
            "upon pregnancy confirmation."
        ),
        "evidence_source": "FHIR Observation/obs-hba1c-2026-09 (Malaffi HIE Synthetic)",
        "rule_version": "RB-METABOLIC-v1.2.0",
        "owner": "Primary Care / Endocrinology",
        "status": "OPEN",
        "priority": "HIGH",
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
        "verified_by": None,
        "closure_evidence": None,
    },
    {
        "id": "OBL-301",
        "patient_id": "PAT-AE-6304",
        "patient_name": "Sara Al-Nuaimi (Synthetic)",
        "life_stage": "Preconception",
        "title": "Preeclampsia Low-Dose Aspirin Prophylaxis Window (BP 138/88 mmHg)",
        "rationale": (
            "History of prior preterm preeclampsia and baseline BP 138/88 mmHg. Requires low-dose "
            "aspirin (150 mg nightly) initiated between 12 and 16 weeks gestation before placental "
            "remodeling window closes."
        ),
        "evidence_source": "FHIR Observation/obs-bp-2026-09 (Malaffi HIE Synthetic)",
        "rule_version": "RB-PREECLAMPSIA-v1.3.0",
        "owner": "Primary Care / Maternal-Fetal Medicine",
        "status": "OPEN",
        "priority": "HIGH",
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
        "actor": "RuleEngine (RB-METABOLIC-v1.2.0)",
        "summary": "Logged preconception dysglycemia (HbA1c 6.1%, FBG 112 mg/dL) obligation from FHIR Observation/obs-hba1c-2026-09.",
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
        "actor": "RuleEngine (RB-PREECLAMPSIA-v1.3.0)",
        "summary": "Logged preeclampsia low-dose aspirin window obligation (BP 138/88 mmHg) from FHIR Observation/obs-bp-2026-09.",
    },
    {
        "obligation_id": "OBL-302",
        "event_type": "CARE_GAP_DETECTED",
        "actor": "RuleEngine (RB-HPV-v1.1.0)",
        "summary": "Logged incomplete HPV 9-valent series (Dose 2/3) from FHIR ImmunizationRecommendation/rec-hpv-2026-08.",
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
        existing_ids = {row[0] for row in conn.execute(select(obligations_table.c.id)).all()}
        missing_obls = [
            {**item, "updated_at": now}
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
    except Exception as exc:  # noqa: BLE001
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
