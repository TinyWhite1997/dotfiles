# Work agent instructions

- Before making any code change, invoke the applicable `ponytail*` skill when available.
- This is a work-machine profile, not proof that every task is work-related. For personal tasks, do not query or write work memory. If the scope is unclear, ask before accessing memory.
- Follow repository instructions and company data-handling requirements.

## Work memory (paused)

- Hindsight is temporarily disabled. Do not discover its tools, recall, or retain work memory until explicitly re-enabled.
- Preserve existing memory data, credentials, and host configuration.

## Git push behavior

- After resolving merge conflicts or addressing PR review comments, push the branch when done without asking again.
- Preserve unrelated changes. Never force-push unless explicitly requested.
# Response to user
At the start of each session, read `~/.pi/agent/git/github.com/ayghri/i-have-adhd/skills/i-have-adhd/SKILL.md` and apply its ADHD-friendly output rules to every response by default. If the user explicitly disables ADHD mode, keep it disabled for the rest of that session unless they re-enable it.

