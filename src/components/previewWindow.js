// src/components/previewWindow.js
//
// The floating-window mechanics shared by the staff previews —
// "תצוגת לקוח" (ClientPreviewOverlay) and "תצוגת קבלן"
// (ContractorPreviewOverlay): where the window spawns, dragging it by
// its header, and re-anchoring once the real device frame exists to be
// measured.
//
// ⚠️ EXTRACTED, NOT REWRITTEN. Every rule below was already load-bearing
// in ClientPreviewOverlay and is reproduced exactly:
//
//   · Positions come from getBoundingClientRect(), never from the
//     frame's CSS width/height. .cpv-device-frame is visually shrunk
//     with transform: scale(.83), so its layout box (422×~908) is NOT
//     what is on screen — mixing the two is what broke dragging the
//     last time a scale() was tried.
//   · The re-measure runs ONCE, and is skipped entirely if the admin
//     already dragged the window, so it can never clobber a manual move.
//   · The window listeners are removed on mouseup AND on unmount, so
//     closing mid-drag leaves nothing behind.
//
// The markup stays with each overlay: the two banners differ (the
// contractor one can carry a second line), and a shared component would
// have to grow props for every difference.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const DEFAULT_MARGIN = 24

/* Synchronous fallback for the very first paint, before the frame
   exists in the DOM to measure — .cpv-device-frame's real (unscaled)
   size is 422×876 (390×844 screen + 16px padding on every side), and
   the CSS scale(0.83) shrinks its RENDERED footprint to roughly this.
   Corrected against the actual measured box the moment it mounts. */
const FALLBACK_WIDTH = 350
const FALLBACK_HEIGHT = 727

export function defaultPreviewPosition(width = FALLBACK_WIDTH, height = FALLBACK_HEIGHT) {
  const x = Math.max(DEFAULT_MARGIN, window.innerWidth - width - DEFAULT_MARGIN)
  const y = Math.max(DEFAULT_MARGIN, window.innerHeight - height - DEFAULT_MARGIN)
  return { x, y }
}

/**
 * @param {boolean} readyToMeasure true once the real device frame is in
 *   the DOM (i.e. the overlay is past its loading/error state).
 * @returns {{ pos, frameRef, startDrag, stopDragPropagation }}
 */
export function usePreviewWindow(readyToMeasure) {
  const [pos, setPos] = useState(defaultPreviewPosition)
  const dragRef = useRef(null)      // { startX, startY, origX, origY } while dragging
  const didDragRef = useRef(false)  // true once the admin has ever dragged
  const measuredRef = useRef(false)
  const frameRef = useRef(null)     // the rendered (post-transform) frame element

  useLayoutEffect(() => {
    if (!readyToMeasure || measuredRef.current || didDragRef.current) return
    const el = frameRef.current
    if (!el) return
    measuredRef.current = true
    const rect = el.getBoundingClientRect()
    setPos(defaultPreviewPosition(rect.width, rect.height))
  }, [readyToMeasure])

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

  const startDrag = useCallback((e) => {
    e.preventDefault()
    didDragRef.current = true
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
  }, [pos.x, pos.y])

  /* The close button lives inside the draggable header — stop its own
     mousedown from also starting a drag. */
  const stopDragPropagation = useCallback((e) => e.stopPropagation(), [])

  return { pos, frameRef, startDrag, stopDragPropagation }
}

/**
 * Escape closes the window. Bound while `active`, removed on unmount —
 * so a closed preview never keeps a key handler on the document.
 */
export function usePreviewEscape(active, onClose) {
  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onClose])
}
