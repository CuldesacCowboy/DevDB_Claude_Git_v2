---
name: shortcuts
description: List all custom DevDB slash commands and run one by number
---

1. Read every SKILL.md file found under `.claude/skills/` (one per subdirectory).
   From each file extract the `name:` and `description:` frontmatter fields.
   Exclude the `shortcuts` skill itself from the list.
   Sort the results by name alphabetically.

2. Display the discovered skills as a numbered menu:

   ```
   DevDB commands:

     1  /name-of-skill    description from frontmatter
     2  /name-of-skill    description from frontmatter
     ...
   ```

3. Ask: "Run which number? (or press Enter to cancel)"

4. Wait for the user's response. Then invoke the skill whose number matches,
   or say "Cancelled." and stop if the input is blank or not a valid number.
