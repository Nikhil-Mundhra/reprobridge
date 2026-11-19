import os
from datetime import datetime, timezone
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
    create_engine,
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
    raw_url = os.getenv("DATABASE_URL_UNPOOLED", "").strip() or os.getenv("DATABASE_URL", "").strip()
    if not raw_url:
        return None
    return create_engine(
        _normalize_database_url(raw_url),
        poolclass=NullPool,
        pool_pre_ping=True,
    )


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
]

_MEMORY_STORE: list[dict[str, Any]] = [
    {**item, "updated_at": datetime.now(timezone.utc)} for item in SEED_OBLIGATIONS
]
_MEMORY_AUDIT: list[dict[str, Any]] = [
    {"id": idx + 1, **item, "created_at": datetime.now(timezone.utc)}
    for idx, item in enumerate(SEED_AUDIT_EVENTS)
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
    with direct_engine.begin() as conn:
        existing = conn.execute(select(obligations_table.c.id).limit(1)).first()
        if existing is None:
            now = datetime.now(timezone.utc)
            conn.execute(
                obligations_table.insert(),
                [{**item, "updated_at": now} for item in SEED_OBLIGATIONS],
            )
            conn.execute(
                audit_events_table.insert(),
                [{**item, "created_at": now} for item in SEED_AUDIT_EVENTS],
            )
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


def list_obligations() -> list[dict[str, Any]]:
    engine = get_engine()
    if engine is None:
        return [dict(item) for item in _MEMORY_STORE]
    ensure_schema_and_seed()
    with engine.connect() as conn:
        rows = conn.execute(
            select(obligations_table).order_by(obligations_table.c.id)
        ).mappings()
        return [dict(row) for row in rows]


def list_audit_events() -> list[dict[str, Any]]:
    engine = get_engine()
    if engine is None:
        return list(reversed([dict(item) for item in _MEMORY_AUDIT]))
    ensure_schema_and_seed()
    with engine.connect() as conn:
        rows = conn.execute(
            select(audit_events_table).order_by(audit_events_table.c.id.desc())
        ).mappings()
        return [dict(row) for row in rows]


def append_audit_event(
    event_type: str,
    actor: str,
    summary: str,
    obligation_id: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
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
    updates = {**updates, "updated_at": datetime.now(timezone.utc)}
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
        row = conn.execute(
            select(obligations_table).where(obligations_table.c.id == obligation_id)
        ).mappings().first()
        return dict(row) if row else None


def reset_obligations() -> dict[str, Any]:
    """Reset synthetic demo data back to initial preconception state."""
    now = datetime.now(timezone.utc)
    engine = get_engine()
    if engine is None:
        _MEMORY_STORE.clear()
        _MEMORY_STORE.extend([{**item, "updated_at": now} for item in SEED_OBLIGATIONS])
        _MEMORY_AUDIT.clear()
        _MEMORY_AUDIT.extend(
            [
                {"id": idx + 1, **item, "created_at": now}
                for idx, item in enumerate(SEED_AUDIT_EVENTS)
            ]
        )
        return {
            "obligations": [dict(item) for item in _MEMORY_STORE],
            "audit_events": list_audit_events(),
        }
    ensure_schema_and_seed()
    with engine.begin() as conn:
        conn.execute(obligations_table.delete())
        conn.execute(audit_events_table.delete())
        conn.execute(
            obligations_table.insert(),
            [{**item, "updated_at": now} for item in SEED_OBLIGATIONS],
        )
        conn.execute(
            audit_events_table.insert(),
            [{**item, "created_at": now} for item in SEED_AUDIT_EVENTS],
        )
    return {
        "obligations": list_obligations(),
        "audit_events": list_audit_events(),
    }
