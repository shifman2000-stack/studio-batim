import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

/* ── Preview-mode write guard ──────────────────────────────────────
   Used by the admin-only "תצוגת לקוח" preview (ClientPreviewOverlay,
   opened from the project settings modal in ProjectsKanban.jsx): it
   mounts the REAL client-portal component tree under the admin's own
   session, with a synthetic project_id/contact instead of a real
   client login. That's the only way to reuse those screens unmodified
   — but it means every one of their existing write call sites (insert/
   update/upsert/delete, storage upload/remove, rpc, and auth.signOut)
   is reachable from inside the preview and would otherwise run for
   real against the admin's own authenticated session.

   Rather than hunting down and gating each call site individually
   (fragile — a future client-portal screen would silently be
   unprotected), this patches the shared `supabase` singleton ONCE so
   every mutation attempt anywhere in the app is blocked for as long as
   preview mode is active, app-wide, regardless of which component
   fires it. setSupabasePreviewMode(false) (called on preview close/
   unmount) is the only way to turn it back off. This is DEFENSE IN
   DEPTH on top of (not a replacement for) any preview-aware UI/handler
   checks — see ClientAccount.jsx's handleLogout for the one case
   (auth.signOut + navigate) a transport-level guard alone can't fix. */
let previewModeActive = false

export function setSupabasePreviewMode(active) {
  previewModeActive = !!active
}

export function isSupabasePreviewMode() {
  return previewModeActive
}

/* The code stamped on every write this guard blocks. Client-portal
   screens match on it (via isPreviewBlockedError below) to tell "the
   preview refused this on purpose" apart from a REAL failure, so they
   can stay silent instead of flashing a red "שגיאה בשמירה" banner at an
   admin who is only looking. */
export const PREVIEW_BLOCKED_CODE = 'PREVIEW_MODE_READ_ONLY'

const PREVIEW_BLOCKED = () => ({
  data: null,
  error: { message: 'תצוגת לקוח היא לצפייה בלבד — פעולת כתיבה נחסמה.', code: PREVIEW_BLOCKED_CODE },
})

/**
 * True when `err` is a write this preview guard blocked — NOT a real
 * error. Accepts either a Supabase `{ error }` payload's error object or
 * a value caught from `throw error`, since call sites use both shapes.
 * Deliberately narrow: anything without our own code (a genuine RLS
 * denial, a network drop) reads as false and still surfaces normally.
 */
export function isPreviewBlockedError(err) {
  return !!err && err.code === PREVIEW_BLOCKED_CODE
}

function guardMutations(builder, methods) {
  for (const method of methods) {
    const original = builder[method]
    if (typeof original !== 'function') continue
    builder[method] = function (...args) {
      if (previewModeActive) {
        console.warn(`[client preview] blocked ${method}()`, args)
        return Promise.resolve(PREVIEW_BLOCKED())
      }
      return original.apply(this, args)
    }
  }
  return builder
}

const originalFrom = supabase.from.bind(supabase)
supabase.from = (table) => guardMutations(originalFrom(table), ['insert', 'update', 'upsert', 'delete'])

const originalStorageFrom = supabase.storage.from.bind(supabase.storage)
supabase.storage.from = (bucket) =>
  guardMutations(originalStorageFrom(bucket), ['upload', 'update', 'remove', 'move', 'copy'])

const originalRpc = supabase.rpc.bind(supabase)
supabase.rpc = (...args) => {
  if (previewModeActive) {
    console.warn('[client preview] blocked rpc()', args)
    return Promise.resolve(PREVIEW_BLOCKED())
  }
  return originalRpc(...args)
}

const originalSignOut = supabase.auth.signOut.bind(supabase.auth)
supabase.auth.signOut = (...args) => {
  if (previewModeActive) {
    console.warn('[client preview] blocked auth.signOut()')
    return Promise.resolve({ error: null })
  }
  return originalSignOut(...args)
}
