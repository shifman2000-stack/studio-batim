import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { DEFAULT_QUANTITIES_NOTES } from '../../lib/projectNotesDefaults'
import CategoryHeaderRow from '../common/CategoryHeaderRow'
import '../../QuantitiesTab.css'
import '../../TasksTab.css'       /* reuse .tt-col-delete, .tt-row-delete-btn, .tt-delete-confirm-*, .tt-add-row-* */
import '../../FinishingTab.css'   /* reuse .ft-notes-* and .ft-pdf-* visual styles */

/* Trash icon — copied verbatim from FinishingTab.IconTrash2 / TasksTab.IconTrash2 */
const IconTrash2 = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

/* ── Inline editable text cell (mirrors FinishingTab.InlineCell exactly) ── */
function InlineCell({ value, onSave }) {
  const [val, setVal] = useState(value ?? '')
  const escapingRef   = useRef(false)
  useEffect(() => { setVal(value ?? '') }, [value])

  const save = () => {
    if (escapingRef.current) { escapingRef.current = false; return }
    if (val !== (value ?? '')) onSave(val === '' ? null : val)
  }

  const handleKey = e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()           /* triggers onBlur → save */
    } else if (e.key === 'Escape') {
      e.preventDefault()
      escapingRef.current = true       /* skip save on the upcoming blur */
      setVal(value ?? '')
      e.currentTarget.blur()
    }
  }

  return (
    <input
      type="text"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={handleKey}
      className="qt-cell-input"
      dir="rtl"
    />
  )
}

/* ── Single item row (holds confirming state for the delete button) ── */
function QuantitiesRow({ item, index, onPatch, onDelete }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={'qt-row' + (index % 2 === 1 ? ' qt-row--even' : '')}>
      {/* Editable: item / qty_sqm / units / dimensions / description */}
      <div className="qt-col-item">
        <InlineCell value={item.item} onSave={v => onPatch(item.id, 'item', v)} />
      </div>
      <div className="qt-col-qty-sqm">
        <InlineCell value={item.qty_sqm} onSave={v => onPatch(item.id, 'qty_sqm', v)} />
      </div>
      <div className="qt-col-units">
        <InlineCell value={item.units} onSave={v => onPatch(item.id, 'units', v)} />
      </div>
      <div className="qt-col-dimensions">
        <InlineCell value={item.dimensions} onSave={v => onPatch(item.id, 'dimensions', v)} />
      </div>
      <div className="qt-col-description">
        <InlineCell value={item.description} onSave={v => onPatch(item.id, 'description', v)} />
      </div>

      {/* Non-editable in this phase: image */}
      <div className="qt-col-image">—</div>

      {/* Delete cell — mirrors FinishingRow / TaskRow exactly */}
      <div className="tt-col-delete">
        {confirming ? (
          <div className="tt-delete-confirm">
            <span className="tt-delete-confirm-text">למחוק?</span>
            <button type="button" className="tt-delete-confirm-yes" onClick={() => onDelete(item.id)}>כן</button>
            <button type="button" className="tt-delete-confirm-no" onClick={() => setConfirming(false)}>לא</button>
          </div>
        ) : (
          <button type="button" className="tt-row-delete-btn" onClick={() => setConfirming(true)} title="מחק פריט">
            <IconTrash2 />
          </button>
        )}
      </div>
    </div>
  )
}

