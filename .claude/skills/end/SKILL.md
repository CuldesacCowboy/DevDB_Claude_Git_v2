---
name: end
description: DevDB session end — updates CLAUDE.md and relevant file-manifest docs, commits, pushes
---

Run the end-of-session workflow in order. Do not skip any step.

The user may have typed decisions or rules after the /end command. If so, those are the decisions to log in step 3c. If nothing was typed after /end, skip 3c.

1. Run: git log --since="8 hours ago" --oneline
   These are the commits completed this session.

2. Run: git diff --name-only HEAD~5 HEAD
   These are the files that changed.

3. Update `CLAUDE.md`:
   a) Update the Current Build Status table based on step 1 commits. Mark completed items as Complete.
   b) If the user provided decisions, append each to the Decision Log in `.claude/docs/decision-log.md` with the next available D-number, and update the header line in CLAUDE.md (Next ID: D-XXX).
   c) Update the Last updated date at the top of CLAUDE.md.

4. Update the relevant split file-manifest docs. Use this table to determine which manifest file(s) to update based on step 2 output:

   | Changed file path | Manifest to update |
   |---|---|
   | devdb_ui/src/* | `.claude/docs/file-manifest-frontend.md` |
   | devdb_python/api/* or devdb_python/services/* | `.claude/docs/file-manifest-backend.md` |
   | devdb_python/engine/* or devdb_python/kernel/* or devdb_python/tests/* | `.claude/docs/file-manifest-engine.md` |
   | devdb_python/migrations/* | `.claude/docs/file-manifest-migrations.md` |
   | *.bat, *.ps1, .claude/*, CLAUDE.md, requirements.txt | `.claude/docs/file-manifest-config.md` |

   For each relevant manifest:
   a) Update the Last commit date for every file that appears in step 2 output.
   b) Add an entry for any new file that appears in step 2 output but is not yet in the manifest.

5. git add -A, commit with message "session end: [brief summary of what was done]", git push.
