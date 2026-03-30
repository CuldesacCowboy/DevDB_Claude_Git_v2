import sys
import subprocess
import pathlib
import shutil

prompt = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')

# Find claude executable — check common Windows locations
claude_cmd = shutil.which('claude')
if not claude_cmd:
    # npm global install location on Windows
    candidates = [
        pathlib.Path.home() / 'AppData/Roaming/npm/claude.cmd',
        pathlib.Path.home() / 'AppData/Roaming/npm/claude',
        pathlib.Path('C:/Users') / pathlib.Path.home().name / 'AppData/Roaming/npm/claude.cmd',
    ]
    for c in candidates:
        if c.exists():
            claude_cmd = str(c)
            break

if not claude_cmd:
    print('ERROR: claude executable not found.')
    print('Run "where claude" in a terminal to find it, then hardcode the path in devdb_run_claude.py')
    sys.exit(1)

subprocess.run([claude_cmd, '-p', prompt], check=True)
