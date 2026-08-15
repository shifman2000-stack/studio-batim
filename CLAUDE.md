## Safety guardrail — always ask before these actions
Even though permission prompts are disabled (bypassPermissions mode), you must NOT do the following without first explicitly asking the user in plain text and getting a clear "yes"/"כן":
- `git push` (to any remote/branch)
- Any Supabase migration or schema-changing operation (`apply_migration`, `create_branch`, `delete_branch`, `merge_branch`, `rebase_branch`, `reset_branch`, or raw DDL via `execute_sql`) — this applies to BOTH Dev and Prod Supabase projects
- `create_project`, `pause_project`, or `restore_project` on Supabase
- Deploying edge functions (`deploy_edge_function`)

For all of the above: stop, describe exactly what you're about to do and why, and wait for the user's explicit confirmation before proceeding. Everything else (local file edits, git add/commit, npm/build/test commands, reading data, Supabase read-only queries) can proceed without asking.
