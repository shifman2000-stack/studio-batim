// src/lib/templateSeeding.js
//
// Guards the lazy template seeding used by the three spec tabs.
//
// ── THE PROBLEM ──────────────────────────────────────────────────────
// Each tab seeds itself from its template table when the project has no
// rows, and the condition is literally "this project has zero rows":
//
//     const { count } = await supabase.from(<table>)
//       .select('*', { count: 'exact', head: true })
//       .eq('project_id', projectId)
//     if (count === 0) { …insert every template row… }
//
// That is fine for a brand-new project, but it cannot tell "never
// filled in" apart from "deliberately emptied". Delete the last
// remaining category and the tab is back to zero rows, so the next open
// re-creates every template row and the deletion looks undone.
//
// Deleting any category that is NOT the last one was always safe — the
// count stays above zero, so nothing re-seeds.
//
// ── THE FIX ──────────────────────────────────────────────────────────
// A per-project, per-tab boolean on `projects` that records "this tab
// has been populated at least once". Seeding then requires zero rows AND
// a project that was never populated, so an emptied tab stays empty.
//
// The flag is set whenever a tab observes content — either because it
// just seeded, or because it loaded rows that were already there — so
// projects that predate the flag are marked the first time they are
// opened, not just newly-seeded ones.
//
// ── BEFORE THE MIGRATION IS RUN ──────────────────────────────────────
// Both helpers are deliberately tolerant: if the column does not exist
// yet, hasSeeded() returns null and the caller falls back to today's
// count-only behaviour, and markSeeded() quietly does nothing. So the
// tabs keep working unchanged until db/migrations/template_seed_flags.sql
// is applied, and the guard switches itself on once it is.

import { supabase } from '../supabaseClient'

/* projects column per tab. Values are the migration's column names. */
export const SEED_FLAGS = {
  quantities:     'quantities_seeded',
  finishing:      'finishing_seeded',
  contractorSpec: 'contractor_spec_seeded',
}

/**
 * Has this tab ever been populated for this project?
 *
 * @returns {Promise<boolean|null>} true / false, or NULL when the answer
 *   is unknown (column not migrated yet, or the read failed). Callers
 *   MUST treat null as "unknown" and fall back, never as "false".
 */
export async function hasSeeded(projectId, flagColumn) {
  if (!projectId || !flagColumn) return null
  try {
    const { data, error } = await supabase
      .from('projects')
      .select(flagColumn)
      .eq('id', projectId)
      .single()
    if (error) return null           /* includes "column does not exist" */
    return data?.[flagColumn] === true
  } catch {
    return null
  }
}

/**
 * Record that this tab now has content for this project. Idempotent, and
 * a no-op when the column is missing. Never throws — failing to set the
 * flag must not break loading the tab.
 */
export async function markSeeded(projectId, flagColumn) {
  if (!projectId || !flagColumn) return
  try {
    await supabase
      .from('projects')
      .update({ [flagColumn]: true })
      .eq('id', projectId)
  } catch {
    /* ignored on purpose — see above */
  }
}

/**
 * The seed decision, in one place so the three tabs cannot drift.
 *
 *   rowCount > 0        → never seed (there is already content)
 *   seeded === true     → never seed (emptied on purpose)
 *   seeded === false    → seed (a project that never had content)
 *   seeded === null     → unknown; fall back to the old count-only rule
 *
 * @param {number} rowCount rows this project already has in the tab
 * @param {boolean|null} seeded result of hasSeeded()
 */
export function shouldSeed(rowCount, seeded) {
  if (rowCount !== 0) return false
  return seeded !== true
}
