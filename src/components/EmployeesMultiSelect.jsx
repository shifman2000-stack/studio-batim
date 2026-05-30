import { useEffect, useRef, useState } from 'react'
import './EmployeesMultiSelect.css'

/* ────────────────────────────────────────────────────────────────
 * EmployeesMultiSelect — shared multi-select used by both:
 *   • /hours → דוחות tab (admin only)
 *   • /reports/hours
 *
 * Props:
 *   employees    Array<{id, first_name, last_name}>
 *   selectedIds  Set<id>
 *   onChange     (next: Set<id>) => void
 *
 * Button label:
 *   • "כל העובדים" when all are selected
 *   • employee full name when exactly one is selected
 *   • "{n} עובדים" when 2+ are partially selected
 *   • "אין עובדים נבחרים" when zero
 *
 * Panel: "כל העובדים" toggle at the top + one row per employee,
 * alphabetical by full name (Hebrew locale).
 * Click-outside closes the panel.
 * ──────────────────────────────────────────────────────────────── */
export default function EmployeesMultiSelect({ employees, selectedIds, onChange }) {
  const [open, setOpen] = useState(false)
  /* Inline style for the panel — uses position:fixed coordinates derived from
     the button's getBoundingClientRect. This makes the panel float above any
     ancestor overflow boundary (e.g. .hours-form-panel { overflow-y: auto }). */
  const [panelStyle, setPanelStyle] = useState({})
  const wrapRef   = useRef(null)
  const buttonRef = useRef(null)

  /* Compute the panel position from the button's bounding rect (viewport coords). */
  const computePanelStyle = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      top:      `${rect.bottom + 4}px`,
      right:    `${window.innerWidth - rect.right}px`,   /* RTL: anchor to right */
      minWidth: `${rect.width}px`,
    }
  }

  const openPanel = () => {
    const style = computePanelStyle()
    if (style) setPanelStyle(style)
    setOpen(true)
  }

  /* Close on outside click */
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  /* Reposition the panel when any ancestor scrolls or the window resizes
     (capture:true catches scroll on inner overflow containers, not just window). */
  useEffect(() => {
    if (!open) return
    const recompute = () => {
      const style = computePanelStyle()
      if (style) setPanelStyle(style)
    }
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    return () => {
      window.removeEventListener('scroll', recompute, true)
      window.removeEventListener('resize', recompute)
    }
  }, [open])

  const fullName = (e) => [e.first_name, e.last_name].filter(Boolean).join(' ').trim()

  /* Alphabetical by full name (Hebrew locale). */
  const sorted = [...employees].sort((a, b) => fullName(a).localeCompare(fullName(b), 'he'))

  const allSelected = sorted.length > 0 && sorted.every(e => selectedIds.has(e.id))

  const toggleAll = () => {
    if (allSelected) onChange(new Set())
    else onChange(new Set(sorted.map(e => e.id)))
  }

  const toggleOne = (id) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }

  /* Button label */
  let label
  if (allSelected)               label = 'כל העובדים'
  else if (selectedIds.size === 0) label = 'אין עובדים נבחרים'
  else if (selectedIds.size === 1) {
    const emp = sorted.find(e => selectedIds.has(e.id))
    label = emp ? fullName(emp) : '1 עובדים'
  } else label = `${selectedIds.size} עובדים`

  return (
    <div className="emp-mselect" ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="emp-mselect-btn"
        onClick={() => (open ? setOpen(false) : openPanel())}
        title={label}
      >
        <span className="emp-mselect-label">{label}</span>
        <span className="emp-mselect-arrow">▾</span>
      </button>

      {open && (
        <div className="emp-mselect-panel" style={panelStyle}>
          <label className="emp-mselect-row emp-mselect-row--all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
            />
            <span>כל העובדים</span>
          </label>
          <div className="emp-mselect-divider" />
          {sorted.map(emp => (
            <label key={emp.id} className="emp-mselect-row">
              <input
                type="checkbox"
                checked={selectedIds.has(emp.id)}
                onChange={() => toggleOne(emp.id)}
              />
              <span>{fullName(emp) || '—'}</span>
            </label>
          ))}
          {sorted.length === 0 && (
            <div className="emp-mselect-empty">אין עובדים</div>
          )}
        </div>
      )}
    </div>
  )
}
