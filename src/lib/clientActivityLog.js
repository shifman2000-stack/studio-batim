// src/lib/clientActivityLog.js
//
// Client-portal usability logging into the existing `client_activity_log`
// table (columns: id, project_id, client_user_id, session_id, screen_key,
// event_type 'screen_view'|'action'|'error', action_name, duration_ms,
// metadata jsonb, created_at — table + RLS already exist in Supabase;
// this module only writes application code against them, never DDL).
//
// RLS only grants clients INSERT (their own rows) — there is no client
// UPDATE policy. So screen-view duration is NOT "insert now, update
// later": startScreenView() just timestamps a screen entry LOCALLY (no
// network call), and endScreenView() computes the elapsed time and
// performs ONE insert carrying duration_ms already filled in. Every
// write this module ever makes is a plain insert.
//
// Call shapes:
//   startScreenView(screenKey, ctx) → local handle (sync, no I/O).
//   endScreenView(handle) → enqueues the finished screen_view row.
//   logError(screenKey, errorCode, ctx, metadata?)
//
// `ctx` is always { projectId, clientUserId, previewMode } — every
// caller already has these three from useClient(). previewMode is
// checked FIRST in every exported function: nothing here ever writes
// while an admin is viewing through "תצוגת לקוח" preview (see
// ClientPreviewOverlay.jsx) — belt-and-suspenders alongside the
// separate Supabase-wide write guard in supabaseClient.js, which would
// block the insert anyway but we skip even attempting it.
//
// session_id is generated once per browser TAB via sessionStorage (not
// localStorage — a fresh tab should be a fresh session, and two tabs
// open on the same client shouldn't share one).
//
// Every event (screen_view / action / error) is queued in memory and
// flushed as a single batched INSERT (debounced, or immediately on
// pagehide/tab-hide) so a burst of activity costs one network
// round-trip, not one per event.

import { supabase, isSupabasePreviewMode } from '../supabaseClient'

const SESSION_STORAGE_KEY = 'cp_activity_session_id'
const FLUSH_DEBOUNCE_MS = 600

let fallbackSessionId = null

function newId() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!id) {
      id = newId()
      sessionStorage.setItem(SESSION_STORAGE_KEY, id)
    }
    return id
  } catch {
    /* sessionStorage unavailable (privacy mode, etc.) — an in-memory id
       still keeps events from the same page load grouped together. */
    if (!fallbackSessionId) fallbackSessionId = newId()
    return fallbackSessionId
  }
}

function blocked(ctx) {
  return !ctx || ctx.previewMode || isSupabasePreviewMode() || !ctx.projectId
}

/* ── Batched insert queue (every event type goes through this) ────── */

let queue = []
let flushTimer = null

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(flushQueue, FLUSH_DEBOUNCE_MS)
}

function flushQueue() {
  flushTimer = null
  if (queue.length === 0) return
  const batch = queue
  queue = []
  supabase
    .from('client_activity_log')
    .insert(batch)
    .then(({ error }) => {
      if (error) console.warn('[activity log] batched insert failed:', error)
    })
}

/* Called from ClientPortal's pagehide/visibilitychange handlers so
   queued events sitting in the debounce window aren't lost when the
   tab closes or backgrounds. Safe to call with an empty queue. */
export function flushActivityLogQueueNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  flushQueue()
}

function enqueue(eventType, screenKey, ctx, extra) {
  if (blocked(ctx) || !screenKey) return
  queue.push({
    project_id:      ctx.projectId,
    client_user_id:  ctx.clientUserId || null,
    session_id:      getSessionId(),
    screen_key:      screenKey,
    event_type:      eventType,
    ...extra,
  })
  scheduleFlush()
}

/* ── screen_view ────────────────────────────────────────────────────
   startScreenView is synchronous and does no I/O — it only stamps
   "when did the client land on this screen" locally. The row itself
   isn't queued until endScreenView knows the duration. */

export function startScreenView(screenKey, ctx) {
  if (blocked(ctx) || !screenKey) return null
  return { screenKey, ctx, startedAt: Date.now() }
}

export function endScreenView(handle) {
  if (!handle) return
  const duration_ms = Math.max(0, Date.now() - handle.startedAt)
  enqueue('screen_view', handle.screenKey, handle.ctx, { duration_ms })
}

/* ── error ────────────────────────────────────────────────────────
   The portal logs SCREEN VIEWS (with duration) and ERRORS. There is
   deliberately no action logger any more: the per-feature action
   events it wrote were removed, and the 'action' event_type stays in
   the schema only so the rows already recorded remain readable. */

export function logError(screenKey, errorCode, ctx, metadata) {
  if (!errorCode) return
  enqueue('error', screenKey, ctx, { metadata: { error_code: errorCode, ...(metadata || {}) } })
}
