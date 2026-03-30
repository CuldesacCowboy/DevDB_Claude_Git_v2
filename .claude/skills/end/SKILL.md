---
name: end
description: DevDB session end — updates CLAUDE.md, commits, pushes
---

Run the end-of-session workflow in order. Do not skip any step.

The user may have typed decisions or rules after the /end command. If so, those are the decisions to log in step 4c. If nothing was typed after /end, skip 4c.

1. Run: git log --since="8 hours ago" --oneline
   These are the commits completed this session.

2. Run: git diff --name-only HEAD~5 HEAD
   These are the files that changed.

3. Update CLAUDE.md:
   a) Update the Current Build Status table based on step 1 commits. Mark completed items as Complete.
   b) Update the Last commit date for every file in the File Manifest that appears in step 2 output.
   c) If the user provided decisions, append each to the Decision Log with the next available D-number.
   d) Update the Last updated date and Next ID at the top of CLAUDE.md.

4. git add -A, commit with message "session end: [brief summary of what was done]", git push.
