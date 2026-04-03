---
name: start
description: DevDB session startup — reads CLAUDE.md and selected reference docs based on task, then acknowledges today's task
---

Run the start-of-session workflow in order.

1. Read `CLAUDE.md` in full. Pay attention to: Current Build Status table, Pill Sizing Rule, Rules for Claude Code Sessions, and Schema Change Rules.

2. Based on the task description, read the relevant reference docs from `.claude/docs/`. Use this keyword table to decide which to load:

   | Task keywords | Docs to load |
   |---|---|
   | "site plan", "PDF", "phase panel", "lot bank", "PdfCanvas", "rotation", "boundary" | `file-manifest-frontend.md` |
   | "simulation view", "ledger", "LotPhaseView", "TDA", "react", "UI", "component", "hook" | `file-manifest-frontend.md` |
   | "API", "endpoint", "router", "backend", "FastAPI", "Pydantic" | `file-manifest-backend.md` + `api-contract.md` |
   | "engine", "coordinator", "P-0000", "S-0600", "starts pipeline", "supply pipeline" | `file-manifest-engine.md` + `engine-reference.md` |
   | "migration", "schema change", "ALTER", "CREATE TABLE", "new column" | `file-manifest-migrations.md` + `schema-reference.md` |
   | "test", "fixture", "scenario pack", "building group" | `file-manifest-engine.md` + `schema-reference.md` |
   | "decision", "why", "D-1", "D-0", "TDA lock", "delivery schedule" | `decision-log.md` |
   | "session tooling", "CLAUDE.md", "bat", "ps1", "start/end skill" | `file-manifest-config.md` |

   When in doubt, load the most relevant one or two. Do not load all of them.

3. Read `.claude/docs/api-contract.md` if the task involves FastAPI routers or endpoint contracts (and not already loaded in step 2).

4. Acknowledge the task and confirm you are ready to work.
