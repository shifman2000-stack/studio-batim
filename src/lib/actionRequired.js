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
//   A. documents — a project_documents row whose client_access asks
//      something of the client ('sign' | 'upload' | 'approve') and whose
//      client_completed_at is still null. Completion is recorded on the
//      ROW, by whichever flow satisfied it (an upload for sign/upload, a
//      tick for approve), so this no longer has to infer it from who
//      uploaded which version. Produces a screen total AND per-stage
//      counts.
//
//   B. meetings — a meeting_summaries row with has_client_tasks === true
//      whose client_tasks_status_id is not the "הושלם" status. The count
//      is the NUMBER OF SUMMARIES, never the number of task lines inside
//      them. Produces a screen total AND the ids of the open summaries,
//      so the per-card dot comes from here rather than being re-derived.
//
//   C. questionnaire — the project's programming_questionnaires row's
//      answers.meta.{questionnaire_done,house_done} flags. Each one not
//      strictly true (including a missing row entirely) is one open
//      item, up to 2 per project. Screen key 'questionnaire' is already
//      gated on projects.show_programming_questionnaire by
//      clientPortalGroups' getVisibleChildren, so the usual visibility
//      rule below already keeps this at zero whenever that flag is off
//      — no separate gate needed here.
//
//   D. contacts — project_contacts personal-detail completeness, for the
//      'file' screen ("פרטי תיק" → "פרטים אישיים"). ANY row missing ANY
//      of first_name/last_name/id_number/phone/email counts the whole
//      PROJECT as needing attention (one flag, not one per row/field —
//      there's nowhere per-contact for a client to "clear" a partial
//      dot, so unlike documents/meetings this source never produces
//      more than 1).
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
 *   · client_access is one of 'sign' | 'upload' | 'approve'  — the three
 *     states that ASK the client for something ('view' asks nothing and
 *     'hidden' isn't shown at all)
 *   · AND client_completed_at is still null.
 *
 * The old rule inferred completion from document_versions.uploaded_by.
 * It can't any more: 'approve' is satisfied by a tick, not a file, and a
 * signed re-upload is indistinguishable from any other client upload.
 * Completion is now recorded explicitly on the row by whichever flow
 * satisfied it, which is also why the signature no longer needs the
 * versions list or the client's uid.
 *
 * @param {object|null|undefined} doc  a project_documents row carrying
 *                                     client_access + client_completed_at
 * @returns {boolean}
 */
export const CLIENT_ACTION_STATES = ['sign', 'upload', 'approve']

export function isDocumentActionRequired(doc) {
  if (!doc) return false
  if (!CLIENT_ACTION_STATES.includes(doc.client_access)) return false
  return !doc.client_completed_at
}

/**
 * Count open document requests from an in-memory dataset — used by
 * ClientDocuments so its badges re-derive instantly after an upload
 * without a round-trip. Same rule as the network path, so the two
 * cannot drift.
 *
 * @returns {{ total:number, byStage:Object }}
 */
export function computeDocumentActionRequired(documents) {
  const byStage = {}
  let total = 0
  const docs = Array.isArray(documents) ? documents : []
  for (const d of docs) {
    /* Derived from the primitive above — do not re-implement the
       condition here, or the counts and the row markers will drift. */
    if (!isDocumentActionRequired(d)) continue
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
    /* Only the three asking states can be open. RLS additionally gates
       by the caller's client_users row. Completion now lives on the row
       itself, so the second query over document_versions this used to
       need is gone. */
    const { data: docs, error: docsErr } = await supabase
      .from('project_documents')
      .select('id, stage, client_access, client_completed_at')
      .eq('project_id', projectId)
      .in('client_access', CLIENT_ACTION_STATES)
    if (docsErr) throw docsErr
    if (!docs || docs.length === 0) return empty

    return computeDocumentActionRequired(docs)
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

/* ── Source C: questionnaire / house builder ─────────────────────── */

/**
 * THE questionnaire/house-builder primitive. Mirrors the same
 * answers.meta.{questionnaire_done,house_done} flags
 * ClientProgrammingQuestionnaire.jsx itself reads to show "הסתיים
 * המילוי ✓" on each hub tile — a missing/malformed answers bag (e.g. a
 * brand-new row) reads as "not done" on both, same as the hub's own
 * `!!(answers && answers.meta && answers.meta.x === true)` check.
 *
 * @param {object|null|undefined} row a programming_questionnaires row (needs .answers)
 * @returns {{ questionnaireDone: boolean, houseDone: boolean }}
 */
export function questionnairePartsStatus(row) {
  const answers = row && row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers)
    ? row.answers
    : {}
  const meta = answers.meta && typeof answers.meta === 'object' && !Array.isArray(answers.meta)
    ? answers.meta
    : {}
  return {
    questionnaireDone: meta.questionnaire_done === true,
    houseDone:          meta.house_done === true,
  }
}

/**
 * @param {object|null|undefined} row a programming_questionnaires row, or null/undefined if none exists yet
 * @returns {{ total:number, questionnaireDone:boolean, houseDone:boolean }}
 */
export function computeQuestionnaireActionRequired(row) {
  const { questionnaireDone, houseDone } = questionnairePartsStatus(row)
  const total = (questionnaireDone ? 0 : 1) + (houseDone ? 0 : 1)
  return { total, questionnaireDone, houseDone }
}

async function loadQuestionnaireSource({ projectId }) {
  /* On failure, report BOTH parts done (no dot) rather than false/false
     — this is the "swallow failure, cost a badge not a screen" contract;
     unlike `total: 0` alone, the per-part booleans below are read
     directly by the hub screen for its own tile dots, so they need to
     independently say "nothing to flag" too. */
  const empty = { total: 0, questionnaireDone: true, houseDone: true }
  if (!projectId) return empty
  try {
    const { data, error } = await supabase
      .from('programming_questionnaires')
      .select('answers')
      .eq('project_id', projectId)
      .maybeSingle()
    if (error) throw error
    return computeQuestionnaireActionRequired(data)
  } catch (e) {
    console.warn('actionRequired/questionnaire failed:', e)
    return empty
  }
}

/* ── Source D: contacts (personal-details completeness) ───────────── */

const CONTACT_REQUIRED_FIELDS = ['first_name', 'last_name', 'id_number', 'phone', 'email']

/**
 * A single project_contacts row needs attention when any of the 5
 * personal-detail fields is missing or blank.
 *
 * @param {object|null|undefined} contact a project_contacts row
 * @returns {boolean}
 */
export function isContactIncomplete(contact) {
  if (!contact) return true
  return CONTACT_REQUIRED_FIELDS.some(f => {
    const v = contact[f]
    return v === null || v === undefined || String(v).trim() === ''
  })
}

/**
 * The whole project needs attention when ANY of its contact rows is
 * incomplete. Used both by the network loader below and directly by
 * ClientFile.jsx (which already has `contacts` loaded) for its own
 * in-screen dot — same primitive, no redundant fetch, same pattern the
 * questionnaire hub's tile dots already use.
 *
 * @param {Array|null|undefined} contacts project_contacts rows
 * @returns {{ total:number }} total is 0 or 1 — a project-level flag, not a per-row count
 */
export function computeContactsActionRequired(contacts) {
  const rows = Array.isArray(contacts) ? contacts : []
  const anyIncomplete = rows.length > 0 && rows.some(isContactIncomplete)
  return { total: anyIncomplete ? 1 : 0 }
}

async function loadContactsSource({ projectId }) {
  const empty = { total: 0 }
  if (!projectId) return empty
  try {
    const { data, error } = await supabase
      .from('project_contacts')
      .select('first_name, last_name, id_number, phone, email')
      .eq('project_id', projectId)
    if (error) throw error
    return computeContactsActionRequired(data)
  } catch (e) {
    console.warn('actionRequired/contacts failed:', e)
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
  { screenKey: 'documents',     load: loadDocumentsSource     },
  { screenKey: 'meetings',      load: loadMeetingsSource      },
  { screenKey: 'questionnaire', load: loadQuestionnaireSource },
  { screenKey: 'file',          load: loadContactsSource      },
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
