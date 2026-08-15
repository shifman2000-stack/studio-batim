// src/components/tasks/TaskStatusControl.jsx
//
// THE status control — the coloured icon that opens the פעיל / דחוף /
// הושלם dropdown. Lifted verbatim out of ProjectDetail's משימות tab so
// the meeting-summary cards can use the same widget rather than a
// look-alike. One component, one set of icons and colours, one dropdown
// behaviour, everywhere status is shown.
//
// The option list is whatever the caller passes in `options`, so a
// screen that may only offer a subset (the client portal offers two of
// the three) filters the list instead of forking the component. An
// option may carry a `label` to override the text shown for it; the
// icon and colour always come from the real `name`, so "בוצע" still
// paints as the green check that הושלם paints as everywhere else.
//
// Styling lives in Tasks.css (.tasks-status-*), imported here so the
// dependency is explicit rather than relying on another screen having
// pulled it into the bundle first.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../../Tasks.css'

const STATUS_META = {
  'דחוף':  { color: '#E24B4A' },
  'פעיל':  { color: '#F6BF26' },
  'הושלם': { color: '#1D9E75' },
}

export function statusColorByName(name) {
  return STATUS_META[name]?.color || STATUS_META['פעיל'].color
}

const IconClock = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
)
const IconCheckCircle = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
)

export function statusIcon(status, size = 18) {
  if (status === 'הושלם') return <IconCheckCircle size={size} />
  return <IconClock size={size} />
}

export default function TaskStatusControl({ statusId, statusName, options, onSelect }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, right: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleOpen() {
    if (open) { setOpen(false); return }
    const rect  = triggerRef.current.getBoundingClientRect()
    const popH  = 116
    const below = rect.bottom + 4
    const above = rect.top - popH - 4
    const top   = below + popH > window.innerHeight ? above : below
    setPos({ top, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  const list    = options || []
  const current = list.find(o => o.id === statusId)
  const curName = statusName || current?.name || 'פעיל'
  /* Colour and icon follow the real status name; only the visible text
     honours a caller-supplied label. */
  const curText = current?.label || curName

  return (
    <div className="tasks-status-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="tasks-status-trigger"
        style={{ color: statusColorByName(curName) }}
        onClick={handleOpen}
        title={curText}
      >
        {statusIcon(curName)}
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="tasks-status-popover"
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
        >
          {list.map(opt => (
            <button
              key={opt.id}
              type="button"
              className={'tasks-status-option' + (opt.id === statusId ? ' tasks-status-option--active' : '')}
              onClick={() => { setOpen(false); onSelect(opt.id, opt.name) }}
            >
              <span style={{ color: statusColorByName(opt.name), display: 'flex', alignItems: 'center' }}>
                {statusIcon(opt.name, 15)}
              </span>
              <span>{opt.label || opt.name}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}
