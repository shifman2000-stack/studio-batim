// src/pages/client/ClientContractorSpec.jsx
//
// Read-only client mirror of the manager's ContractorSpecTab. Shows
// project_contractor_spec grouped by `category` as an accordion (same
// chrome as ClientQuantities) + a bottom "הערות כלליות" block for
// projects.contractor_spec_notes.
//
// Per Nir's spec: an item is DISPLAYED only when quantity has a
// non-empty value. Items without a quantity are hidden even if they
// have a description or notes.

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

/* Display gate per Nir: keep only rows with a non-empty quantity. */
function isDisplayable(it) {
  return Boolean(clean(it.quantity))
}

export default function ClientContractorSpec() {
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
          .from('project_contractor_spec')
          .select('id, category, item, quantity, unit, notes, sort_order')
          .eq('project_id', project_id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('projects')
          .select('id, contractor_spec_notes')
          .eq('id', project_id)
          .maybeSingle(),
      ])
      if (cancelled) return

      if (itemsRes.error) {
        console.error('ClientContractorSpec — project_contractor_spec fetch error:', itemsRes.error)
      }
      setItems(Array.isArray(itemsRes.data) ? itemsRes.data : [])

      if (projectRes.error) {
        console.error('ClientContractorSpec — projects.contractor_spec_notes fetch error:', projectRes.error)
      }
      const rawNotes = projectRes.data?.contractor_spec_notes
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
    const itemName  = clean(it.item) || '—'
    const qty       = clean(it.quantity)
    const unit      = clean(it.unit)
    const itemNotes = clean(it.notes)
    return (
      <div key={it.id} className="cp-qty-item">
        <div className="cp-qty-item-name">{itemName}</div>
        {qty && (
          <div className="cp-row">
            <span className="cp-label">כמות:</span>
            <span className="cp-value">{qty}</span>
          </div>
        )}
        {unit && (
          <div className="cp-row">
            <span className="cp-label">יחידה:</span>
            <span className="cp-value">{unit}</span>
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
          <h1 className="cp-screen-title">מפרט לקבלן</h1>
          <div className="cp-loading"><p>טוען...</p></div>
        </div>
      </div>
    )
  }

  const noContent = grouped.length === 0 && !notes

  return (
    <div className="cp-page">
      <div className="cp-container">
        <h1 className="cp-screen-title">מפרט לקבלן</h1>

        {noContent ? (
          <section className="cp-card">
            <p className="cp-empty-card">אין נתוני מפרט לקבלן</p>
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
