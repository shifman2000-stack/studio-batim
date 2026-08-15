// src/lib/actionRequired.js
//
// "דרוש טיפול" — the single source of truth for every red indicator in
// the client portal. One module owns the question "does this client
// still owe us something here?", so a tile's number can never disagree
// with the marks on the screen it points at.
//
// ── SOURCES ──────────────────────────────────────────────────────────
// The mechanism is a SET of sources, each producing a count for exactly
// ONE client screen key. Adding a third source means adding one entry to
// SOURCES below — the rollup, the visibility gate and every consumer
// keep working untouched.
//
//   A. documents — a project_documents row with client_access ===
//      'view_edit' that the CLIENT has not uploaded to. A staff upload
//      does NOT close it, and neither does a legacy
//      project_documents.file_url (we can't attribute it to the client).
//      Produces a screen total AND per-stage counts.
//
//   B. meetings — a meeting_summaries row with has_client_tasks === true
//      whose client_tasks_status_id is not the "הושלם" status. The count
//      is the NUMBER OF SUMMARIES, never the number of task lines inside
//      them. Produces a screen total AND the ids of the open summaries,
//      so the per-card dot comes from here rather than being re-derived.
//
// ── ROLLUP ───────────────────────────────────────────────────────────
// A group tile shows the SUM of its children's counts. The parent/child
// mapping is read from clientPortalGroups.GROUPS — it is not restated
// here, so a change to the navigation structure needs no edit in this
// file.
//
// ── VISIBILITY (the edge case that matters) ──────────────────────────
// A screen hidden from this client contributes ZERO. 'meetings' is
// hidden by default, so without this gate a client would see a red
// number pointing at a screen they cannot open and cannot clear. The
// gate reuses getVisibleChildren (which itself defers to
// isClientTabVisible) — there is deliberately no second visibility rule
// in this module.
//
// ── DEFENSIVE POSTURE ────────────────────────────────────────────────
// Every loader swallows its own failure and reports zero. A broken
// query costs a badge, never a screen.

import { supabase } from '../supabaseClient'
import { GROUPS, getVisibleChildren } from './clientPortalGroups'

/* The status name that closes a meeting's client tasks. Matched by name
   so the numeric id stays a database detail. */
const DONE_STATUS_NAME = 'הושלם'

/* ── Source A: documents ──────────────────────────────────────────── */

/* Normalise a doc's stage name into a group key that mirrors what
   ClientDocuments' render code uses (`clean(d.stage) || 'כללי'`). */
function stageKey(doc) {
  const s = doc && doc.stage
  const t = (typeof s === 'string') ? s.trim() : ''
  return t || 'כללי'
}

/**
 * THE documents primitive. The per-stage badge, the screen total and the
 * per-row indicator inside ClientDocuments all resolve through this, so
 * a stage badge showing N can never disagree with the number of marked
 * rows inside that stage.
 *
 * A row needs the client's attention when:
 *   · client_access === 'view_edit'   (the client is asked to upload)
 *   · AND document_versions holds no row whose uploaded_by is the
 *     client's own user id.
 *
 * @param {object|null|undefined} doc            a project_documents row
 * @param {Array|null|undefined}  versionsForDoc that doc's document_versions
 * @param {string|null|undefined} clientUserId   the client's auth.uid;
 *                                 when missing no version can match, so
 *                                 every view_edit row reads as open.
 * @returns {boolean}
 */
export function isDocumentActionRequired(doc, versionsForDoc, clientUserId) {
  if (!doc || doc.client_access !== 'view_edit') return false
  const clientUploaded = Array.isArray(versionsForDoc) && clientUserId
    ? versionsForDoc.some(v => v && v.uploaded_by === clientUserId)
    : false
  return !clientUploaded
}

/**
 * Count open document requests from an in-memory dataset — used by
 * ClientDocuments so its badges re-derive instantly after an upload
 * without a round-trip. Same rule as the network path, so the two
 * cannot drift.
 *
 * @returns {{ total:number, byStage:Object }}
 */
export function computeDocumentActionRequired(documents, versionsByDoc, clientUserId) {
  const byStage = {}
  let total = 0
  const docs = Array.isArray(documents) ? documents : []
  const versions = versionsByDoc || {}
  for (const d of docs) {
    /* Derived from the primitive above — do not re-implement the
       condition here, or the counts and the row markers will drift. */
    if (!isDocumentActionRequired(d, versions[d.id], clientUserId)) continue
    total += 1
    const key = stageKey(d)
    byStage[key] = (byStage[key] || 0) + 1
  }
  return { total, byStage }
}

async function loadDocumentsSource({ projectId, clientUserId }) {
  const empty = { total: 0, byStage: {} }
  if (!projectId) return empty
  try {
    /* Stage 1 — only view_edit rows can be open. RLS additionally gates
       by the caller's client_users row. */
    const { data: docs, error: docsErr } = await supabase
      .from('project_documents')
      .select('id, stage, client_access')
      .eq('project_id',    projectId)
      .eq('client_access', 'view_edit')
    if (docsErr) throw docsErr
    if (!docs || docs.length === 0) return empty

    /* Stage 2 — versions with uploaded_by, so client uploads can be
       told apart from staff uploads. */
    const docIds = docs.map(d => d.id)
    const { data: versions, error: vErr } = await supabase
      .from('document_versions')
      .select('document_id, uploaded_by')
      .in('document_id', docIds)
    if (vErr) throw vErr

    const versionsByDoc = {}
    for (const v of versions || []) {
      if (!versionsByDoc[v.document_id]) versionsByDoc[v.document_id] = []
      versionsByDoc[v.document_id].push(v)
    }

    return computeDocumentActionRequired(docs, versionsByDoc, clientUserId)
  } catch (e) {
    console.warn('actionRequired/documents failed:', e)
    return empty
  }
}

