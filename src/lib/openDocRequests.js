// src/lib/openDocRequests.js
//
// Shared source of truth for the "open document requests" count used
// by the client portal. A document row is considered an OPEN REQUEST
// when:
//   * client_access === 'view_edit'                 (client can upload)
//   * AND it does NOT yet have a file uploaded BY THE CLIENT — i.e.
//     zero document_versions rows whose uploaded_by matches the
//     current client's user id.
//
// A file uploaded by staff (עינב etc.) is intentionally NOT enough to
// close the request. If the client hasn't uploaded, the row is still
// waiting on them. Legacy project_documents.file_url with no
// document_versions rows also stays OPEN — we can't attribute it to
// the client, so we treat it as "still needs the client's own upload".
//
// The count is used at three levels in the client portal:
//   1. Per-stage badge on each stage accordion header inside
//      ClientDocuments.
//   2. Total badge on the "מעקב מסמכים" child tile inside the
//      "התקדמות התהליך" group sub-screen (ClientHome).
//   3. Total badge on the "התקדמות התהליך" group tile on the client
//      home grid (ClientHome).
//
// Two exports:
//   * loadOpenDocRequests(projectId, clientUserId) — async, hits
//                                Supabase, returns { total, byStage }.
//   * computeOpenRequests(docs, versionsByDoc, clientUserId) — sync
//                                helper that computes the same shape
//                                from an in-memory dataset (used by
//                                ClientDocuments so the badge re-derives
//                                instantly after an upload without a
//                                round-trip).
//
// Both paths apply the same rule, so a badge computed locally after an
// upload matches what the shared network path returns on the next mount.

import { supabase } from '../supabaseClient'

/* Normalise a doc's stage name into a group key that mirrors what
   ClientDocuments' render code uses (`clean(d.stage) || 'כללי'`). */
function stageKey(doc) {
  const s = doc && doc.stage
  const t = (typeof s === 'string') ? s.trim() : ''
  return t || 'כללי'
}

/**
 * Given the same `documents` array + `versionsByDoc` map that
 * ClientDocuments already loads, count open requests for a specific
 * client. A request is CLOSED only when the client themself has ≥1
 * version on it — staff uploads don't count.
 *
 * @param {Array}          documents     project_documents rows (must
 *                                        include id, stage, client_access).
 * @param {Object}         versionsByDoc { [docId]: version[] } where each
 *                                        version has at least `uploaded_by`.
 * @param {string|null|undefined} clientUserId  the current client's
 *                                        auth.uid (from useClient().id).
 *                                        When missing, no version can
 *                                        match — every view_edit row
 *                                        counts as open.
 * @returns {{ total:number, byStage:Object }}
 */
/**
 * THE primitive. Every "is this an open request?" decision in the app
 * — the per-stage badge, the total badge, and the per-row indicator
 * inside ClientDocuments — resolves through this one function, so a
 * stage badge showing N can never disagree with the number of marked
 * rows inside that stage.
 *
 * A row is an OPEN REQUEST when:
 *   · client_access === 'view_edit'   (the client is asked to upload)
 *   · AND document_versions holds no row whose uploaded_by is the
 *     client's own user id.
 * A file uploaded by staff does NOT close the request, and neither
 * does a legacy project_documents.file_url (we can't attribute it).
 *
 * @param {object|null|undefined} doc            a project_documents row
 * @param {Array|null|undefined}  versionsForDoc that doc's document_versions
 * @param {string|null|undefined} clientUserId   the client's auth.uid;
 *                                 when missing no version can match, so
 *                                 every view_edit row reads as open.
 * @returns {boolean}
 */
export function isOpenRequest(doc, versionsForDoc, clientUserId) {
  if (!doc || doc.client_access !== 'view_edit') return false
  const clientUploaded = Array.isArray(versionsForDoc) && clientUserId
    ? versionsForDoc.some(v => v && v.uploaded_by === clientUserId)
    : false
  return !clientUploaded
}

export function computeOpenRequests(documents, versionsByDoc, clientUserId) {
  const byStage = {}
  let total = 0
  const docs = Array.isArray(documents) ? documents : []
  const versions = versionsByDoc || {}
  for (const d of docs) {
    /* Derived from the primitive above — do not re-implement the
       condition here, or the counts and the row markers will drift. */
    if (!isOpenRequest(d, versions[d.id], clientUserId)) continue
    total += 1
    const key = stageKey(d)
    byStage[key] = (byStage[key] || 0) + 1
  }
  return { total, byStage }
}

/**
 * Query Supabase and return the current open-request counts for a
 * project + specific client. Never throws — returns {total:0, byStage:{}}
 * on any error so callers can render "no badge" gracefully.
 *
 * @param {string|null|undefined} projectId
 * @param {string|null|undefined} clientUserId
 * @returns {Promise<{ total:number, byStage:Object }>}
 */
export async function loadOpenDocRequests(projectId, clientUserId) {
  const empty = { total: 0, byStage: {} }
  if (!projectId) return empty
  try {
    /* Stage 1 — only view_edit rows can be "open requests". Server
       filters by project + client_access; RLS additionally gates by
       the caller's client_users row so a client can only see their
       own project's docs anyway. */
    const { data: docs, error: docsErr } = await supabase
      .from('project_documents')
      .select('id, stage, client_access')
      .eq('project_id',    projectId)
      .eq('client_access', 'view_edit')
    if (docsErr) throw docsErr
    if (!docs || docs.length === 0) return empty

    /* Stage 2 — pull document_versions with uploaded_by so we can
       tell client uploads from staff uploads. */
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

    return computeOpenRequests(docs, versionsByDoc, clientUserId)
  } catch (e) {
    console.warn('loadOpenDocRequests failed:', e)
    return empty
  }
}
