# DevDB File Manifest — Index

The file manifest has been split into task-specific files to reduce context load per session.
Load only the file(s) relevant to your current task.

| File | Contents | Load when |
|---|---|---|
| `file-manifest-frontend.md` | devdb_ui/src/ — pages, components, hooks, utils, Vite | React, UI, site plan, lot phase, TDA, simulation view |
| `file-manifest-backend.md` | devdb_python/api/ — routers, models, services | FastAPI, endpoints, API routes, backend logic |
| `file-manifest-engine.md` | devdb_python/engine/, kernel/, tests/ | Simulation engine, coordinator, kernel, tests |
| `file-manifest-migrations.md` | devdb_python/migrations/ | Schema changes, DDL, migration history |
| `file-manifest-config.md` | Root scripts, session tooling, skill files, docs | bat/ps1, CLAUDE.md, session start/end, config |

The `/start` skill selects the correct file(s) automatically based on task keywords.
