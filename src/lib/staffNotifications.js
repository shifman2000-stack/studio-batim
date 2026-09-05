// src/lib/staffNotifications.js
//
// The READ and CLEAR side of staff notifications — the staff-facing half
// of the table whose write half lives in ./staffNotify.js. Split by
// DIRECTION, not by screen: everything a client or contractor screen
// needs is over there, everything a staff screen needs is here, and the
// table is named in exactly one place (STAFF_NOTIFICATIONS_TABLE).
//
// ── WHAT A ROW MEANS ─────────────────────────────────────────────────
// Presence IS the notification. A row exists because a client or
// contractor acted and no staff member has looked yet. There is no seen
// flag, so "unread" is simply "the row is still there".
//
// ── THE COUNTS ARE NEVER RE-DERIVED FROM A SECOND QUERY ──────────────
// A badge that counts something the screen cannot show is the failure
// this module is shaped to prevent. So there is ONE loader per screen,
// and every level below it derives from that one array in memory:
//
//   ProjectsKanban  → loadAllProjectTotals()      one query, whole board
//   ProjectDetail   → loadProjectNotifications()  one query, one project
//                     ├─ the מעקב מסמכים tab badge
//                     └─ passed down to DocumentsTab, which derives
//                        the group badges and the row lines from the
//                        SAME array
//
// ── DEFENSIVE POSTURE ────────────────────────────────────────────────
// Matches lib/actionRequired.js: every loader swallows its own failure
// and reports empty. A broken query costs a badge, never a screen.

import { supabase } from '../supabaseClient'
import { STAFF_NOTIFICATIONS_TABLE } from './staffNotify'

/* The five document-event sentences, keyed by "<actor_role>:<action>".
   The two questionnaire actions are deliberately absent — they are
   project-targeted, have no document row to sit on, and are step 3. */
export const NOTIFICATION_TEXT = {
  'client:upload':      'הלקוח העלה קובץ',
  'client:sign':        'הלקוח חתם על הקובץ',
  'client:approve':     'הלקוח אישר את הקובץ',
  'contractor:sign':    'הקבלן חתם על הקובץ',
  'contractor:approve': 'הקבלן אישר את הקובץ',
}

export function notificationText(row) {
  if (!row) return null
  return NOTIFICATION_TEXT[`${row.actor_role}:${row.action}`] || null
}

/* ── Kanban: ONE query for the WHOLE BOARD ────────────────────────────
   Exactly the shape tasksByProject already uses — one round-trip, then
   grouped in memory. No per-card query, no N+1.

   Counts EVERY row for the project, document and questionnaire alike.
   A questionnaire notification therefore shows in this total while the
   only place to click through to it (the סיכומי פגישות link) does not
   exist yet — that is STEP 3, and it is expected, not a bug. Please do
   not "fix" it by filtering questionnaire rows out here: the kanban
   number is the project's total across both streams by design, and
   filtering would make it disagree with itself once step 3 lands.

   @returns {Promise<Object>} { [project_id]: count }, {} on failure */
export async function loadAllProjectTotals() {
  try {
    const { data, error } = await supabase
      .from(STAFF_NOTIFICATIONS_TABLE)
      .select('project_id')
    if (error) throw error

    const byProject = {}
    for (const row of data || []) {
      if (!row.project_id) continue
      byProject[row.project_id] = (byProject[row.project_id] || 0) + 1
    }
    return byProject
  } catch (e) {
    console.warn('[staffNotifications] board totals failed:', e)
    return {}
  }
}

/* ── One project's notifications — THE single source for levels 2-4 ──
   Returns the raw rows. Callers derive; nobody re-queries.

   @returns {Promise<Array>} rows, [] on failure */
export async function loadProjectNotifications(projectId) {
  if (!projectId) return []
  try {
    const { data, error } = await supabase
      .from(STAFF_NOTIFICATIONS_TABLE)
      .select('id, project_id, document_id, actor_role, action, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
    if (error) throw error
    return data || []
  } catch (e) {
    console.warn('[staffNotifications] project load failed:', e)
    return []
  }
}

/* ── Derivations. Pure, in-memory, no I/O. ───────────────────────────── */

/* Rows that belong to a document. The questionnaire rows (document_id
   null) are excluded here and only here, so the tab badge, the group
   badges and the row lines all agree by construction. */
export function documentNotifications(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r && r.document_id)
}

/* { [document_id]: rows[] } — the map levels 3 and 4 both read. */
export function groupByDocument(rows) {
  const byDoc = {}
  for (const r of documentNotifications(rows)) {
    if (!byDoc[r.document_id]) byDoc[r.document_id] = []
    byDoc[r.document_id].push(r)
  }
  return byDoc
}

/* One line per DISTINCT action, each with its own count.
   Three uploads read as one line plus 3. An upload AND an approve read
   as two lines — deliberately never merged into a generic sentence,
   because "3 עדכונים" would lose the only thing worth knowing.
   Insertion order follows created_at, so the oldest event reads first.

   @returns {Array<{key:string, text:string, count:number}>} */
export function summariseActions(rowsForOneDoc) {
  const order = []
  const byKey = {}
  for (const r of (Array.isArray(rowsForOneDoc) ? rowsForOneDoc : [])) {
    const key = `${r.actor_role}:${r.action}`
    if (!byKey[key]) {
      byKey[key] = { key, text: NOTIFICATION_TEXT[key] || null, count: 0 }
      order.push(key)
    }
    byKey[key].count += 1
  }
  /* An unrecognised pair renders nothing rather than an empty bullet —
     the DB CHECK makes it unreachable, but a future eighth event should
     degrade quietly rather than print a blank line. */
  return order.map(k => byKey[k]).filter(e => e.text)
}

/* ── The clear ────────────────────────────────────────────────────────
   Clicking a document row removes EVERY notification on that document,
   for every staff member — the table is shared, so whoever looks first
   clears it for the team.

   ⚠️ ZERO ROWS IS NORMAL HERE, NOT A FAILURE. Everywhere else in this
   project a write that affects 0 rows means an RLS refusal we must
   surface. Not here: 0 simply means nothing was pending on this
   document — someone else already looked, or the row never had a
   notification. The clear is idempotent by design and every click on
   every row would otherwise "fail". DO NOT add a row-count check to this
   function; it is the one deliberate exception to that rule.

   A genuine refusal still surfaces, because it arrives as an `error`,
   not as a silent zero.

   @returns {Promise<boolean>} false only on a REAL error */
export async function clearDocumentNotifications(documentId) {
  if (!documentId) return false
  try {
    const { error } = await supabase
      .from(STAFF_NOTIFICATIONS_TABLE)
      .delete()
      .eq('document_id', documentId)
    if (error) {
      console.error('[staffNotifications] clear failed', { documentId, code: error.code, error })
      return false
    }
    return true
  } catch (e) {
    console.error('[staffNotifications] clear threw', e)
    return false
  }
}
