// src/components/ClientPreviewOverlay.jsx
//
// Admin-only "תצוגת לקוח" preview — opened from the project settings
// modal (ProjectsKanban.jsx). Renders the REAL client-portal component
// tree (ClientPortal.jsx and everything under it, unmodified) inside a
// mobile device-frame mockup, exactly as the project's first client
// contact would see it — WITHOUT a real client auth session and
// WITHOUT any risk of writing data.
//
// A FLOATING, draggable window — not a blocking modal. There is no
// backdrop: the rest of the app stays fully visible and interactive
// underneath. The frame is position:fixed, dragged by its own header
// (the preview banner), and defaults near the bottom-right corner so it
// doesn't start on top of the settings modal that opened it.
//
// Sizing: .cpv-device-screen (the element ClientPortal actually mounts
// into) is a REAL 390×844 CSS viewport — iPhone 14's exact size — so
// the portal's own responsive layout/media queries see a genuine phone
// viewport, not an arbitrary shrunk one. To still make the whole thing
// fit comfortably on a laptop screen, ONLY the outer .cpv-device-frame
// wrapper is visually shrunk, via `transform: scale(0.83)` with
// `transform-origin: top left` (matching the physical left/top
// positioning used below) — see ClientPreviewOverlay.css. Because that
// scale changes the frame's RENDERED size without changing its layout
// width/height, every position/bounds calculation in this file uses
// getBoundingClientRect() (the actual, post-transform box) rather than
// the frame's raw CSS width/height — that mismatch is exactly what
// broke dragging the last time a scale() was tried here.
//
// How it avoids a real client session:
//   ClientRoute.jsx exports `ClientContext` precisely so a caller can
//   supply its own { id, project_id, first_name } and skip the real
//   guard (which normally authenticates via Supabase auth + a
//   client_users row). We do that here, adding `previewMode: true` to
//   the context value — read by ClientAccount.jsx to defuse its
//   sign-out button.
//
// How it stays read-only:
//   setSupabasePreviewMode(true) flips a module-level flag in
//   supabaseClient.js that makes every write call (insert/update/
//   upsert/delete/rpc/storage upload-remove/auth.signOut) anywhere in
//   the app resolve as a harmless no-op for as long as this overlay is
//   mounted — see the guard's own comment for why that's centralized
//   there instead of touching every client screen individually.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase, setSupabasePreviewMode } from '../supabaseClient'
import { ClientContext } from './ClientRoute'
import ClientPortal from '../pages/ClientPortal'
import './ClientPreviewOverlay.css'

const DEFAULT_MARGIN = 24
/* Synchronous fallback for the very first paint, before the frame
   exists in the DOM to measure — .cpv-device-frame's real (unscaled)
   size is 422×876 (390×844 screen + 16px padding on every side), and
   the CSS scale(0.83) shrinks its RENDERED footprint to roughly this.
   Corrected against the actual measured box the moment it mounts — see
   the useLayoutEffect below. */
const FALLBACK_WIDTH = 350
const FALLBACK_HEIGHT = 727

function defaultPosition(width = FALLBACK_WIDTH, height = FALLBACK_HEIGHT) {
  const x = Math.max(DEFAULT_MARGIN, window.innerWidth  - width  - DEFAULT_MARGIN)
  const y = Math.max(DEFAULT_MARGIN, window.innerHeight - height - DEFAULT_MARGIN)
  return { x, y }
}

/**
 * @param {{ project: { id: string, name: string }, onClose: () => void }} props
 */
