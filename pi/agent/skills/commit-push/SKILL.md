---
name: commit-push
description: Commit and push the current repository's task-related changes. Use when the user asks to commit and push, save and push, or invokes commit-push.
---

# Commit and Push

1. Inspect `git status`, the relevant diff, the current branch, and its upstream.
2. Include only changes made for the current task. Never stage unrelated files; ask if ownership is ambiguous.
3. Run the smallest relevant validation if it has not already passed.
4. Stage explicit paths—never use `git add .` or `git add -A`.
5. Commit with a concise imperative message describing the change. Do not amend or bypass hooks unless explicitly requested.
6. Push the current branch to its upstream. If it has none, use `git push -u origin <branch>`. Never force-push unless explicitly requested.
7. Report the commit hash, destination branch, and any changes left uncommitted.

If there is nothing to commit, push any unpushed commits and report that no new commit was created.
