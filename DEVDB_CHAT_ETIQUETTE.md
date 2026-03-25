# DevDB — Chat & Workflow Etiquette

## Claude Code message delivery rule

Every message intended for Claude Code must be delivered in a **single rendered iframe with a copy button in the upper right corner.**

- Never split a CC instruction across multiple blocks or prose sections
- Never mix CC instructions with surrounding prose — the iframe contains only what CC needs
- The copy button must capture the entire message in one click

This rule exists to prevent partial copy-paste errors when handing off to Claude Code.

## Seam-mapping before coding rule

Before writing any new code on the shell/kernel refactor:

1. Produce a **current-to-target file map** — which files stay as shell, which get split, which are new, which are untouched
2. Produce a **function ownership map** — for each current function: keep as-is / move behind kernel interface / wrap with validator / replace
3. Produce a **minimal slice plan** — smallest runnable path proving real lot assignment, temp lot generation, proposal validation, persistence

Only after the map is reviewed and confirmed does new code get written.

## Files to request for seam mapping

- Coordinator / runner (outer loop)
- Demand allocation + temp lot generation module(s)
- Persistence writer
- Test / scenario runner (even informal)

## Document set (v1, clean start)

- `DevDB_Architecture_v1.docx` — founding architecture spec
- `DevDB_PlanningKernel_BoundarySpec.docx` — kernel boundary reference
- `DevDB_Scenario_Pack` — truth cases / regression suite
- This file — workflow conventions
