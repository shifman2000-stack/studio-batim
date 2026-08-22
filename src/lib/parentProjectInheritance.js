// src/lib/parentProjectInheritance.js
//
// Shared by every code path that establishes a parent_project_id link:
// ProjectsKanban.jsx (creating a child with a parent selected, or
// attaching an existing project to a parent) and Inquiries.jsx
// (converting an inquiry that already carries a parent_project_id into
// a project). Kept in one place so all call sites stay in sync —
// never duplicate this logic at a new call site.

import { supabase } from '../supabaseClient'

/* client_info columns eligible for one-time parent → child inheritance.
   Professional roles are carried by their _id FK only.

   This list used to also name 19 legacy columns — the planning fields
   (vaada, bodeket, tik_meida, tik_binyan, bakasha_pnimi, bakasha_vaada,
   bakasha_risuy, tik_haga, mahat_habakasha) and the free-text
   name/phone pairs that predate the professionals FK model
   (project_manager, surveyor, constructor, plumbing_engineer,
   soil_consultant and their _phone siblings).

   They were removed rather than added to Production, because they are
   dead:
     * NOTHING writes them. ProjectDetail's professional pickers write
       only the _id fields; no code path anywhere sets the free-text or
       planning columns.
     * The 9 planning fields are read by nothing at all — they appeared
       in this constant and nowhere else. (`tik_meida` also exists as a
       Gantt point id in gridDefinition.js, an unrelated namespace.)
     * On Dev, 1 client_info row of 27 carries any of them, and that row
       already has the matching _id FKs set — pre-migration residue.
     * They do not exist on Production at all, so naming them here made
       PostgREST reject the whole SELECT with 42703 and inheritance
       silently did nothing for every child project created in
       production.

   ClientFile.jsx still READS the free-text name/phone as a display
   fallback (`lookedUp || legacy`), guarded by hasOwnProperty so a Prod
   row without the columns degrades to null. That fallback is untouched
   and unaffected by this list — inheriting a value nothing can ever
   update afterwards is not worth propagating to new children. */
export const CLIENT_INFO_INHERIT_FIELDS = [
  'city', 'gush', 'helka', 'migrash', 'area', 'active_plans',
  'committee', 'checker', 'info_license_file', 'building_file',
  'internal_request_num', 'available_license_num', 'civil_defense_file', 'request_essence',
  'project_manager_id',
  'surveyor_id',
  'constructor_id',
  'plumbing_engineer_id',
  'soil_consultant_id',
  'contractor_id',
  'supervisor_id',
]

/* Flags a project as a parent if it isn't already — idempotent, safe
   to call even when the project is already flagged. */
export async function markProjectAsParent(parentProjectId) {
  if (!parentProjectId) return
  /* Same class of silent no-op as the inheritance below — a failed
     update here would leave the parent unflagged with nothing to show
     for it. Logged, not thrown: the caller proceeds either way. */
  const { error } = await supabase.from('projects')
    .update({ is_parent_project: true })
    .eq('id', parentProjectId)
    .eq('is_parent_project', false)
  if (error) console.error('markProjectAsParent failed', error)
}

/* One-time client_info field inheritance, run right after a
   parent_project_id link is established (new child creation, an
   existing project being attached to a parent, or an inquiry with a
   parent_project_id being converted to a project). For every
   inheritable field: if the child is empty and the parent has a value,
   copy it. Never overwrites a field the child already has. Not a
   sync — runs once at link time only, so later parent edits never
   propagate. */
export async function inheritClientInfoFromParent(parentProjectId, childProjectId) {
  /* Returns a result object so a caller CAN tell what happened. Every
     existing call site ignores it, which is why the signature stays
     fire-and-forget rather than throwing — a throw here would abort
     child-project creation at three call sites for what is a
     best-effort copy. But "the query failed" and "there was nothing to
     copy" must stop being the same silent `return`: the whole reason
     the 42703 below went unnoticed is that a hard 400 and an empty
     parent were indistinguishable from the outside. */
  const fail = (reason, error) => {
    console.error(`inheritClientInfoFromParent: ${reason}`, error || '')
    return { ok: false, reason, error: error || null, inherited: 0 }
  }

  if (!parentProjectId || !childProjectId) {
    return { ok: false, reason: 'missing-ids', error: null, inherited: 0 }
  }

  const { data: parentInfo, error: parentErr } = await supabase
    .from('client_info')
    .select(CLIENT_INFO_INHERIT_FIELDS.join(','))
    .eq('project_id', parentProjectId)
    .maybeSingle()
  if (parentErr) return fail('parent client_info query failed', parentErr)
  /* Genuinely nothing to inherit — a parent with no client_info row.
     Distinct from the failure above, and not an error. */
  if (!parentInfo) return { ok: true, reason: 'no-parent-row', error: null, inherited: 0 }

  const { data: childInfo, error: childErr } = await supabase
    .from('client_info')
    .select(`id, ${CLIENT_INFO_INHERIT_FIELDS.join(',')}`)
    .eq('project_id', childProjectId)
    .maybeSingle()
  if (childErr) return fail('child client_info query failed', childErr)

  const isEmpty = (v) => v === null || v === undefined || v === ''
  const patch = {}
  for (const field of CLIENT_INFO_INHERIT_FIELDS) {
    if (!isEmpty(parentInfo[field]) && isEmpty(childInfo?.[field])) {
      patch[field] = parentInfo[field]
    }
  }
  if (Object.keys(patch).length === 0) {
    return { ok: true, reason: 'nothing-to-copy', error: null, inherited: 0 }
  }

  const { error: writeErr } = childInfo?.id
    ? await supabase.from('client_info').update(patch).eq('id', childInfo.id)
    : await supabase.from('client_info').insert({ project_id: childProjectId, ...patch })
  if (writeErr) return fail('client_info write failed', writeErr)

  return { ok: true, reason: 'inherited', error: null, inherited: Object.keys(patch).length }
}