export default function ClientPreviewOverlay({ project, onClose }) {
  const [phase,   setPhase]   = useState('loading') // 'loading' | 'ready' | 'empty' | 'error'
  const [contact, setContact] = useState(null)
  const [pos, setPos] = useState(defaultPosition)
  const dragRef = useRef(null) // { startX, startY, origX, origY } while dragging, else null
  const didDragRef = useRef(false) // true once the admin has ever dragged — stops the re-measure below from clobbering a manual move
  const frameRef = useRef(null) // the rendered (post-transform) .cpv-device-frame element

  /* Flip the write guard on for the overlay's entire lifetime, and back
     off unconditionally on close/unmount — including an accidental
     unmount (e.g. the admin navigating away some other way), so a
     preview session can never leave the app in a locked-down state. */
  useEffect(() => {
    setSupabasePreviewMode(true)
    return () => setSupabasePreviewMode(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setPhase('loading')
      if (!project?.id) { setPhase('error'); return }
      /* "First client user of the project" = earliest project_contacts
         row (the primary contact) — created_at ascending, id as a
         deterministic tiebreak since uuid PKs don't sort chronologically. */
      const { data, error } = await supabase
        .from('project_contacts')
        .select('id, first_name, last_name, email')
        .eq('project_id', project.id)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      if (error) { setPhase('error'); return }
      if (!data) { setPhase('empty'); return }
      setContact(data)
      setPhase('ready')
    }
    load()
    return () => { cancelled = true }
  }, [project?.id])

  /* Once the real device-frame first mounts, re-anchor the default
     spawn position against its ACTUAL rendered (post scale(0.83)) box
     via getBoundingClientRect() instead of the FALLBACK_WIDTH/HEIGHT
     estimate above — the frame's raw CSS width/height (422×~908) is
     NOT what's visually on screen, only the transformed box is. Runs
     once; skipped entirely if the admin already dragged the loading/
     error/empty status panel to somewhere else before this fired. */
  const measuredRef = useRef(false)
  useLayoutEffect(() => {
    if (phase !== 'ready' || measuredRef.current || didDragRef.current) return
    const el = frameRef.current
    if (!el) return
    measuredRef.current = true
    const rect = el.getBoundingClientRect()
    setPos(defaultPosition(rect.width, rect.height))
  }, [phase])

  /* ── Dragging — plain mouse listeners on window while a drag is live,
     started from the header/banner only (see the drag-handle elements
     below). Cleaned up on mouseup AND on unmount, so closing the window
     mid-drag never leaves stray listeners behind. */
  useEffect(() => {
    const handleMove = (e) => {
      if (!dragRef.current) return
      const { startX, startY, origX, origY } = dragRef.current
      setPos({ x: origX + (e.clientX - startX), y: origY + (e.clientY - startY) })
    }
    const handleUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [])

  const startDrag = (e) => {
    e.preventDefault()
    didDragRef.current = true
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }
  /* The close button lives inside the draggable header — stop its own
     mousedown from also starting a drag. */
  const stopDragPropagation = (e) => e.stopPropagation()

  const contactName = contact
    ? [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim() || 'לקוח'
    : ''

  if (phase !== 'ready') {
    const statusText =
        phase === 'loading' ? 'טוען...'
      : phase === 'error'   ? 'שגיאה בטעינת איש הקשר של הפרויקט.'
      : 'אין עדיין איש קשר לקוח בפרויקט זה'
    return (
      <div className="cpv-status-panel" dir="rtl" style={{ left: pos.x, top: pos.y }}>
        <div className="cpv-status-header" onMouseDown={startDrag}>
          <span>תצוגת לקוח</span>
          <button
            type="button"
            className="cpv-close-btn"
            onMouseDown={stopDragPropagation}
            onClick={onClose}
            aria-label="סגור תצוגת לקוח"
            title="סגור תצוגת לקוח"
          >
            ✕
          </button>
        </div>
        <p className="cpv-status-text">{statusText}</p>
      </div>
    )
  }

  return (
    <div className="cpv-device-frame" dir="rtl" ref={frameRef} style={{ left: pos.x, top: pos.y }}>
      {/* cpv-device-screen is the position:fixed containing block for
          everything ClientPortal renders (drawer, drawer overlay,
          sticky footer, etc.) — see ClientPreviewOverlay.css for why
          that requires an explicit CSS containment trick. It's also a
          REAL 390×844 viewport (see the file-header comment) — do not
          shrink this element itself; only .cpv-device-frame (the
          ancestor) is visually scaled down. */}
      <div className="cpv-device-screen">
        <div className="cpv-device-notch" aria-hidden="true" />
        <div className="cpv-preview-banner" onMouseDown={startDrag}>
          <span className="cpv-preview-banner-text">
            תצוגת לקוח — {contactName} · צפייה בלבד
          </span>
          <button
            type="button"
            className="cpv-close-btn cpv-close-btn--frame"
            onMouseDown={stopDragPropagation}
            onClick={onClose}
            aria-label="סגור תצוגת לקוח"
            title="סגור תצוגת לקוח"
          >
            ✕
          </button>
        </div>
        <div className="cpv-portal-mount">
          <ClientContext.Provider
            value={{
              id: contact.id,
              project_id: project.id,
              first_name: contact.first_name || '',
              previewMode: true,
            }}
          >
            <ClientPortal />
          </ClientContext.Provider>
        </div>
      </div>
    </div>
  )
}
