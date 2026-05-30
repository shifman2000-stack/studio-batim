import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import '../../FinishingTab.css'
import '../../Professionals.css'  /* reuse .prof-autocomplete-* for supplier suggestions */
import '../../TasksTab.css'       /* reuse .tt-col-delete, .tt-row-delete-btn, .tt-delete-confirm-*, .tt-add-row-* */

/* Trash icon — copied verbatim from TasksTab.IconTrash2 */
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

/* ── Inline editable text cell (mirrors DocumentsTab's notes-input pattern) ── */
function InlineCell({ value, onSave }) {
  const [val, setVal]   = useState(value ?? '')
  const escapingRef     = useRef(false)
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
      className="ft-cell-input"
      dir="rtl"
    />
  )
}

/* ── Inline editable supplier cell with autocomplete (reuses prof-autocomplete-*) ── */
function InlineSupplierCell({ value, onSave, suggestions }) {
  const [val, setVal]         = useState(value ?? '')
  const [showSugg, setShowSugg] = useState(false)
  const escapingRef           = useRef(false)
  useEffect(() => { setVal(value ?? '') }, [value])

  const save = () => {
    if (escapingRef.current) { escapingRef.current = false; return }
    if (val !== (value ?? '')) onSave(val === '' ? null : val)
  }

  const matching = (() => {
    const q = val.trim().toLowerCase()
    if (!q) return suggestions
    return suggestions.filter(s => s.toLowerCase().includes(q) && s !== val.trim())
  })()

  const handleKey = e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      escapingRef.current = true
      setVal(value ?? '')
      setShowSugg(false)
      e.currentTarget.blur()
    }
  }

  return (
    <div className="prof-autocomplete-wrap">
      <input
        type="text"
        value={val}
        onChange={e => { setVal(e.target.value); setShowSugg(true) }}
        onFocus={() => setShowSugg(true)}
        onBlur={() => { setTimeout(() => setShowSugg(false), 150); save() }}
        onKeyDown={handleKey}
        className="ft-cell-input"
        autoComplete="off"
        dir="rtl"
      />
      {showSugg && matching.length > 0 && (
        <div className="prof-autocomplete-suggestions">
          {matching.map(s => (
            <button
              key={s}
              type="button"
              className="prof-autocomplete-suggestion"
              onMouseDown={e => {
                e.preventDefault()              /* keep input focused */
                setVal(s)
                setShowSugg(false)
                if (s !== (value ?? '')) onSave(s)
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Single item row (holds confirming state for the delete button) ── */
function FinishingRow({ item, index, onPatch, onSaveSupplier, supplierSuggestions, onDelete }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={'ft-row' + (index % 2 === 1 ? ' ft-row--even' : '')}>
      {/* Editable: element + guidance (now editable too) */}
      <div className="ft-col-element">
        <InlineCell value={item.element} onSave={v => onPatch(item.id, 'element', v)} />
      </div>
      <div className="ft-col-guidance">
        <InlineCell value={item.guidance} onSave={v => onPatch(item.id, 'guidance', v)} />
      </div>

      {/* Editable: client_choice / quantity / dimension / supplier / notes */}
      <div className="ft-col-client-choice">
        <InlineCell value={item.client_choice} onSave={v => onPatch(item.id, 'client_choice', v)} />
      </div>
      <div className="ft-col-quantity">
        <InlineCell value={item.quantity} onSave={v => onPatch(item.id, 'quantity', v)} />
      </div>
      <div className="ft-col-dimension">
        <InlineCell value={item.dimension} onSave={v => onPatch(item.id, 'dimension', v)} />
      </div>
      <div className="ft-col-supplier">
        <InlineSupplierCell
          value={item.supplier}
          onSave={v => onSaveSupplier(item.id, v)}
          suggestions={supplierSuggestions}
        />
      </div>
      <div className="ft-col-notes">
        <InlineCell value={item.notes} onSave={v => onPatch(item.id, 'notes', v)} />
      </div>

      {/* Delete cell — mirrors TasksTab.TaskRow exactly */}
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

/* ── "+ קטגוריה חדשה" inline form (mirrors TasksTab.AddTaskRow) ── */
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
 * FinishingTab — Phase 3: inline edit (all cells) + delete + add
 *
 * Lazy seeds project_finishing_materials from finishing_material_templates
 * on first open of an empty project, with Step-1 dedup guard mirroring
 * DocumentsTab.loadDocs.
 *
 * Editable cells: client_choice, quantity, dimension, supplier, notes.
 * Read-only:      element, guidance.
 *
 * Props:
 *   projectId  uuid — current project id
 * ──────────────────────────────────────────────────────────────── */
export default function FinishingTab({ projectId }) {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [supplierSuggestions, setSupplierSuggestions] = useState([])
  /* Categories the user created via "+ קטגוריה חדשה" that have no row yet.
     They render as empty groups; vanish on reload if no row was ever added. */
  const [pendingCategories, setPendingCategories] = useState([])

  /* General-notes section (projects.finishing_notes) */
  const [notes,         setNotes]         = useState('')
  const [notesSaved,    setNotesSaved]    = useState(null)   /* last persisted value (null or string) */
  const [notesLoading,  setNotesLoading]  = useState(true)

  /* PDF export — used for filename + button disabled state */
  const [projectName,   setProjectName]   = useState('')
  const [isExporting,   setIsExporting]   = useState(false)

  useEffect(() => { loadItems() }, [projectId])

  /* ── Fetch the project's general finishing notes ── */
  useEffect(() => {
    const fetchNotes = async () => {
      setNotesLoading(true)
      setNotes('')
      setNotesSaved(null)
      setProjectName('')
      const { data } = await supabase
        .from('projects')
        .select('finishing_notes, name')
        .eq('id', projectId)
        .single()
      if (data) {
        setNotes(data.finishing_notes ?? '')
        setNotesSaved(data.finishing_notes ?? null)
        setProjectName(data.name ?? '')
      }
      setNotesLoading(false)
    }
    fetchNotes()
  }, [projectId])

  /* ── Save the notes (on blur or Ctrl+Enter) ── */
  const saveNotes = async () => {
    if (notesLoading) return
    /* notes is always a string; notesSaved is null or string — normalize for comparison */
    if (notes === (notesSaved ?? '')) return
    const newVal = notes === '' ? null : notes
    await supabase.from('projects').update({ finishing_notes: newVal }).eq('id', projectId)
    setNotesSaved(newVal)
  }

  /* ── Export PDF via Puppeteer (mirrors QuoteBuilder.handleGeneratePDF) ── */
  const handleExportPdf = async () => {
    if (isExporting) return
    setIsExporting(true)
    try {
      /* Flush any pending notes so the PDF reflects what's on screen */
      if (!notesLoading && notes !== (notesSaved ?? '')) {
        await saveNotes()
      }

      const response = await fetch('/api/generate-finishing-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      /* Filename: חומרי-גמר_<project>_YYYY-MM-DD.pdf — spaces → hyphens, strip filesystem-unsafe chars */
      const today    = new Date().toISOString().slice(0, 10)
      const safeName = (projectName || 'פרויקט')
        .replace(/\s+/g, '-')
        .replace(/[\\/:*?"<>|]/g, '')
        .trim()
      a.download = `חומרי-גמר_${safeName}_${today}.pdf`
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

  /* ── Fetch distinct suppliers across the whole table (once per mount) ── */
  useEffect(() => {
    const fetchSuppliers = async () => {
      const { data } = await supabase
        .from('project_finishing_materials')
        .select('supplier')
        .not('supplier', 'is', null)
        .neq('supplier', '')
      if (data) {
        const unique = [...new Set(data.map(r => r.supplier).filter(Boolean))]
        setSupplierSuggestions(unique.sort((a, b) => a.localeCompare(b, 'he')))
      }
    }
    fetchSuppliers()
  }, [])

  const loadItems = async () => {
    setLoading(true)

    /* ── Step 1: clean up any duplicates (keep MIN id per project+template) ── */
    const { data: allRows } = await supabase
      .from('project_finishing_materials')
      .select('id, project_id, template_id')
      .not('template_id', 'is', null)
      .order('id', { ascending: true })

    if (allRows && allRows.length > 0) {
      const seen     = new Map()
      const toDelete = []
      for (const row of allRows) {
        const key = `${row.project_id}:${row.template_id}`
        if (seen.has(key)) {
          toDelete.push(row.id)
        } else {
          seen.set(key, row.id)
        }
      }
      if (toDelete.length > 0) {
        await supabase.from('project_finishing_materials').delete().in('id', toDelete)
      }
    }

    /* ── Step 2: use a count check before deciding to seed ── */
    const { count } = await supabase
      .from('project_finishing_materials')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)

    let data = null

    if (count === 0) {
      /* No rows yet — seed from templates */
      const { data: templates } = await supabase
        .from('finishing_material_templates')
        .select('*')
        .order('sort_order')

      if (templates && templates.length > 0) {
        const toInsert = templates.map(t => ({
          project_id:    projectId,
          template_id:   t.id,
          category:      t.category,
          element:       t.element,
          guidance:      t.guidance,
          client_choice: null,
          quantity:      null,
          dimension:     null,
          supplier:      t.default_supplier,
          notes:         t.default_notes,
          sort_order:    t.sort_order,
        }))
        const { data: inserted } = await supabase
          .from('project_finishing_materials')
          .insert(toInsert)
          .select('*')
          .order('sort_order')
        if (inserted) data = inserted
      }
    }

    /* ── Step 3: fetch current rows if not already set from insert ── */
    if (!data) {
      const { data: fetched } = await supabase
        .from('project_finishing_materials')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order')
      data = fetched
    }

    setItems(data || [])
    setPendingCategories([])   /* drop any pending categories on reload from DB */
    setLoading(false)
  }

  /* ── Patch one field on a row (optimistic, mirrors DocumentsTab.patchDoc) ── */
  const patchItem = async (id, field, value) => {
    setItems(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it))
    await supabase.from('project_finishing_materials').update({ [field]: value }).eq('id', id)
  }

  /* ── Supplier-specific save: patch + grow the local suggestions list ── */
  const saveSupplier = (id, newValue) => {
    patchItem(id, 'supplier', newValue)
    if (newValue && !supplierSuggestions.includes(newValue)) {
      setSupplierSuggestions(prev =>
        [...prev, newValue].sort((a, b) => a.localeCompare(b, 'he'))
      )
    }
  }

  /* ── Delete a row (mirrors TasksTab.deleteTask) ── */
  const deleteItem = async (id) => {
    await supabase.from('project_finishing_materials').delete().eq('id', id)
    setItems(prev => prev.filter(it => it.id !== id))
  }

  /* ── Add a new empty row under a category (existing, brand-new, or pending) ── */
  const addRow = async (category) => {
    const maxOrder = items.reduce((m, it) => Math.max(m, it.sort_order ?? 0), 0)
    const { data } = await supabase
      .from('project_finishing_materials')
      .insert([{
        project_id:    projectId,
        template_id:   null,
        category,
        element:       null,
        guidance:      null,
        client_choice: null,
        quantity:      null,
        dimension:     null,
        supplier:      null,
        notes:         null,
        sort_order:    maxOrder + 1,
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

  if (loading) return <p className="ft-loading">טוען חומרי גמר...</p>

  return (
    <div className="ft-root" dir="rtl">

      {items.length === 0 ? (
        <p className="ft-empty">לא נמצאו רשומות.</p>
      ) : (
        <div className="ft-table">

          {/* Column header */}
          <div className="ft-table-header">
            <div className="ft-col-element">אלמנט</div>
            <div className="ft-col-guidance">הנחיות לבחירה</div>
            <div className="ft-col-client-choice">בחירת הלקוח</div>
            <div className="ft-col-quantity">כמות</div>
            <div className="ft-col-dimension">מידה</div>
            <div className="ft-col-supplier">ספק</div>
            <div className="ft-col-notes">הערות</div>
            <div className="tt-col-delete" />
          </div>

          {/* Category groups */}
          {groups.map(({ category, items: catItems }) => (
            <Fragment key={category}>
              <div className="ft-category-header">{category}</div>
              {catItems.map((item, i) => (
                <FinishingRow
                  key={item.id}
                  item={item}
                  index={i}
                  onPatch={patchItem}
                  onSaveSupplier={saveSupplier}
                  supplierSuggestions={supplierSuggestions}
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

      {/* ── General notes section (below the table) ── */}
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

      {/* ── Export PDF button ── */}
      <div className="ft-pdf-section">
        <button
          type="button"
          className="ft-pdf-btn"
          onClick={handleExportPdf}
          disabled={isExporting}
        >
          {isExporting ? 'מייצר PDF...' : 'ייצא ל-PDF'}
        </button>
      </div>

    </div>
  )
}
