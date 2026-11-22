# AGENTS.md — ReproBridge

Guidance for AI coding agents working in the **ReproBridge** repository.

## 1. Project Overview

**ReproBridge** is a continuous, proactive, evidence-verified reproductive and preventive care coordination platform (built for the Ajyal Hackathon — Women's Health theme, Abu Dhabi DoH / Upstart Bo, aligned with Abu Dhabi's *Programme for the Future of Reproductive Health 2030*).

It demonstrates a longitudinal **Preconception → Pregnancy → Postpartum** synthetic patient journey (`PAT-AE-4092`, Amira Al-Mansoori — Synthetic) backed by:
- Deterministic, version-controlled clinical transition rules
- A **Clinical Obligation Passport** with incoming FHIR/HIE clinical evidence and clinician sign-off
- A **UAE PHI De-Identification Firewall** (`UAE_PHI_LOCAL_ONLY`) gating all external LLM calls
- A governed **Neon Postgres MCP** tool surface (de-identified reads + append-only audit notes)

---

## 2. Repository Structure

| Path | Role |
| --- | --- |
| `api/index.py` | FastAPI app (`app`), REST & SSE streaming endpoints, Pydantic request models, clinical closure safety guards, MCP JSON-RPC route. |
| `api/db.py` | SQLAlchemy Core tables (`clinical_obligations`, `audit_events`, `clinical_evidence`), Neon Postgres pooled/direct engines, seed data, and in-memory fallback. |
| `api/workflow.py` | 4-node hybrid LangGraph `transition_workflow` (`detect_open_obligations` → `evaluate_life_stage_transition` → `apply_uae_privacy_firewall` → `synthesize_coordination_brief`). |
| `api/privacy.py` | UAE PHI De-Identification Firewall (`PHI_FIELDS`, regex scrubbers, `pseudonymize_patient_id`, `deidentify_obligation`, `build_ai_safe_payload`, `assert_phi_free`). |
| `api/openrouter.py` | OpenRouter LLM client (batch JSON + SSE token streaming, default `google/gemma-4-31b-it:free` with free fallbacks) and `_deterministic_fallback`. |
| `api/mcp_server.py` | Governed MCP JSON-RPC 2.0 server exposing 4 tools (`neon_get_deidentified_obligations`, `neon_get_rule_catalog`, `neon_get_audit_summary`, `neon_record_agent_brief`). |
| `src/App.tsx` | Top-level hash router (`#demo` → `PrototypeDemo`, default → `TutorialHome`). |
| `src/TutorialHome.tsx` | Guided product overview & walkthrough landing page. |
| `src/PrototypeDemo.tsx` | Interactive clinical workbench (Clinical Obligation Passport, life-stage transitions, SSE streaming brief, trace inspector, PHI diff, evidence intake/CSV import, audit timeline). |
| `src/spatialNav.ts` | Geometry-based 2D arrow-key / Home / End keyboard navigation utility for composite widgets. |
| `src/index.css` | Tailwind CSS v4 entry (`@import "tailwindcss";`) + accessible spinner, subgrid trace layout, and reduced-motion micro-interactions. |
| `tests/` | Pytest suite: `test_privacy.py`, `test_mcp.py`, `test_agent_harness.py`, `test_api_functional.py`. |
| `vercel.json` | Vercel deployment config (`/api/*` → `/api/index.py`, SPA rewrite → `/index.html`, builds `dist/`). |
| `neon.ts` | `@neon/config` branch policy (`auth: false`, 7-day TTL on non-default branches). |

---

## 3. Non-Negotiable Clinical Safety & Privacy Invariants

Every change to backend, AI orchestration, MCP tools, or API payloads **must** preserve these invariants:

