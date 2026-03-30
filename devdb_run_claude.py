import sys
import subprocess
import pathlib
import shutil

prompt = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')

# Find claude executable — check common Windows locations
claude_cmd = shutil.which('claude')
if not claude_cmd:
    candidates = [
        pathlib.Path.home() / 'AppData/Roaming/npm/claude.cmd',
        pathlib.Path.home() / 'AppData/Roaming/npm/claude.ps1',
        pathlib.Path.home() / 'AppData/Roaming/npm/claude',
    ]
    for c in candidates:
        if c.exists():
            claude_cmd = str(c)
            break

if not claude_cmd:
    print('ERROR: claude executable not found.')
    print('Run "Get-Command claude | Select-Object Source" in PowerShell to find it.')
    sys.exit(1)

# .ps1 scripts must be invoked via powershell.exe
if claude_cmd.endswith('.ps1'):
    subprocess.run(
        ['powershell', '-ExecutionPolicy', 'Bypass', '-File', claude_cmd, '-p', prompt],
        check=True,
    )
else:
    subprocess.run([claude_cmd, '-p', prompt], check=True)
