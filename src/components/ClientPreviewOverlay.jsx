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

import { useEffect, useState } from 'react'
import { supabase, setSupabasePreviewMode } from '../supabaseClient'
import { ClientContext } from './ClientRoute'
import ClientPortal from '../pages/ClientPortal'
import { usePreviewWindow, usePreviewEscape } from './previewWindow'
import './ClientPreviewOverlay.css'

/* ⚠️ The spawn position, the dragging and the one-time re-measure moved
   to previewWindow.js, unchanged, so "תצוגת קבלן" uses the same window
   rather than a second copy of it. The reasons they are written the way
   they are — getBoundingClientRect() over CSS width/height, measure
   once, never after a manual drag — are documented there. */

/**
 * @param {{ project: { id: string, name: string }, onClose: () => void }} props
 */
export default function ClientPreviewOverlay({ project, onClose }) {
  const [phase,   setPhase]   = useState('loading') // 'loading' | 'ready' | 'empty' | 'error'
  const [contact, setContact] = useState(null)
  const { pos, frameRef, startDrag, stopDragPropagation } = usePreviewWindow(phase === 'ready')
  usePreviewEscape(true, onClose)

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
