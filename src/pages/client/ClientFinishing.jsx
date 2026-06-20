// src/pages/client/ClientFinishing.jsx
//
// Read-only client mirror of the manager's FinishingTab. Shows
// project_finishing_materials grouped by `category` as an accordion
// (same chrome as ClientQuantities) + a bottom "הערות כלליות" block for
// projects.finishing_notes.
//
// Per Nir's spec: an item is DISPLAYED only when client_choice OR
// quantity has a non-empty value. Items where both are empty are hidden
// even if other fields (guidance, supplier, etc.) carry text.

import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'

const NOTES_KEY = '__notes__'

const IconChevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

const IconLightbulb = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#F6BF26" stroke="none">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26C17.81 13.47 19 11.38 19 9c0-3.87-3.13-7-7-7z"/>
    <path d="M10 20v1c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1h-4z"/>
  </svg>
)

function clean(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/* Display gate per Nir: keep only rows where client_choice OR quantity
   is non-empty. Other fields alone are not enough. */
function isDisplayable(it) {
  return Boolean(clean(it.client_choice) || clean(it.quantity))
}

export default function ClientFinishing() {
  const { project_id } = useClient()
  const [items,   setItems]   = useState([])
  const [notes,   setNotes]   = useState('')
  const [loading, setLoading] = useState(true)
  const [openSet, setOpenSet] = useState(new Set())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!project_id) { setLoading(false); return }
      const [itemsRes, projectRes] = await Promise.all([
        supabase
          .from('project_finishing_materials')
          .select('id, category, element, guidance, client_choice, quantity, dimension, supplier, notes, sort_order')
          .eq('project_id', project_id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('projects')
          .select('id, finishing_notes')
          .eq('id', project_id)
          .maybeSingle(),
      ])
      if (cancelled) return

      if (itemsRes.error) {
        console.error('ClientFinishing — project_finishing_materials fetch error:', itemsRes.error)
      }
      setItems(Array.isArray(itemsRes.data) ? itemsRes.data : [])

      if (projectRes.error) {
        console.error('ClientFinishing — projects.finishing_notes fetch error:', projectRes.error)
      }
      const rawNotes = projectRes.data?.finishing_notes
      const nextNotes = (typeof rawNotes === 'string' && rawNotes.trim() !== '')
        ? rawNotes
        : ''
      setNotes(nextNotes)

      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [project_id])

  const visibleItems = items.filter(isDisplayable)

  /* Group by category, preserving first-appearance order. Items with a
     null/blank category fall under 'כללי'. */
  const grouped = []
  {
    const idx = new Map()
    for (const it of visibleItems) {
      const key = clean(it.category) || 'כללי'
      let g = idx.get(key)
      if (!g) {
        g = { key, items: [] }
        idx.set(key, g)
        grouped.push(g)
      }
      g.items.push(it)
    }
  }

  const toggleOpen = (key) => {
    setOpenSet(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const handleHeaderKeyDown = (e, key) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleOpen(key)
    }
  }

  const renderItem = (it) => {
    const itemName = clean(it.element) || '—'
    const guidance = clean(it.guidance)
    const choice   = clean(it.client_choice)
    const qty      = clean(it.quantity)
    const dim      = clean(it.dimension)
    const supplier = clean(it.supplier)
    const itemNotes = clean(it.notes)
    return (
      <div key={it.id} className="cp-qty-item">
        <div className="cp-qty-item-name">{itemName}</div>
        {guidance && (
          <div className="cp-row">
            <span className="cp-label">הנחיות לבחירה:</span>
            <span className="cp-value">{guidance}</span>
          </div>
        )}
        {choice && (
          <div className="cp-row">
            <span className="cp-label">בחירת הלקוח:</span>
            <span className="cp-value">{choice}</span>
          </div>
        )}
        {qty && (
          <div className="cp-row">
            <span className="cp-label">כמות:</span>
            <span className="cp-value">{qty}</span>
          </div>
        )}
        {dim && (
          <div className="cp-row">
            <span className="cp-label">מידה:</span>
            <span className="cp-value">{dim}</span>
          </div>
        )}
        {supplier && (
          <div className="cp-row">
            <span className="cp-label">ספק:</span>
            <span className="cp-value">{supplier}</span>
          </div>
        )}
        {itemNotes && (
          <div className="cp-row">
            <span className="cp-label">הערות:</span>
            <span className="cp-value">{itemNotes}</span>
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="cp-page">
        <div className="cp-container">
          <h1 className="cp-screen-title">חומרי גמר</h1>
          <div className="cp-loading"><p>טוען...</p></div>
        </div>
      </div>
    )
  }

  const noContent = grouped.length === 0 && !notes

  return (
    <div className="cp-page">
      <div className="cp-container">
        <h1 className="cp-screen-title">חומרי גמר</h1>

        {noContent ? (
          <section className="cp-card">
            <p className="cp-empty-card">אין נתוני חומרי גמר</p>
          </section>
        ) : (
          <div className="cp-progress-accordion">
            {grouped.map(group => {
              const isOpen = openSet.has(group.key)
              return (
                <section key={group.key} className="cp-progress-block">
                  <div
                    className="cp-progress-header"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleOpen(group.key)}
                    onKeyDown={(e) => handleHeaderKeyDown(e, group.key)}
                  >
                    <span className="cp-progress-header-name">{group.key}</span>
                    <span className="cp-progress-header-caption">
                      {group.items.length} פריטים
                    </span>
                    <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                      <IconChevron size={16} />
                    </span>
                  </div>
                  {isOpen && (
                    <div className="cp-acc-body">
                      {group.items.map(renderItem)}
                    </div>
                  )}
                </section>
              )
            })}

            {notes && notes.trim() !== '' && (() => {
              const isOpen = openSet.has(NOTES_KEY)
              return (
                <section className="cp-progress-block">
                  <div
                    className="cp-progress-header"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleOpen(NOTES_KEY)}
                    onKeyDown={(e) => handleHeaderKeyDown(e, NOTES_KEY)}
                  >
                    <span className="cp-progress-header-name">הערות כלליות</span>
                    <span className="cp-qty-notes-tip-icon" aria-hidden="true">
                      <IconLightbulb size={16} />
                    </span>
                    <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                      <IconChevron size={16} />
                    </span>
                  </div>
                  {isOpen && (
                    <div className="cp-acc-body">
                      <p className="cp-qty-notes">{notes}</p>
                    </div>
                  )}
                </section>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
