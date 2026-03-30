Run the end-of-session workflow in order. Do not skip any step.

1. Ask me: "Any decisions or rules to log? (Enter to skip)" — wait for my answer.

2. Run: git log --since="8 hours ago" --oneline
   These are the commits completed this session.

3. Run: git diff --name-only HEAD~5 HEAD
   These are the files that changed.

4. Update CLAUDE.md:
   a) Update the Current Build Status table based on step 2 commits. Mark completed items as Complete.
   b) Update the Last commit date for every file in the File Manifest that appears in step 3 output.
   c) If I gave you decisions in step 1, append each to the Decision Log with the next available D-number.
   d) Update the Last updated date and Next ID at the top of CLAUDE.md.

5. git add -A, commit with message "session end: [brief summary of what was done]", git push.

6. Ask me: "Start a new session? (y / Enter = no)" — wait for my answer.

7. If I answered y:
   Ask me: "Keep this session open? (y / Enter = no)" — wait for my answer.
   Then run this to open the new session as a tab in this Windows Terminal window:
   wt.exe -w 0 new-tab cmd.exe /k "cd /d C:\DevDB_Claude_Git_v2 && claude"
