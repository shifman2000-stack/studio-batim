// src/components/common/CategoryHeaderRow.jsx
//
// The category header shared by the three spec tabs — כתב כמויות,
// חומרי גמר and מפרט לקבלן. They are near-identical screens, so the
// delete-a-whole-category affordance lives here ONCE rather than being
// pasted into each; the only per-screen difference is the CSS prefix.
//
// The affordance deliberately mirrors the per-ROW delete already on
// these screens: same IconTrash2, same .tt-row-delete-btn styling, same
// .tt-col-delete slot (so the two trash icons line up in one column),
// and the same inline .tt-delete-confirm "כן / לא" pattern rather than a
// new dialog style. Two levels of the same gesture, one visual language.
//
// RTL: the name is the FIRST child so it paints on the visual right; the
// trash is LAST, landing on the visual left in the same 28px column as
// every row's trash beneath it.
//
// The confirmation is required — this removes many rows at once — and
// names the category and the number of items so the click is never
// ambiguous. Deleting is the caller's job; this component only asks.

import { useState } from 'react'

/* Trash icon — identical to the one each tab already uses for a row. */
const IconTrash2 = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

/* Reads naturally at every count instead of "ואת 0 הפריטים שבה". */
function confirmText(category, itemCount) {
  if (itemCount === 0) return `למחוק את הקטגוריה '${category}'?`
  if (itemCount === 1) return `למחוק את הקטגוריה '${category}' ואת הפריט שבה?`
  return `למחוק את הקטגוריה '${category}' ואת ${itemCount} הפריטים שבה?`
}

/**
 * @param {string}   prefix     screen CSS prefix — 'qt' | 'ft' | 'cs'
 * @param {string}   category   category name, shown and confirmed against
 * @param {number}   itemCount  how many rows will be removed
 * @param {Function} onDelete   async () => void — throws / rejects on failure
 * @param {string}   error      inline message to show (caller-owned)
 */
export default function CategoryHeaderRow({ prefix, category, itemCount, onDelete, error }) {
  const [confirming, setConfirming] = useState(false)
  const [busy,       setBusy]       = useState(false)

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onDelete()
      /* On success this row unmounts with its category, so there is no
         state to reset. On failure we fall through and reopen. */
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className={`${prefix}-category-header`}>
      <span className={`${prefix}-category-name`}>{category}</span>

      {error && <span className="tt-cat-delete-error">{error}</span>}

      {confirming ? (
        <div className="tt-delete-confirm">
          <span className="tt-delete-confirm-text">{confirmText(category, itemCount)}</span>
          <button type="button" className="tt-delete-confirm-yes"
            onClick={handleConfirm} disabled={busy}>כן</button>
          <button type="button" className="tt-delete-confirm-no"
            onClick={() => setConfirming(false)} disabled={busy}>לא</button>
        </div>
      ) : (
        <div className="tt-col-delete">
          <button type="button" className="tt-row-delete-btn"
            onClick={() => setConfirming(true)} title="מחק קטגוריה">
            <IconTrash2 />
          </button>
        </div>
      )}
    </div>
  )
}
