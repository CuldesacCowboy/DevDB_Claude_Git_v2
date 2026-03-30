import subprocess, pathlib, datetime

repo = pathlib.Path(__file__).parent
today = datetime.date.today().isoformat()

def git(cmd):
    r = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, shell=True)
    return r.stdout.strip()

log = git('git log --since="8 hours ago" --oneline')
changed = git('git diff --name-only HEAD~5 HEAD')

if not log:
    log = git('git log -5 --oneline')

handoff = f"""# DevDB Session Handoff
**Date:** {today}

## What was completed
{log if log else "No commits in last 8 hours"}

## Files changed
{changed if changed else "No file changes detected"}

## What is NOT yet working
- DELETE /phases/{{phase_id}}/lot-type/{{lot_type_id}} returns 404 —
  route exists in phases.py but does not appear in OpenAPI spec.
  Top priority next session.

## Recommended next task
Fix the DELETE lot-type route registration. Read full contents of:
  devdb_python/api/routers/phases.py
  devdb_python/api/main.py
Before writing any code.

## How to start next session
1. Double-click Start_DevDB_Session.bat
2. Type task when prompted
3. Paste DevDB_SessionHandoff.md into Claude Desktop (this file)
4. Paste DevDB_SessionBrief.md into Claude Desktop after CC writes it
"""

out = repo / 'DevDB_SessionHandoff.md'
out.write_text(handoff, encoding='utf-8')
print(f'Written: {out}')
