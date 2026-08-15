// src/lib/parentProjectInheritance.js
//
// Shared by every code path that establishes a parent_project_id link:
// ProjectsKanban.jsx (creating a child with a parent selected, or
// attaching an existing project to a parent) and Inquiries.jsx
// (converting an inquiry that already carries a parent_project_id into
// a project). Kept in one place so all call sites stay in sync —
// never duplicate this logic at a new call site.

import { supabase } from '../supabaseClient'

/* client_info columns eligible for one-time parent → child inheritance
   (every column except id / project_id / created_at / updated_at).
   Note contractor/supervisor only have an _id FK in this schema — no
   separate legacy name/phone text columns like the other five
   professional roles. */
export const CLIENT_INFO_INHERIT_FIELDS = [
  'city', 'gush', 'helka', 'migrash', 'area', 'active_plans',
  'vaada', 'bodeket', 'tik_meida', 'tik_binyan',
  'bakasha_pnimi', 'bakasha_vaada', 'bakasha_risuy', 'tik_haga', 'mahat_habakasha',
  'committee', 'checker', 'info_license_file', 'building_file',
  'internal_request_num', 'available_license_num', 'civil_defense_file', 'request_essence',
  'project_manager_id', 'project_manager', 'project_manager_phone',
  'surveyor_id', 'surveyor', 'surveyor_phone',
  'constructor_id', 'constructor', 'constructor_phone',
  'plumbing_engineer_id', 'plumbing_engineer', 'plumbing_engineer_phone',
  'soil_consultant_id', 'soil_consultant', 'soil_consultant_phone',
  'contractor_id',
  'supervisor_id',
]

/* Flags a project as a parent if it isn't already — idempotent, safe
   to call even when the project is already flagged. */
export async function markProjectAsParent(parentProjectId) {
  if (!parentProjectId) return
  await supabase.from('projects').update({ is_parent_project: true }).eq('id', parentProjectId).eq('is_parent_project', false)
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
  if (!parentProjectId || !childProjectId) return
  const { data: parentInfo } = await supabase
    .from('client_info')
    .select(CLIENT_INFO_INHERIT_FIELDS.join(','))
    .eq('project_id', parentProjectId)
    .maybeSingle()
  if (!parentInfo) return

  const { data: childInfo } = await supabase
    .from('client_info')
    .select(`id, ${CLIENT_INFO_INHERIT_FIELDS.join(',')}`)
    .eq('project_id', childProjectId)
    .maybeSingle()

  const isEmpty = (v) => v === null || v === undefined || v === ''
  const patch = {}
  for (const field of CLIENT_INFO_INHERIT_FIELDS) {
    if (!isEmpty(parentInfo[field]) && isEmpty(childInfo?.[field])) {
      patch[field] = parentInfo[field]
    }
  }
  if (Object.keys(patch).length === 0) return

  if (childInfo?.id) {
    await supabase.from('client_info').update(patch).eq('id', childInfo.id)
  } else {
    await supabase.from('client_info').insert({ project_id: childProjectId, ...patch })
  }
}
