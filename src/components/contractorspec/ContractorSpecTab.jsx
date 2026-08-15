import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import CategoryHeaderRow from '../../components/common/CategoryHeaderRow'
import { DEFAULT_CONTRACTOR_SPEC_NOTES } from '../../lib/projectNotesDefaults'
import '../../ContractorSpecTab.css'
import '../../TasksTab.css'       /* reuse .tt-col-delete, .tt-row-delete-btn, .tt-delete-confirm-*, .tt-add-row-* */
import '../../FinishingTab.css'   /* reuse .ft-notes-* and .ft-pdf-* visual styles */

/* Trash icon — copied verbatim from FinishingTab/QuantitiesTab/TasksTab */
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
      className="cs-cell-input"
      dir="rtl"
    />
  )
}

/* ── Single item row (holds confirming state for the delete button) ── */
function ContractorSpecRow({ item, index, onPatch, onDelete }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={'cs-row' + (index % 2 === 1 ? ' cs-row--even' : '')}>
      {/* Editable: item / quantity / unit / notes */}
      <div className="cs-col-item">
        <InlineCell value={item.item} onSave={v => onPatch(item.id, 'item', v)} />
      </div>
      <div className="cs-col-quantity">
        <InlineCell value={item.quantity} onSave={v => onPatch(item.id, 'quantity', v)} />
      </div>
      <div className="cs-col-unit">
        <InlineCell value={item.unit} onSave={v => onPatch(item.id, 'unit', v)} />
      </div>
      <div className="cs-col-notes">
        <InlineCell value={item.notes} onSave={v => onPatch(item.id, 'notes', v)} />
      </div>

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
 * ContractorSpecTab — Phase 2: inline edit + delete + add (per category /
 * new pending category) + general notes + PDF export.
 * Mirrors FinishingTab / QuantitiesTab exactly.
 * ──────────────────────────────────────────────────────────────── */
export default function ContractorSpecTab({ projectId }) {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  /* Categories the user created via "+ קטגוריה חדשה" that have no row yet. */
  const [pendingCategories, setPendingCategories] = useState([])
  /* category name → inline error from a failed category delete */
  const [categoryErrors, setCategoryErrors] = useState({})

  /* General-notes section (projects.contractor_spec_notes) */
  const [notes,         setNotes]         = useState('')
  const [notesSaved,    setNotesSaved]    = useState(null)
  const [notesLoading,  setNotesLoading]  = useState(true)

  /* PDF export */
  const [projectName,   setProjectName]   = useState('')
  const [isExporting,   setIsExporting]   = useState(false)
  const [exportError,   setExportError]   = useState('')   /* inline auth/network error shown next to the button */

  useEffect(() => { loadItems() }, [projectId])

  /* ── Fetch the project's contractor-spec notes + name ── */
  useEffect(() => {
    const fetchNotes = async () => {
      setNotesLoading(true)
      setNotes('')
      setNotesSaved(null)
      setProjectName('')
      const { data } = await supabase
        .from('projects')
        .select('contractor_spec_notes, name')
        .eq('id', projectId)
        .single()
      if (data) {
        setProjectName(data.name ?? '')
        if (data.contractor_spec_notes === null) {
          /* Auto-seed: NULL means "never set". Persist the default once
             so the read-only client portal also sees the text. The
             `.is('contractor_spec_notes', null)` guard makes the write
             atomic — concurrent tabs race-safely no-op against a row
             that's already been seeded. An explicit '' is a deliberate
             "no notes" choice and is NOT seeded. */
          try {
            const { error } = await supabase
              .from('projects')
              .update({ contractor_spec_notes: DEFAULT_CONTRACTOR_SPEC_NOTES })
              .eq('id', projectId)
              .is('contractor_spec_notes', null)
            if (error) throw error
            setNotes(DEFAULT_CONTRACTOR_SPEC_NOTES)
            setNotesSaved(DEFAULT_CONTRACTOR_SPEC_NOTES)
          } catch (e) {
            console.error('ContractorSpecTab — auto-seed notes failed:', e)
            setNotes(DEFAULT_CONTRACTOR_SPEC_NOTES)
            setNotesSaved(null)
          }
        } else {
          setNotes(data.contractor_spec_notes)
          setNotesSaved(data.contractor_spec_notes)
        }
      }
      setNotesLoading(false)
    }
    fetchNotes()
  }, [projectId])

  /* ── Save notes (on blur or Ctrl+Enter) ── */
  const saveNotes = async () => {
    if (notesLoading) return
    if (notes === (notesSaved ?? '')) return
    const newVal = notes === '' ? null : notes
    await supabase.from('projects').update({ contractor_spec_notes: newVal }).eq('id', projectId)
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
      if (!notesLoading && notes !== (notesSaved ?? '')) {
        await saveNotes()
      }

      const response = await fetch('/api/generate-contractor-spec-pdf', {
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
      const today    = new Date().toISOString().slice(0, 10)
      const safeName = (projectName || 'פרויקט')
        .replace(/\s+/g, '-')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim()
      a.download = `מפרט-לקבלן_${safeName}_${today}.pdf`
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

    /* ── Step 1: fetch current rows. Seeding from contractor_spec_templates
       now happens in a DB trigger at project-creation time, not here. ── */
    const { data } = await supabase
      .from('project_contractor_spec')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order')

    setItems(data || [])
    setPendingCategories([])   /* drop any pending categories on reload from DB */
    setLoading(false)
  }

  /* ── Patch one field on a row (optimistic) ── */
  const patchItem = async (id, field, value) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
    await supabase.from('project_contractor_spec').update({ [field]: value }).eq('id', id)
  }

  /* ── Delete a row ── */
  const deleteItem = async (id) => {
    await supabase.from('project_contractor_spec').delete().eq('id', id)
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
      .from('project_contractor_spec')
      .delete()
      .eq('project_id', projectId)
      .eq('category',   category)

    if (error) {
      console.error('ContractorSpecTab — category delete failed:', error)
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
      .from('project_contractor_spec')
      .insert([{
        project_id:  projectId,
        template_id: null,
        category,
        item:        null,
        quantity:    null,
        unit:        null,
        notes:       null,
        sort_order:  maxOrder + 1,
      }])
      .select()
      .single()
    if (data) {
      setItems(prev => [...prev, data])
      setPendingCategories(prev => prev.filter(c => c !== category))
    }
  }

  /* ── Add a category to local pending state only (no DB write) ── */
  const addPendingCategory = (name) => {
    const trimmed = (name ?? '').trim()
    if (!trimmed) return
    if (items.some(it => it.category === trimmed)) return
    if (pendingCategories.includes(trimmed)) return
    setPendingCategories(prev => [...prev, trimmed])
  }

  /* ── Group by category preserving first-appearance order ── */
  const groupedMap = new Map()
  items.forEach(item => {
    if (!groupedMap.has(item.category)) groupedMap.set(item.category, [])
    groupedMap.get(item.category).push(item)
  })
  const groups = [...groupedMap.entries()].map(([category, list]) => ({ category, items: list }))
  pendingCategories.forEach(cat => {
    if (!groupedMap.has(cat)) groups.push({ category: cat, items: [] })
  })

  if (loading) return <p className="cs-loading">טוען מפרט לקבלן...</p>

  return (
    <div className="cs-root" dir="rtl">

      {items.length === 0 ? (
        <p className="cs-empty">לא נמצאו רשומות.</p>
      ) : (
        <div className="cs-table">

          {/* Column header */}
          <div className="cs-table-header">
            <div className="cs-col-item">תאור</div>
            <div className="cs-col-quantity">כמות</div>
            <div className="cs-col-unit">יחידה</div>
            <div className="cs-col-notes">הערות</div>
            <div className="tt-col-delete" />
          </div>

          {/* Category groups */}
          {groups.map(({ category, items: catItems }) => (
            <Fragment key={category}>
              <CategoryHeaderRow
                prefix="cs"
                category={category}
                itemCount={catItems.length}
                onDelete={() => deleteCategory(category)}
                error={categoryErrors[category]}
              />
              {catItems.map((item, i) => (
                <ContractorSpecRow
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

          {/* New category at the very bottom — pending state only (no DB write) */}
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
          rows={5}
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
