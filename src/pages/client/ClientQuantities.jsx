// src/pages/client/ClientQuantities.jsx
//
// Read-only client mirror of the manager's QuantitiesTab. Shows
// project_quantities grouped by `category` as an accordion (same chrome
// as the documents/progress screens), plus an optional bottom block for
// projects.quantities_notes when it is non-empty.
//
// No edit, no delete, no add, no inputs. The manager's dedupe + seed
// logic stays in the manager view.

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

/* Filled lightbulb — a "tip" affordance shown only on the "הערות
   כלליות" block header. Solid amber so it reads as a friendly heads-up
   on the cream palette; no stroke. Two sub-shapes: the bulb body and a
   small base bar underneath. */
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

/* Whether a row carries any displayable content. The item NAME is NOT a
   criterion on its own — an item that has only a name (no measurements,
   no description, no image) is treated as a blank slot and hidden.
   image_url alone is enough to keep the item visible. */
function isDisplayable(it) {
  return Boolean(
    clean(it.qty_sqm) ||
    clean(it.units) ||
    clean(it.dimensions) ||
    clean(it.description) ||
    clean(it.image_url)
  )
}

export default function ClientQuantities() {
  const { project_id } = useClient()
  const [items,   setItems]   = useState([])
  const [notes,   setNotes]   = useState('')
  const [loading, setLoading] = useState(true)
  /* All accordion blocks collapsed on mount; the notes block shares the
     same open-set under the reserved key '__notes__'. */
  const [openSet, setOpenSet] = useState(new Set())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!project_id) { setLoading(false); return }
      const [itemsRes, projectRes] = await Promise.all([
        supabase
          .from('project_quantities')
          .select('id, category, item, qty_sqm, units, dimensions, description, image_url, sort_order')
          .eq('project_id', project_id)
          .order('sort_order', { ascending: true }),
        /* Notes fetch — broadened to include `id` (avoids a few edge
           cases where a single-column .single() returned an error) and
           switched to .maybeSingle() to match the forgiving pattern used
           by ClientFile, so an empty/edge response can't suppress the
           value silently. */
        supabase
          .from('projects')
          .select('id, quantities_notes')
          .eq('id', project_id)
          .maybeSingle(),
      ])
      if (cancelled) return

      if (itemsRes.error) {
        console.error('ClientQuantities — project_quantities fetch error:', itemsRes.error)
      }
      setItems(Array.isArray(itemsRes.data) ? itemsRes.data : [])

      if (projectRes.error) {
        console.error('ClientQuantities — projects.quantities_notes fetch error:', projectRes.error)
      }
      /* Preserve the raw multi-line string verbatim. Bypass clean()
         entirely — it forced the value through String(v).trim() and
         returned only the trimmed copy, which is fine for short labels
         but is the wrong handler for content where internal whitespace
         and surrounding line breaks are meaningful. We only ever
         normalise away the case where the value is a non-string or a
         purely-whitespace string. */
      const rawNotes = projectRes.data?.quantities_notes
      const nextNotes = (typeof rawNotes === 'string' && rawNotes.trim() !== '')
        ? rawNotes
        : ''
      /* Diagnostic — concise; safe to keep. Confirms whether the value
         survived the trip from PostgREST without being mangled. */
      console.log(
        '[ClientQuantities] notes payload:',
        JSON.stringify(projectRes.data),
        '| stored:',
        JSON.stringify(nextNotes),
      )
      setNotes(nextNotes)

      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [project_id])

  /* Filter out rows the manager seeded but never filled in. Categories
     left with zero displayable items naturally disappear (no group is
     created when no item ever falls into it). The header caption count
     then reflects the visible-only count automatically. */
  const visibleItems = items.filter(isDisplayable)

  /* Group by category, preserving first-appearance order. The rows
     already arrive sorted by sort_order from the DB. Items with a
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
    const itemName = clean(it.item) || '—'
    const qtySqm   = clean(it.qty_sqm)
    const units    = clean(it.units)
    const dims     = clean(it.dimensions)
    const desc     = clean(it.description)
    const img      = clean(it.image_url)
    return (
      <div key={it.id} className="cp-qty-item">
        <div className="cp-qty-item-name">{itemName}</div>
        {qtySqm && (
          <div className="cp-row">
            <span className="cp-label">כמות במ&quot;ר:</span>
            <span className="cp-value">{qtySqm}</span>
          </div>
        )}
        {units && (
          <div className="cp-row">
            <span className="cp-label">מספר יחידות:</span>
            <span className="cp-value">{units}</span>
          </div>
        )}
        {dims && (
          <div className="cp-row">
            <span className="cp-label">מידות בס&quot;מ:</span>
            <span className="cp-value">{dims}</span>
          </div>
        )}
        {desc && (
          <div className="cp-row">
            <span className="cp-label">תיאור:</span>
            <span className="cp-value">{desc}</span>
          </div>
        )}
        {img && (
          <img className="cp-qty-item-image" src={img} alt={itemName} />
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="cp-page">
        <div className="cp-container">
          <h1 className="cp-screen-title">כתב כמויות</h1>
          <div className="cp-loading"><p>טוען...</p></div>
        </div>
      </div>
    )
  }

  const noContent = grouped.length === 0 && !notes

  return (
    <div className="cp-page">
      <div className="cp-container">
        <h1 className="cp-screen-title">כתב כמויות</h1>

        {noContent ? (
          <section className="cp-card">
            <p className="cp-empty-card">אין נתוני כתב כמויות</p>
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

            {/* "הערות כלליות" — extra block at the very bottom, only when
                projects.quantities_notes is non-empty. Same chrome, no
                items count caption, starts collapsed like the rest. The
                guard explicitly re-checks .trim() so a whitespace-only
                value never produces an empty block. */}
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