1. **Zero PHI Egress (`UAE_PHI_LOCAL_ONLY`)**
   - Never transmit raw PHI (`patient_name`, `patient_id`, `emirates_id`, `mrn`, `dob`, `phone`, `email`, `evidence_source`, `verified_by`, `closure_evidence`, UAE phone numbers, Emirates IDs `784-YYYY-NNNNNNN-C`, or `PAT-*` IDs) to OpenRouter or any external AI service.
   - All external AI payloads must be built via `api.privacy.build_ai_safe_payload()` and pass `api.privacy.assert_phi_free()` immediately before egress.
   - Any new clinical/patient field containing identifying data must be added to `PHI_FIELDS` in `api/privacy.py` and covered by `tests/test_privacy.py`.

2. **Deterministic Clinical Rules Only**
   - Life-stage transitions (`evaluate_life_stage_transition` in `api/workflow.py`) must remain 100% deterministic and version-controlled (`rule_version`).
   - LLMs are strictly assistive: they draft de-identified coordination summaries and specialist handoff checklists. They must **never** diagnose, prescribe, or directly mutate clinical obligation status/priority.

3. **Evidence-Verified Human-in-the-Loop Closure**
   - AI agents and MCP tools (`api/mcp_server.py`) must **never** be given tools that close, delete, or alter clinical obligations, or read raw PHI. Write access for agents is strictly append-only scrubbed audit entries (`neon_record_agent_brief`).
   - Clinician closure (`POST /api/obligations/{obligation_id}/verify`) must enforce clinical safety guards (e.g., returning `409 Conflict` when attempting to close a `DEFERRED_TO_POSTPARTUM` live-vaccine obligation during pregnancy).

4. **Graceful Deterministic Fallback**
   - If `OPENROUTER_API_KEY` is unset or OpenRouter fails/times out, both batch (`/api/transitions/*`) and SSE streaming (`/api/transitions/*/stream`) endpoints must complete cleanly using `_deterministic_fallback` without blocking deterministic rule persistence.

---

## 4. Development & Verification Commands

### Local Development
```bash
# Backend (FastAPI on port 8000)
.venv/bin/uvicorn api.index:app --reload --port 8000

# Frontend (Vite dev server; proxies /api -> http://127.0.0.1:8000)
npm run dev
```

### Verification (Definition of Done — Run Before Completing Work)
A task is NOT complete until every relevant check below passes with zero errors:

```bash
# Backend lint, formatting, static types, and tests (run when modifying api/ or tests/)
.venv/bin/ruff check --fix api tests
.venv/bin/ruff format --check api tests   # run `.venv/bin/ruff format api tests` if formatting fails
.venv/bin/ty check api tests
.venv/bin/pytest -q

# Frontend strict TypeScript check + production bundle (run when modifying src/)
npm run build
```

- Tests isolate themselves from live Neon/OpenRouter by clearing `DATABASE_URL` and `OPENROUTER_API_KEY` via `monkeypatch` so they run fast and deterministically against the in-memory fallback.
- Do not silence lint or type rules (`# noqa`, `# type: ignore`, `# ty: ignore`) unless you include a short inline comment explaining why.

---

## 5. Architecture & Implementation Conventions

### Python Engineering Rules (`api/` & `tests/`)
- **Modern Python (3.11+ syntax)**: Use built-in generics (`list[str]`, `dict[str, Any]`) and union syntax (`X | None`). Never import `List`, `Dict`, `Optional`, or `Union` from `typing`. Use `datetime.UTC` instead of `timezone.utc`.
- **Keep `api/` flat (No structural drift)**: Extend the existing 6 modules (`api/index.py`, `api/db.py`, `api/workflow.py`, `api/privacy.py`, `api/openrouter.py`, `api/mcp_server.py`). Do not invent new subdirectories (`api/routers/`, `api/services/`, `api/utils/`) unless explicitly asked.
- **One canonical tool per task (do not improvise alternatives)**:
  - **Schemas & boundaries**: Pydantic v2 (`BaseModel` with `Field(...)`) for API/MCP request boundaries, `TypedDict` for LangGraph state (`TransitionState`), and `@dataclass(slots=True)` for simple internal objects.
  - **HTTP client**: `httpx` with explicit timeouts. Never use `requests` or `urllib`.
  - **File paths**: `pathlib.Path`. Never use `os.path`.
  - **Strings & logging**: Use f-strings (never `%` or `.format()`) and `logging` (never leave `print()` in `api/`).
  - **Tests**: `pytest` with plain `assert` statements and `monkeypatch` fixtures. Never use `unittest.TestCase`.
