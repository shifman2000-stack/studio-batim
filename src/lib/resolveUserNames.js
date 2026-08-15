// src/lib/resolveUserNames.js
//
// One place that turns a set of user uuids into display names.
//
// A uuid on a row (shared_files.uploaded_by, project_notes.uploaded_by,
// meeting_summaries.client_tasks_done_by, …) can belong to a STAFF
// member or to a CLIENT, and the two live in different tables. This
// runs the same up-to-three-query dance every caller needs:
//
//   1) profiles         — staff. "first last".
//   2) client_users     — the uuids profiles didn't claim. Gives us
//                         project_id + email + a first_name SNAPSHOT
//                         taken once by link_client_on_login.
//   3) project_contacts — the LIVE client name, fetched by the
//                         project_ids gathered in (2) and matched on
//                         email (case-insensitively, in JS).
//
// project_contacts wins over the client_users snapshot because the
// snapshot goes stale after a rename; the snapshot is only the fallback
// when no contact row matches.
//
// Always batched: one call per screen over the union of ids, never one
// per row. Returns a plain { [uuid]: name } map — ids that resolve to
// nothing are simply absent, so callers can decide their own fallback
// rather than being handed an empty string or a raw uuid.
//
// Safe on the client portal: all three tables are already read there
// under the client's own RLS.

import { supabase } from '../supabaseClient'

export async function resolveUserNames(userIds) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)))
  const nameMap = {}
  if (ids.length === 0) return nameMap

  /* 1. Staff via profiles */
  const { data: staffRows } = await supabase
    .from('profiles')
    .select('id, first_name, last_name')
    .in('id', ids)

  const staffIds = new Set((staffRows || []).map(s => s.id))
  for (const s of staffRows || []) {
    const fn = (s.first_name || '').trim()
    const ln = (s.last_name || '').trim()
    const full = [fn, ln].filter(Boolean).join(' ')
    if (full) nameMap[s.id] = full
  }

  /* 2. Clients via client_users — project_id + email + snapshot */
  const remaining = ids.filter(id => !staffIds.has(id))
  if (remaining.length === 0) return nameMap

  const { data: clientRows } = await supabase
    .from('client_users')
    .select('id, project_id, email, first_name')
    .in('id', remaining)

  const clientList = clientRows || []

  /* 3. project_contacts for the involved project_ids — LIVE name. */
  const projectIds = Array.from(new Set(
    clientList.map(c => c.project_id).filter(Boolean)
  ))
  let liveContacts = []
  if (projectIds.length > 0) {
    const { data: contactRows } = await supabase
      .from('project_contacts')
      .select('project_id, email, first_name')
      .in('project_id', projectIds)
    liveContacts = contactRows || []
  }

  for (const cu of clientList) {
    const cuEmail = (cu.email || '').trim().toLowerCase()
    let liveName = null
    if (cuEmail) {
      const match = liveContacts.find(pc =>
        pc.project_id === cu.project_id &&
        (pc.email || '').trim().toLowerCase() === cuEmail
      )
      if (match) {
        const fn = (match.first_name || '').trim()
        if (fn) liveName = fn
      }
    }
    const display = liveName || ((cu.first_name || '').trim() || null)
    if (display) nameMap[cu.id] = display
  }

  return nameMap
}

export default resolveUserNames
