# DevDB File Manifest — Docs, Config & Session Tooling

Load when working on: session tooling, bat/ps1 scripts, CLAUDE.md, skill files, or root-level configuration.

---

### CLAUDE.md
- Owns: Primary session bootstrap — architecture rules, decision log, build status. Reference docs extracted to .claude/docs/
- Last commit: 2026-04-03

### .claude/docs/file-manifest-backend.md
- Owns: File manifest for devdb_python/api/ (routers, models, services)
- Last commit: 2026-04-03

### .claude/docs/file-manifest-frontend.md
- Owns: File manifest for devdb_ui/src/ (pages, components, hooks, utils)
- Last commit: 2026-04-03

### .claude/docs/file-manifest-engine.md
- Owns: File manifest for devdb_python/engine/, kernel/, tests/
- Last commit: 2026-04-03

### .claude/docs/file-manifest-migrations.md
- Owns: File manifest for devdb_python/migrations/
- Last commit: 2026-04-03

### .claude/docs/file-manifest-config.md
- Owns: File manifest for docs, config, session tooling (this file)
- Last commit: 2026-04-03

### .claude/docs/api-contract.md
- Owns: FastAPI router contracts — all endpoints, tables, guards, response shapes
- Last commit: 2026-04-01

### .claude/docs/engine-reference.md
- Owns: Engine-specific rules and reference — Gap-Fill, TDA, Simulation Engine Rules, Ledger View, Scenario Pack, Build Sequence, Engine Module Status, Databricks inventory
- Last commit: 2026-04-03

### .claude/docs/schema-reference.md
- Owns: Schema DDL, Entity Hierarchy, Building Group Mapping Status, Synthetic Test Fixtures
- Last commit: 2026-04-03

### .claude/docs/decision-log.md
- Owns: Full Key Decisions list (D-006 through D-154) and D-151–D-154 narrative blocks
- Last commit: 2026-04-03

### .claude/docs/workplan_ledger_entitlement_params_delivery.md
- Owns: Work plan tracking ledger balance, entitlement date model, parameter surfacing, and delivery scheduling tasks — created 2026-04-03
- Last commit: 2026-04-03

### .claude/skills/start/SKILL.md
- Owns: /start skill — reads CLAUDE.md and selected reference docs based on task; acknowledges today's task
- Last commit: 2026-04-03

### .claude/skills/end/SKILL.md
- Owns: /end skill — updates CLAUDE.md and split file-manifest docs, commits, pushes
- Last commit: 2026-04-03

### .claude/skills/devdb-start/SKILL.md
- Owns: /devdb-start skill — runs Start_DevDB.bat from a Claude Code session
- Last commit: 2026-04-15

### .claude/skills/devdb-stop/SKILL.md
- Owns: /devdb-stop skill — runs Stop_DevDB.bat from a Claude Code session
- Last commit: 2026-04-15

### .claude/skills/devdb-restart/SKILL.md
- Owns: /devdb-restart skill — runs Restart_DevDB.bat from a Claude Code session
- Last commit: 2026-04-15

### devdb_python/requirements.txt
- Owns: Python dependency list (fastapi, uvicorn, psycopg2, pandas, python-dotenv, pydantic, pytest)
- Last commit: 2026-03-26

### devdb_python/migrate_to_postgres.py
- Owns: One-time migration script from Databricks to local PostgreSQL 16; not run in normal operation
- Tables: all 35 tables (reads from Databricks, inserts to local Postgres)
- Last commit: 2026-03-25

### devdb_python/scripts/seed_developments.py
- Owns: One-time seed script populating the developments table from dim_development bridge
- Tables: developments (INSERT), dim_development (SELECT)
- Last commit: 2026-03-26

### devdb_python/scripts/backfill_community_id.py
- Owns: One-time script backfilling community_id on developments from sim_ent_group_developments
- Tables: developments (UPDATE), sim_ent_group_developments (SELECT)
- Last commit: 2026-03-26

### Start_DevDB.bat
- Owns: Windows batch file to start both uvicorn backend and Vite frontend in one command
- Last commit: 2026-03-28

### Stop_DevDB.bat
- Owns: Windows batch file to stop backend (uvicorn + detached python.exe on port 8765), frontend (Vite), and Chrome DevDB windows; uses PowerShell + taskkill /F /T
- Last commit: 2026-04-03

### Start_DevDB_Session.bat
- Owns: Session startup bat — opens DevDB session windows via devdb_open_session_windows.ps1
- Last commit: 2026-03-30

### devdb_open_session_windows.ps1
- Owns: PowerShell script that opens all DevDB session windows (backend terminal, frontend terminal, browser, Claude Code terminal snapped to right half of right screen)
- Last commit: 2026-03-30

### 01_schema_create_postgres.sql
- Owns: Reference copy of the full PostgreSQL schema DDL (not run by migration runner -- archival only)
- Tables: all core tables (CREATE reference)
- Last commit: 2026-03-25