- **Code & safety constraints**:
  - Explicitly type all function parameters and return types.
  - Never use mutable default arguments (`def f(x=[])`) or bare `except:`. Catch specific exceptions with context.
  - Always use context managers (`with`) for files, HTTP clients, and database connections. Never mix blocking I/O into `async def` functions.
  - Manage environments with `uv` (`pyproject.toml` is the source of truth), and keep `requirements.txt` in sync because Vercel's Python runtime installs from `requirements.txt`.

### Backend & Neon PostgreSQL (`api/`)
- **Serverless pooling**: Runtime queries use `get_engine()` (`DATABASE_URL` pooled via Neon PgBouncer) with `NullPool` and `connect_args={"prepare_threshold": None}` (required for `psycopg` v3 on PgBouncer transaction mode).
- **DDL & migrations**: Schema creation and seeding (`ensure_schema_and_seed()`) must use `get_direct_engine()` (`DATABASE_URL_UNPOOLED`) — never run DDL over the pooled connection.
- **Dual storage parity**: `api/db.py` supports both Neon PostgreSQL and an in-memory fallback (`_MEMORY_STORE`, `_MEMORY_AUDIT`, `_MEMORY_EVIDENCE`) when `DATABASE_URL` is unset. Any new query or mutation in `api/db.py` must implement **both** paths identically.
- **SSE streaming**: Streaming endpoints (`/api/transitions/*/stream`) run deterministic nodes 1–3 and persist updates first, emit `event: deterministic_complete`, stream `event: token` deltas from OpenRouter, and finish with `event: complete` (keeping `Cache-Control: no-cache` and `X-Accel-Buffering: no`).

### Frontend (`src/`)
- **Strict TypeScript**: `tsconfig.json` enforces `strict: true`, `noUnusedLocals: true`, and `noUnusedParameters: true`.
- **Styling & Accessibility**: Uses Tailwind CSS v4 (`@tailwindcss/vite`) and custom utilities in `src/index.css`. Respect `@media (prefers-reduced-motion: ...)` and `@media (forced-colors: active)` for all animations and indicators.
- **Spatial Keyboard Navigation**: Interactive grids/cards use `src/spatialNav.ts`. Do not call `preventDefault()` when no candidate exists in the pressed direction (preserves native scrolling), and always ignore modifier keys and editable/arrow-consuming inputs.
- **Targeted Edits**: `src/PrototypeDemo.tsx` is a single ~2.6k-line file; prefer surgical edits over broad refactors unless explicitly requested.

### Security & Repo Hygiene
- All seeded patient data is strictly **synthetic**. Never commit real PHI or secrets (`.env`, `.env.local`, `.neon` are gitignored; document new env vars in `.env.example`).
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `ui:`).

---

## 6. Local Project Skills (`.agents/skills/`)

When relevant to the task, consult the workspace skills in `.agents/skills/`:
- `edge-case-review` — Pre-implementation spec review and diff/API/UI failure-mode auditing.
- `data-quality-and-contract-testing` — Schema, ingestion, and contract validation.
- `quality-assurance` — Testing patterns and static checks.
- `glassmorphism-ui` — Translucent/frosted surface styling and WCAG 2.2 AA contrast safeguards.
- `hackathon-judge` — Pitch/demo/architecture stress-testing against Ajyal Hackathon criteria.
- `humanizer` — Tightening prose and removing AI writing tells.
