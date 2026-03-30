import sys, subprocess, pathlib
prompt = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
subprocess.run(['claude', '-p', prompt], check=True)
