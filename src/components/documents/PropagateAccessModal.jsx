// src/components/documents/PropagateAccessModal.jsx
//
// "Share this client_access value with child projects too" — opened
// from DocumentsTab.jsx's dt-propagate-btn (parent projects only, on a
// row whose client_access is already 'view'/'view_edit'). Offers three
// ways to pick which children to apply it to, then bulk-updates the
// matching project_documents rows (same template_id as the parent's
// row) in those children. Never touches the parent's own row — that's
// already set via the regular ClientAccessPopover flow before this
// modal ever opens.
//
// Modal chrome mirrors this app's established small-CRUD modal recipe
// (ppm-modal / cit-modal / prof-modal — overlay, white rounded box,
// header/body/footer); the mode picker mirrors InquiryForm.jsx's
// checkbox-group recipe; the model dropdown mirrors
// ParentProjectModelsReport.jsx's "בחר פרויקט אב" <select>.

import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import '../../DocumentsTab.css'

const ACCESS_LABEL = { view: 'צפייה בלבד', view_edit: 'עריכה' }

export default function PropagateAccessModal({ parentProjectId, templateId, docName, accessValue, onClose }) {
  const [mode, setMode] = useState('all') // 'all' | 'model' | 'manual'

  const [children, setChildren]   = useState([])
  const [loadingChildren, setLoadingChildren] = useState(true)
  const [models, setModels]       = useState([])
  const [loadingModels, setLoadingModels]     = useState(true)

  const [selectedModelId, setSelectedModelId]   = useState('')
  const [selectedChildIds, setSelectedChildIds] = useState([])

  const [applying, setApplying] = useState(false)
  const [error, setError]       = useState('')
  const [resultSummary, setResultSummary] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoadingChildren(true)
      setLoadingModels(true)
      const [{ data: childRows }, { data: modelRows }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name, selected_model_id')
          .eq('parent_project_id', parentProjectId)
          .eq('archived', false)
          .order('name', { ascending: true }),
        supabase
          .from('project_models')
          .select('id, name')
          .eq('project_id', parentProjectId)
          .order('created_at', { ascending: true }),
      ])
      if (cancelled) return
      setChildren(childRows || [])
      setModels(modelRows || [])
      setLoadingChildren(false)
      setLoadingModels(false)
    }
    load()
    return () => { cancelled = true }
  }, [parentProjectId])

  const toggleChild = (id) => {
    setSelectedChildIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleApply = async () => {
    setError('')

    let targetIds = []
    if (mode === 'all') {
      targetIds = children.map(c => c.id)
    } else if (mode === 'model') {
      if (!selectedModelId) { setError('יש לבחור דגם.'); return }
      targetIds = children.filter(c => c.selected_model_id === selectedModelId).map(c => c.id)
    } else {
      targetIds = selectedChildIds
    }

    if (targetIds.length === 0) { setError('לא נבחרו פרויקטי-בן.'); return }

    setApplying(true)
    try {
      /* Find the matching document row (same template_id) in each target
         child — a child with no such row (not yet at that stage, or the
         row was deleted) is silently skipped, never created. */
      const { data: matchedRows, error: findErr } = await supabase
        .from('project_documents')
        .select('id, project_id')
        .eq('template_id', templateId)
        .in('project_id', targetIds)
      if (findErr) throw findErr

      if (matchedRows && matchedRows.length > 0) {
        const { error: updErr } = await supabase
          .from('project_documents')
          .update({ client_access: accessValue })
          .in('id', matchedRows.map(r => r.id))
        if (updErr) throw updErr
      }

      const matchedProjectCount = new Set((matchedRows || []).map(r => r.project_id)).size
      setResultSummary(`עודכן ב-${matchedProjectCount} מתוך ${targetIds.length} פרויקטי-בן`)
    } catch (e) {
      console.error('propagate client_access error:', e)
      setError('שגיאה בעדכון פרויקטי-הבן. נסה שוב.')
    }
    setApplying(false)
  }

  return (
    <div className="dt-propagate-overlay" onClick={() => { if (!applying) onClose() }}>
      <div className="dt-propagate-modal" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="dt-propagate-header">
          <span className="dt-propagate-title">שיתוף עם פרויקטי-בן</span>
          <button type="button" className="dt-propagate-close" onClick={onClose} disabled={applying}>×</button>
        </div>

        <div className="dt-propagate-body">
          <p className="dt-propagate-subtitle">
            {docName} — <strong>{ACCESS_LABEL[accessValue] || accessValue}</strong>
          </p>

          {!resultSummary ? (
            <>
              <div className="dt-propagate-modes">
                <label className="dt-propagate-mode-row">
                  <input type="radio" name="propagate-mode" checked={mode === 'all'} onChange={() => setMode('all')} />
                  <span>שיתוף לכל הבנים</span>
                </label>
                <label className="dt-propagate-mode-row">
                  <input type="radio" name="propagate-mode" checked={mode === 'model'} onChange={() => setMode('model')} />
                  <span>שיתוף לכל הבנים לפי דגם</span>
                </label>
                <label className="dt-propagate-mode-row">
                  <input type="radio" name="propagate-mode" checked={mode === 'manual'} onChange={() => setMode('manual')} />
                  <span>בחירה ידנית</span>
                </label>
              </div>

              {mode === 'model' && (
                loadingModels ? (
                  <p className="dt-propagate-loading">טוען דגמים...</p>
                ) : models.length === 0 ? (
                  <p className="dt-propagate-empty">לפרויקט האב אין עדיין דגמים מוגדרים.</p>
                ) : (
                  <select
                    className="dt-propagate-select"
                    value={selectedModelId}
                    onChange={e => setSelectedModelId(e.target.value)}
                  >
                    <option value="">בחר דגם...</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                )
              )}

              {mode === 'manual' && (
                loadingChildren ? (
                  <p className="dt-propagate-loading">טוען פרויקטי-בן...</p>
                ) : children.length === 0 ? (
                  <p className="dt-propagate-empty">אין עדיין פרויקטי-בן.</p>
                ) : (
                  <div className="dt-propagate-checklist">
                    {children.map(c => (
                      <label key={c.id} className="dt-propagate-check-row">
                        <input
                          type="checkbox"
                          checked={selectedChildIds.includes(c.id)}
                          onChange={() => toggleChild(c.id)}
                        />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                )
              )}

              {error && <p className="dt-propagate-error" role="alert">{error}</p>}
            </>
          ) : (
            <p className="dt-propagate-result">{resultSummary}</p>
          )}
        </div>

        <div className="dt-propagate-footer">
          {resultSummary ? (
            <button type="button" className="dt-propagate-save" onClick={onClose}>סגור</button>
          ) : (
            <>
              <button type="button" className="dt-propagate-cancel" onClick={onClose} disabled={applying}>ביטול</button>
              <button type="button" className="dt-propagate-save" onClick={handleApply} disabled={applying}>
                {applying ? 'מחיל...' : 'החל'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