/* ── Source B: meetings ───────────────────────────────────────────── */

/**
 * Resolve the "הושלם" status id from a task_statuses list. Kept here so
 * every caller resolves it the same way instead of hard-coding a number.
 *
 * @param {Array|null|undefined} taskStatuses rows of { id, name }
 * @returns {number|null} null when it cannot be resolved
 */
export function doneStatusIdFrom(taskStatuses) {
  const rows = Array.isArray(taskStatuses) ? taskStatuses : []
  const row = rows.find(t => t && t.name === DONE_STATUS_NAME)
  return row ? row.id : null
}

/**
 * THE meetings primitive. A summary needs the client's attention when it
 * carries client tasks that are not finished.
 *
 * Note the deliberate `doneStatusId == null` guard: if we could not
 * resolve which status means done, report NOTHING rather than flagging
 * every summary as open. A missing badge is recoverable; a permanent red
 * number the client cannot clear is not.
 *
 * @param {object|null|undefined} summary       a meeting_summaries row
 * @param {number|null|undefined} doneStatusId  id of "הושלם"
 * @returns {boolean}
 */
export function isMeetingActionRequired(summary, doneStatusId) {
  if (!summary || summary.has_client_tasks !== true) return false
  if (doneStatusId == null) return false
  return summary.client_tasks_status_id !== doneStatusId
}

/**
 * Count open meetings from an in-memory dataset — used by ClientMeetings
 * so its per-card dots come from this module rather than an inline test.
 * The total is the number of SUMMARIES, not of task lines.
 *
 * @returns {{ total:number, openIds:string[] }}
 */
export function computeMeetingActionRequired(summaries, doneStatusId) {
  const rows = Array.isArray(summaries) ? summaries : []
  const openIds = []
  for (const s of rows) {
    if (isMeetingActionRequired(s, doneStatusId)) openIds.push(s.id)
  }
  return { total: openIds.length, openIds }
}

async function loadMeetingsSource({ projectId }) {
  const empty = { total: 0, openIds: [] }
  if (!projectId) return empty
  try {
    /* task_statuses is a 3-row reference table, read to resolve "הושלם"
       by name. The `tasks` table is NOT touched here: studio tasks are
       irrelevant to this mechanism and the portal must never query
       them. */
    const [{ data: statusRows }, { data: rows, error: rowsErr }] = await Promise.all([
      supabase.from('task_statuses').select('id, name'),
      supabase
        .from('meeting_summaries')
        .select('id, has_client_tasks, client_tasks_status_id')
        .eq('project_id', projectId)
        .eq('has_client_tasks', true),
    ])
    if (rowsErr) throw rowsErr

    return computeMeetingActionRequired(rows, doneStatusIdFrom(statusRows))
  } catch (e) {
    console.warn('actionRequired/meetings failed:', e)
    return empty
  }
}

/* ── The source registry ──────────────────────────────────────────── */

/**
 * Each source feeds exactly ONE client screen key. `screenKey` must be a
 * key that appears in some group's `children` in clientPortalGroups, or
 * the rollup will never pick it up.
 */
export const SOURCES = [
  { screenKey: 'documents', load: loadDocumentsSource },
  { screenKey: 'meetings',  load: loadMeetingsSource  },
]

/* ── Rollup ───────────────────────────────────────────────────────── */

/**
 * Screen keys this client is actually allowed to open, derived from the
 * SAME group definition the tiles render from. This is the only
 * visibility gate in the module.
 */
function visibleScreenKeys(clientVisibleTabs, showProgrammingQuestionnaire) {
  const keys = new Set()
  for (const g of GROUPS) {
    for (const k of getVisibleChildren(g, clientVisibleTabs, showProgrammingQuestionnaire)) {
      keys.add(k)
    }
  }
  return keys
}

/**
 * Load every source and roll the counts up to screens and groups.
 *
 * Hidden screens are forced to zero BEFORE the rollup, so they can
 * neither show their own badge nor inflate their parent's.
 *
 * @param {object} args
 * @param {string|null|undefined} args.projectId
 * @param {string|null|undefined} args.clientUserId
 * @param {object|null|undefined} args.clientVisibleTabs projects.client_visible_tabs
 * @param {boolean|undefined} args.showProgrammingQuestionnaire
 * @returns {Promise<{ byScreen:Object, byGroup:Object, detail:Object }>}
 *   byScreen — { [screenKey]: count }, zero for hidden screens
 *   byGroup  — { [groupKey]:  count }, the sum of that group's VISIBLE children
 *   detail   — per-source extras, e.g. detail.documents.byStage
 */
export async function loadActionRequired({
  projectId,
  clientUserId,
  clientVisibleTabs,
  showProgrammingQuestionnaire,
} = {}) {
  const byScreen = {}
  const byGroup  = {}
  const detail   = {}

  const visible = visibleScreenKeys(clientVisibleTabs, showProgrammingQuestionnaire)

  /* Sources run concurrently; each already swallows its own failure, so
     one dead source cannot take the others down. */
  const results = await Promise.all(
    SOURCES.map(src => src.load({ projectId, clientUserId }))
  )

  SOURCES.forEach((src, i) => {
    const res = results[i] || {}
    detail[src.screenKey] = res
    /* THE edge case: a hidden screen contributes nothing, anywhere. */
    byScreen[src.screenKey] = visible.has(src.screenKey) ? (res.total || 0) : 0
  })

  for (const g of GROUPS) {
    const children = getVisibleChildren(g, clientVisibleTabs, showProgrammingQuestionnaire)
    byGroup[g.key] = children.reduce((sum, k) => sum + (byScreen[k] || 0), 0)
  }

  return { byScreen, byGroup, detail }
}
