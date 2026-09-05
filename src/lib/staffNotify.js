// src/lib/staffNotify.js
//
// The WRITE side of staff notifications.
//
// A row in public.staff_notifications exists because a CLIENT or a
// CONTRACTOR did something no staff member has looked at yet. Staff
// clicking the thing deletes it. Presence IS the notification — there is
// no seen flag and nothing is ever backfilled.
//
// ── WHY THE ACTION AND ROLE ARE PASSED IN, NOT DERIVED ───────────────
// Neither can be recovered after the fact, which is why they are written
// here at the moment of the act:
//   · A client UPLOAD and a client SIGN write byte-identical columns to
//     identical tables with identical values. The only thing that ever
//     distinguished them is client_access AT THE MOMENT OF THE ACT, and
//     that column is mutable afterwards (DocumentsTab's access popover,
//     PropagateAccessModal). No trigger could tell them apart.
//   · document_versions.uploaded_by cannot classify an actor: a uid can
//     be in BOTH client_users and contractor_users, which is already
//     true of one person on Dev.
//
// ── SHAPE: SEVEN NAMES, TWO WRITERS ──────────────────────────────────
// The exports are seven verb-named functions rather than one function
// taking (role, action). That is deliberate:
//   · Seven names make each call site self-describing and greppable —
//     `notifyClientSign(` finds exactly the place a sign is recorded,
//     which is the whole reason this module exists.
//   · But seven INDEPENDENT implementations would let the row shape
//     drift apart, which is the failure the module exists to prevent.
// So: seven names, two private writers. The names are the API; the row
// shape has exactly two definitions, one per stream, because the two
// streams genuinely differ in their success rule (see below).
//
// ── ROW-COUNT SEMANTICS DIFFER BY STREAM ─────────────────────────────
//   Document events    — plain insert. EXACTLY ONE row, or it failed.
//                        Three files uploaded to one document before
//                        anyone looks = three rows, and the row shows 3.
//                        That is real information: three things to see.
//   Questionnaire events — `on conflict do nothing`, against the PARTIAL
//                        unique index (project_id, action) where
//                        document_id is null. 1 row = newly raised,
//                        0 rows = already pending. BOTH ARE SUCCESS.
//                        "The client finished the questionnaire" is a
//                        STATE, not a quantity — ticking, unticking and
//                        re-ticking is still one thing to look at.
//
// The untargeted `ON CONFLICT DO NOTHING` matters: against a PARTIAL
// unique index, naming the columns (`on_conflict=project_id,action`)
// fails inference with 42P10 unless the predicate is restated. The bare
// form matches any unique index, partial included. In supabase-js that
// is `.upsert(row, { ignoreDuplicates: true })` with NO `onConflict`
// key. 23505 is ALSO treated as success on this path, so the behaviour
// holds even if that request shape ever changes.
//
// ── FAILURE POSTURE ──────────────────────────────────────────────────
// Nothing here can break the user's action. Every function catches its
// own errors and RESOLVES — never rejects, never throws — so a call site
// can fire-and-forget with `void` and an unhandled rejection is
// impossible. A failure costs the studio a dot; it never costs the
// client their upload. Failures go to console.error under the
// `[staffNotify]` prefix and nowhere else: this is studio-side
// observability, and routing it through logError would write to
// client_activity_log (a client-owned table) and add a second thing that
// can fail while handling a failure.

import { supabase } from '../supabaseClient'

/* Exported so the READ side (lib/staffNotifications.js) names the same
   table from the same place — one definition, no drift. */
export const STAFF_NOTIFICATIONS_TABLE = 'staff_notifications'
const TABLE = STAFF_NOTIFICATIONS_TABLE

/* ── Private writer: document-targeted events ─────────────────────────
   Exactly one row, or it failed. `.select('id')` is what makes a refusal
   visible — without it PostgREST answers 204 with no body and a refused
   insert is indistinguishable from a stored one. */
async function writeDocumentEvent(actorRole, action, { projectId, documentId, actorId }) {
  const tag = `[staffNotify] ${actorRole}/${action}`
  if (!projectId || !documentId || !actorId) {
    console.error(`${tag} skipped — missing ids`, { projectId, documentId, actorId })
    return false
  }
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        project_id:  projectId,
        document_id: documentId,
        actor_role:  actorRole,
        action,
        actor_id:    actorId,
      })
      .select('id')

    if (error) {
      console.error(`${tag} failed`, { projectId, documentId, code: error.code, error })
      return false
    }
    if (!Array.isArray(data) || data.length !== 1) {
      console.error(`${tag} affected ${data?.length ?? 0} rows, expected 1`, { projectId, documentId })
      return false
    }
    return true
  } catch (e) {
    console.error(`${tag} threw`, e)
    return false
  }
}

/* ── Private writer: questionnaire events ─────────────────────────────
   Project-targeted, never a document. Capped at one pending row per side
   by the partial unique index, so a re-tick while one is still pending
   is a silent no-op rather than a second dot — and never an error the
   client could see. */
async function writeQuestionnaireEvent(action, { projectId, actorId }) {
  const tag = `[staffNotify] client/${action}`
  if (!projectId || !actorId) {
    console.error(`${tag} skipped — missing ids`, { projectId, actorId })
    return false
  }
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        {
          project_id:  projectId,
          document_id: null,          /* explicit: the CHECK requires it */
          actor_role:  'client',
          action,
          actor_id:    actorId,
        },
        { ignoreDuplicates: true },   /* NO onConflict key — see header */
      )
      .select('id')

    if (error) {
      /* The cap held. Not a failure: a notification for this side is
         already pending, which is exactly the state we wanted. */
      if (error.code === '23505') return true
      console.error(`${tag} failed`, { projectId, code: error.code, error })
      return false
    }
    /* 1 row = newly raised. 0 rows = already pending. Both are success.
       0 cannot mean "RETURNING was filtered": actor_can_read_own_notification
       guarantees the actor can always read back a row they just wrote. */
    if (Array.isArray(data) && data.length === 0) {
      console.debug(`${tag} already pending — no new row`, { projectId })
    }
    return true
  } catch (e) {
    console.error(`${tag} threw`, e)
    return false
  }
}

/* ── The seven events ─────────────────────────────────────────────────
   Document events (all require a document):        הלקוח העלה קובץ
                                                    הלקוח חתם על הקובץ
                                                    הלקוח אישר את הקובץ
                                                    הקבלן חתם על הקובץ
                                                    הקבלן אישר את הקובץ
   Questionnaire events (project only, no document): הלקוח סיים את מילוי השאלון
                                                     הלקוח סיים את בונה הבית

   There is deliberately NO contractor upload: contractor_access is
   constrained to hidden | view | sign | approve, on both environments.
   The DB CHECK would reject ('contractor','upload') anyway. */

export const notifyClientUpload       = (args) => writeDocumentEvent('client',     'upload',  args)
export const notifyClientSign         = (args) => writeDocumentEvent('client',     'sign',    args)
export const notifyClientApprove      = (args) => writeDocumentEvent('client',     'approve', args)
export const notifyContractorSign     = (args) => writeDocumentEvent('contractor', 'sign',    args)
export const notifyContractorApprove  = (args) => writeDocumentEvent('contractor', 'approve', args)

export const notifyClientQuestionnaireDone = (args) => writeQuestionnaireEvent('questionnaire_done', args)
export const notifyClientHouseDone         = (args) => writeQuestionnaireEvent('house_done',         args)
