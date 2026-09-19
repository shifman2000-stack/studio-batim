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
