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

const PREVIEW_BLOCKED = () => ({
  data: null,
  error: { message: 'תצוגת לקוח היא לצפייה בלבד — פעולת כתיבה נחסמה.', code: 'PREVIEW_MODE_READ_ONLY' },
})

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
