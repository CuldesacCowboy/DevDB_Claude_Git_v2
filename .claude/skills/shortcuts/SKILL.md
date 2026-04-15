---
name: shortcuts
description: List all custom DevDB slash commands and run one by number
---

Display this menu exactly, then ask the user which number to run:

```
DevDB commands:

  1  /start          Start of session — load context, read docs, acknowledge task
  2  /end            End of session — update CLAUDE.md, manifests, commit, push
  3  /devdb-start    Start backend + frontend servers, open Chrome
  4  /devdb-stop     Stop servers, close DevDB Chrome window
  5  /devdb-restart  Restart servers (stop then start fresh)
```

Ask: "Run which number? (or press Enter to cancel)"

Wait for the user's response. Then:
- 1 → invoke the `start` skill
- 2 → invoke the `end` skill
- 3 → invoke the `devdb-start` skill
- 4 → invoke the `devdb-stop` skill
- 5 → invoke the `devdb-restart` skill
- anything else or blank → say "Cancelled." and stop