/* ── "+ קטגוריה חדשה" inline form (mirrors FinishingTab.AddCategoryRow) ── */
function AddCategoryRow({ onAdd }) {
  const [adding, setAdding] = useState(false)
  const [name,   setName]   = useState('')
  const inputRef            = useRef(null)

  const confirm = async () => {
    if (!name.trim()) return
    await onAdd(name.trim())
    setName(''); setAdding(false)
  }

  if (!adding) {
    return (
      <button type="button" className="tt-add-row-link"
        onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 0) }}>
        + קטגוריה חדשה
      </button>
    )
  }

  return (
    <div className="tt-add-row-inline">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { setAdding(false); setName('') } }}
        className="tt-add-row-input"
        placeholder="שם הקטגוריה..."
        dir="rtl"
      />
      <button type="button" className="tt-add-row-confirm" onClick={confirm}>אישור</button>
      <button type="button" className="tt-add-row-cancel" onClick={() => { setAdding(false); setName('') }}>ביטול</button>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
 * QuantitiesTab — Phase 2: inline edit + delete + add (per category /
 * new pending category). Mirrors FinishingTab exactly.
 *
 * Props:
 *   projectId  uuid — current project id
 * ──────────────────────────────────────────────────────────────── */
export default function QuantitiesTab({ projectId }) {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  /* Categories the user created via "+ קטגוריה חדשה" that have no row yet.
     They render as empty groups; vanish on reload if no row was ever added. */
  const [pendingCategories, setPendingCategories] = useState([])
  /* category name → inline error from a failed category delete */
  const [categoryErrors, setCategoryErrors] = useState({})

  /* General-notes section (projects.quantities_notes) */
  const [notes,         setNotes]         = useState('')
  const [notesSaved,    setNotesSaved]    = useState(null)   /* last persisted value (null or string) */
  const [notesLoading,  setNotesLoading]  = useState(true)

  /* PDF export — used for filename + button disabled state */
  const [projectName,   setProjectName]   = useState('')
  const [isExporting,   setIsExporting]   = useState(false)
  const [exportError,   setExportError]   = useState('')   /* inline auth/network error shown next to the button */

  useEffect(() => { loadItems() }, [projectId])

  /* ── Fetch the project's general quantities notes + name ── */
  useEffect(() => {
    const fetchNotes = async () => {
      setNotesLoading(true)
      setNotes('')
      setNotesSaved(null)
      setProjectName('')
      const { data } = await supabase
        .from('projects')
        .select('quantities_notes, name')
        .eq('id', projectId)
        .single()
      if (data) {
        setProjectName(data.name ?? '')
        if (data.quantities_notes === null) {
          /* Auto-seed: NULL in the DB means "never set". Persist the
             default text once so the read-only client portal — which has
             no synthesis logic — also sees these bullets. The
             `.is('quantities_notes', null)` clause makes the write
             atomic: even with two tabs racing, only the row that's still
             null is updated; the other write is a no-op against an
             already-seeded row. An explicit empty string ('') is a
             deliberate "no notes" choice and is NOT seeded. */
          try {
            const { error } = await supabase
              .from('projects')
              .update({ quantities_notes: DEFAULT_QUANTITIES_NOTES })
              .eq('id', projectId)
              .is('quantities_notes', null)
            if (error) throw error
            setNotes(DEFAULT_QUANTITIES_NOTES)
            setNotesSaved(DEFAULT_QUANTITIES_NOTES)   /* state now matches DB */
          } catch (e) {
            console.error('QuantitiesTab — auto-seed notes failed:', e)
            /* Keep the UX intact — the manager still sees the default in
               the textarea — but leave notesSaved as null so a later
               onBlur (or the next mount) can retry the seed. */
            setNotes(DEFAULT_QUANTITIES_NOTES)
            setNotesSaved(null)
          }
        } else {
          /* Non-null branch — including a deliberate '' empty string —
             shown as-is. saveNotes' dirty check keeps onBlur a no-op
             unless the user actually edits. */
          setNotes(data.quantities_notes)
          setNotesSaved(data.quantities_notes)
        }
      }
      setNotesLoading(false)
    }
    fetchNotes()
  }, [projectId])

  /* ── Save the notes (on blur or Ctrl+Enter) ── */
  const saveNotes = async () => {
    if (notesLoading) return
    if (notes === (notesSaved ?? '')) return
    const newVal = notes === '' ? null : notes
    await supabase.from('projects').update({ quantities_notes: newVal }).eq('id', projectId)
    setNotesSaved(newVal)
  }

  /* ── Export PDF via Puppeteer (mirrors FinishingTab.handleExportPdf) ── */
  const handleExportPdf = async () => {
    if (isExporting) return
    setExportError('')

    /* The PDF endpoint requires the caller's Supabase access token in
       the Authorization header. If there's no session, ask the user to
       sign in again before doing any work. */
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      setExportError('יש להתחבר מחדש')
      return
    }

    setIsExporting(true)
    try {
      /* Flush any pending notes so the PDF reflects what's on screen */
      if (!notesLoading && notes !== (notesSaved ?? '')) {
        await saveNotes()
      }

      const response = await fetch('/api/generate-quantities-pdf', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectId }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        console.error('PDF API error:', err)
        alert('שגיאה בייצור PDF. נסי שוב.')
        return
      }

      const blob = await response.blob()
      const url  = window.URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      /* Filename: כתב-כמויות_<project>_YYYY-MM-DD.pdf */
      const today    = new Date().toISOString().slice(0, 10)
      const safeName = (projectName || 'פרויקט')
        .replace(/\s+/g, '-')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim()
      a.download = `כתב-כמויות_${safeName}_${today}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF export error:', err)
      alert('שגיאה בייצור PDF.')
    } finally {
      setIsExporting(false)
    }
  }

  const loadItems = async () => {
    setLoading(true)

    /* ── Step 1: fetch current rows. Seeding from quantities_templates now
       happens in a DB trigger at project-creation time, not here. ── */
    const { data } = await supabase
      .from('project_quantities')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order')

    setItems(data || [])
    setPendingCategories([])   /* drop any pending categories on reload from DB */
    setLoading(false)
  }

  /* ── Patch one field on a row (optimistic, mirrors FinishingTab.patchItem) ── */
  const patchItem = async (id, field, value) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
    await supabase.from('project_quantities').update({ [field]: value }).eq('id', id)
  }

  /* ── Delete a row (mirrors FinishingTab.deleteItem) ── */
  const deleteItem = async (id) => {
    await supabase.from('project_quantities').delete().eq('id', id)
    setItems(prev => prev.filter(it => it.id !== id))
  }

  /* ── Delete a WHOLE category — this project's rows only ──
     One request: a single DELETE filtered by project_id + category, so
     no other project is touched and the template table is never read or
     written. Optimistic, with the previous list restored and an inline
     error shown if the DB rejects it — the screen must never show a
     category as gone while the row is still there. */
  const deleteCategory = async (category) => {
    setCategoryErrors(prev => {
      if (!(category in prev)) return prev
      const next = { ...prev }
      delete next[category]
      return next
    })

    const doomed = items.filter(it => it.category === category)
    if (doomed.length === 0) {
      /* A pending category has no DB rows at all — local removal only. */
      setPendingCategories(prev => prev.filter(c => c !== category))
      return
    }

    const backup = items
    setItems(prev => prev.filter(it => it.category !== category))

    const { error } = await supabase
      .from('project_quantities')
      .delete()
      .eq('project_id', projectId)
      .eq('category',   category)

    if (error) {
      console.error('QuantitiesTab — category delete failed:', error)
      setItems(backup)
      setCategoryErrors(prev => ({ ...prev, [category]: 'מחיקת הקטגוריה נכשלה' }))
      return
    }
    setPendingCategories(prev => prev.filter(c => c !== category))
  }

  /* ── Add a new empty row under a category (existing, brand-new, or pending) ── */
  const addRow = async (category) => {
    const maxOrder = items.reduce((m, it) => Math.max(m, it.sort_order ?? 0), 0)
    const { data } = await supabase
      .from('project_quantities')
      .insert([{
        project_id:  projectId,
        template_id: null,
        category,
        item:        null,
        qty_sqm:     null,
        units:       null,
        dimensions:  null,
        description: null,
        image_url:   null,
        sort_order:  maxOrder + 1,
      }])
      .select()
      .single()
    if (data) {
      setItems(prev => [...prev, data])
      /* a pending category is now backed by a real row — remove it from pending */
      setPendingCategories(prev => prev.filter(c => c !== category))
    }
  }

  /* ── Add a category to local pending state only (no DB write) ── */
  const addPendingCategory = (name) => {
    const trimmed = (name ?? '').trim()
    if (!trimmed) return
    /* skip duplicates against either existing items or already-pending categories */
    if (items.some(it => it.category === trimmed)) return
    if (pendingCategories.includes(trimmed)) return
    setPendingCategories(prev => [...prev, trimmed])
  }

  /* ── Group by category preserving first-appearance order (Map keeps insertion order) ── */
  const groupedMap = new Map()
  items.forEach(item => {
    if (!groupedMap.has(item.category)) groupedMap.set(item.category, [])
    groupedMap.get(item.category).push(item)
  })
  const groups = [...groupedMap.entries()].map(([category, list]) => ({ category, items: list }))
  /* Append pending categories that have no items yet — empty groups at the bottom */
  pendingCategories.forEach(cat => {
    if (!groupedMap.has(cat)) groups.push({ category: cat, items: [] })
  })

  if (loading) return <p className="qt-loading">טוען כתב כמויות...</p>

  return (
    <div className="qt-root" dir="rtl">

      {items.length === 0 ? (
        <p className="qt-empty">לא נמצאו רשומות.</p>
      ) : (
        <div className="qt-table">

          {/* Column header */}
          <div className="qt-table-header">
            <div className="qt-col-item">פריט</div>
            <div className="qt-col-qty-sqm">כמות במ"ר</div>
            <div className="qt-col-units">מספר יחידות</div>
            <div className="qt-col-dimensions">מידות בס"מ</div>
            <div className="qt-col-description">תיאור / הערות</div>
            <div className="qt-col-image">תמונה</div>
            <div className="tt-col-delete" />
          </div>

          {/* Category groups */}
          {groups.map(({ category, items: catItems }) => (
            <Fragment key={category}>
              <CategoryHeaderRow
                prefix="qt"
                category={category}
                itemCount={catItems.length}
                onDelete={() => deleteCategory(category)}
                error={categoryErrors[category]}
              />
              {catItems.map((item, i) => (
                <QuantitiesRow
                  key={item.id}
                  item={item}
                  index={i}
                  onPatch={patchItem}
                  onDelete={deleteItem}
                />
              ))}
              <button type="button" className="tt-add-row-link" onClick={() => addRow(category)}>
                + הוסף פריט
              </button>
            </Fragment>
          ))}

          {/* New category at the very bottom — adds to local pending state only (no DB write) */}
          <AddCategoryRow onAdd={addPendingCategory} />

        </div>
      )}

      {/* ── General notes section (below the table) — reuses .ft-notes-* styles ── */}
      <div className="ft-notes-section">
        <div className="ft-notes-title">הערות כלליות</div>
        <textarea
          className="ft-notes-textarea"
          value={notesLoading ? '' : notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={saveNotes}
          onKeyDown={e => {
            /* Ctrl/Cmd+Enter saves; plain Enter inserts a newline (textarea default). */
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          disabled={notesLoading}
          rows={7}
          dir="rtl"
        />
      </div>

      {/* ── Export PDF button — reuses .ft-pdf-* styles ── */}
      <div className="ft-pdf-section">
        <button
          type="button"
          className="ft-pdf-btn"
          onClick={handleExportPdf}
          disabled={isExporting}
        >
          {isExporting ? 'מייצר PDF...' : 'ייצא ל-PDF'}
        </button>
        {exportError && (
          <span style={{
            marginInlineStart: 12,
            color: '#a83232',
            fontFamily: "'Heebo', sans-serif",
            fontSize: 13,
            fontWeight: 400,
          }}>
            {exportError}
          </span>
        )}
      </div>

    </div>
  )
}
