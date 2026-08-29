// src/lib/contractorActionRequired.js
//
// THE contractor documents primitive — the single place that answers
// "does this row still want something from the contractor?".
//
// Modelled on lib/actionRequired.js's isDocumentActionRequired, and
// deliberately SEPARATE from it: the client and the contractor have
// different asking states ('upload' is a client state and never a
// contractor one) and different completion columns. Sharing the client
// function would mean one of the two callers passing a doc whose shape
// it does not actually have.
//
// Every consumer — the row marker, the header count, the per-row
// wording — resolves through this one function, so a badge can never
// disagree with the row it points at.

/* The states that ASK the contractor for something.
   'view' asks nothing. 'hidden' never reaches the client at all: the
   RLS SELECT policy filters it out, so there is deliberately no fourth
   branch anywhere in this feature. */
export const CONTRACTOR_ACTION_STATES = ['sign', 'approve']

/**
 * The single definition of "clear the contractor's recorded completion".
 *
 * The exact counterpart of CLIENT_COMPLETION_RESET in ./actionRequired.js,
 * and defined here for the same reason: changing a permission is a NEW
 * request, so whatever the contractor did before no longer answers what
 * is being asked. Leaving the stamp would make the row claim a signature
 * or an approval that was never given for the thing now on screen.
 *
 * It lives beside the contractor primitive rather than in actionRequired.js
 * so the two audiences' literals cannot be confused at the import site:
 * anything writing contractor_* imports from here, anything writing
 * client_* imports from there. The two objects share no keys, which is
 * what keeps a permission change for one audience from ever clearing the
 * other's completion.
 */
export const CONTRACTOR_COMPLETION_RESET = {
  contractor_completed_at: null,
  contractor_completed_by: null,
}

/**
 * @param {object|null|undefined} doc  a project_documents row carrying
 *                                     contractor_access + contractor_completed_at
 * @returns {boolean}
 */
export function isContractorActionRequired(doc) {
  if (!doc) return false
  if (!CONTRACTOR_ACTION_STATES.includes(doc.contractor_access)) return false
  return !doc.contractor_completed_at
}

/**
 * How many rows in an in-memory list still want something. Derived from
 * the primitive above rather than re-implementing the condition, so the
 * count and the markers cannot drift.
 */
export function countContractorActionRequired(documents) {
  const docs = Array.isArray(documents) ? documents : []
  let total = 0
  for (const d of docs) if (isContractorActionRequired(d)) total += 1
  return total
}
