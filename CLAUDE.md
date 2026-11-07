## Permissions policy
Approval is required ONLY for actions that can affect production: pushing to origin
(which triggers a Vercel deploy), deploying, and any database write in ANY environment
(Dev included). Everything local is pre-approved — file edits, git add/commit/branch/
checkout/merge, npm, node, builds, tests and read-only queries all proceed without
asking. The rules live in `.claude/settings.json` (committed) and
`.claude/settings.local.json` (per-machine, gitignored); `defaultMode` is `acceptEdits`.

## Safety guardrail — always ask before these actions
Regardless of the permission rules in effect, you must NOT do the following without
first explicitly asking the user in plain text and getting a clear "yes"/"כן":
- `git push` (to any remote/branch)
- Any Supabase migration or schema-changing operation (`apply_migration`, `create_branch`, `delete_branch`, `merge_branch`, `rebase_branch`, `reset_branch`, or raw DDL via `execute_sql`) — this applies to BOTH Dev and Prod Supabase projects
- `create_project`, `pause_project`, or `restore_project` on Supabase
- Deploying edge functions (`deploy_edge_function`)

For all of the above: stop, describe exactly what you're about to do and why, and wait for the user's explicit confirmation before proceeding. Everything else (local file edits, git add/commit, npm/build/test commands, reading data, Supabase read-only queries) can proceed without asking.

## SPEED RULES
- Do only what the prompt asks. No refactors, no extracting shared code, no "while I'm here" improvements.
- Verification: run build + existing tests only. Do NOT build a headless browser lab, fixtures or seeded test data unless the prompt explicitly asks.
- Do not investigate side issues (e.g. checking master baseline). Mention them in one line and move on.
- If you hit a blocker that needs a design decision, stop and report instead of exploring alternatives.
- Never write to the Prod DB or Storage. Read-only SELECTs only.
- Before saying "no SQL needed" for any new value/column the code writes, check the Prod constraints read-only.
- Final report: max 10 lines.
