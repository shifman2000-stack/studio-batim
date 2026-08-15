// src/components/parentmodels/ParentModelsPanel.jsx
//
// Reusable "given a parent project id, render its models + presentations
// CRUD" panel — extracted from ParentProjectModelsReport.jsx's Step 2 so
// it can be reused verbatim from two places: the standalone report page
// (after its own Step 1 parent-project picker sets a project id) and the
// "דגמים" tab on ProjectDetail.jsx (which already knows its project id
// from the current page, so it renders this directly with no picker).
//
// Takes projectId + projectName as props; owns all of its own
// data-fetching/state/mutations for project_models and
// project_model_presentations. No admin gating here — that lives at
// each call site as appropriate (the report page gates the whole page;
// ProjectDetail's tab is visible to whoever can already see the project).

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import '../../pages/ReportTable.css'
import './ParentModelsPanel.css'

const BUCKET = 'project-model-images'
const PRESENTATIONS_BUCKET = 'project-model-presentations'

/* Inline feather-style icons — same convention as SharedFilesTab.jsx /
   DocumentsTab.jsx (hand-inlined SVGs, not lucide-react). */
const IconPencil = ({ size = 14 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
)

const IconTrash2 = ({ size = 14 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

const IconDownload = ({ size = 14 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const IconFile = ({ size = 22 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
)

/* ASCII-only extension, matching this codebase's storage-path
   convention (see SharedFilesTab.jsx) — the original (possibly
   Hebrew) filename is never put in the storage path itself. */
function fileExt(name) {
  if (!name) return 'file'
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return 'file'
  const ext = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext || 'file'
}

/* Same extraction as fileExt, but returns null (not a fake "file"
   extension) when there isn't a real one — presentations accept ANY
   file type, so an extension-less upload needs an extension-less
   storage path instead of a made-up ".file" suffix. */
function fileExtOrNull(name) {
  if (!name) return null
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return null
  const ext = name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '')
  return ext || null
}

function newUuid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/* Storage path from public URL — used to remove the file from the
   bucket on replace/remove/delete. */
function storagePath(url) {
  if (!url) return null
  const marker = `/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length))
}

function presentationStoragePath(url) {
  if (!url) return null
  const marker = `/object/public/${PRESENTATIONS_BUCKET}/`
  const idx = url.indexOf(marker)
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length))
}

/* DD/MM/YY — same format as SharedFilesTab.jsx's formatDate. */
function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year  = String(d.getFullYear()).slice(2)
  return `${day}/${month}/${year}`
}

export default function ParentModelsPanel({ projectId, projectName }) {
  /* ── Models for this parent ── */
  const [models, setModels]           = useState([])
  const [loadingModels, setLoadingModels] = useState(false)

  /* ── Presentations for this parent (parent-level, not per model) ── */
  const [presentations, setPresentations]             = useState([])
  const [loadingPresentations, setLoadingPresentations] = useState(false)
  const [uploadingPresentation, setUploadingPresentation] = useState(false)
  const [confirmDeletePresentationId, setConfirmDeletePresentationId] = useState(null)
  const [deletingPresentation, setDeletingPresentation] = useState(false)
  const presentationInputRef = useRef(null)

  /* ── Add / edit form (modal) ── */
  const [formOpen, setFormOpen]           = useState(false)
  const [editingId, setEditingId]         = useState(null) // null = creating
  const [formName, setFormName]           = useState('')
  const [formDesc, setFormDesc]           = useState('')
  const [formNotes, setFormNotes]         = useState('')
  const [formImageFile, setFormImageFile] = useState(null)   // pending new File
  const [formImagePreview, setFormImagePreview] = useState('') // object URL for the pending file
  const [formExistingImageUrl, setFormExistingImageUrl] = useState('') // current DB value when editing
  const [formRemoveImage, setFormRemoveImage] = useState(false)
  const [formError, setFormError]         = useState('')
  const [saving, setSaving]               = useState(false)
  const fileInputRef = useRef(null)

  /* ── Delete — inline confirm, no native dialog (matches SharedFilesTab). ── */
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadModels = async (id) => {
    setLoadingModels(true)
    const { data } = await supabase
      .from('project_models')
      .select('id, project_id, name, description, image_url, notes, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: true })
    setModels(data || [])
    setLoadingModels(false)
  }

  useEffect(() => {
    if (!projectId) { setModels([]); return }
    loadModels(projectId)
  }, [projectId])

  const loadPresentations = async (id) => {
    setLoadingPresentations(true)
    const { data } = await supabase
      .from('project_model_presentations')
      .select('id, project_id, file_url, file_name, uploaded_at')
      .eq('project_id', id)
      .order('uploaded_at', { ascending: false })
    setPresentations(data || [])
    setLoadingPresentations(false)
  }

  useEffect(() => {
    if (!projectId) { setPresentations([]); return }
    loadPresentations(projectId)
  }, [projectId])

  /* ── Add / edit form ─────────────────────────────────────────── */
  const openAddForm = () => {
    setEditingId(null)
    setFormName('')
    setFormDesc('')
    setFormNotes('')
    setFormImageFile(null)
    setFormImagePreview('')
    setFormExistingImageUrl('')
    setFormRemoveImage(false)
    setFormError('')
    setFormOpen(true)
  }

  const openEditForm = (model) => {
    setEditingId(model.id)
    setFormName(model.name || '')
    setFormDesc(model.description || '')
    setFormNotes(model.notes || '')
    setFormImageFile(null)
    setFormImagePreview('')
    setFormExistingImageUrl(model.image_url || '')
    setFormRemoveImage(false)
    setFormError('')
    setFormOpen(true)
  }

  const closeForm = () => {
    if (saving) return
    setFormOpen(false)
    setFormImageFile(null)
    setFormImagePreview('')
  }

  const handlePickImage = () => fileInputRef.current?.click()

  const handleImageSelected = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFormImageFile(file)
    setFormImagePreview(URL.createObjectURL(file))
    setFormRemoveImage(false)
  }

  const handleRemoveImage = () => {
    setFormImageFile(null)
    setFormImagePreview('')
    setFormRemoveImage(true)
  }

  const handleSave = async () => {
    const name = formName.trim()
    const description = formDesc.trim()
    if (!name) { setFormError('חובה להזין שם דגם.'); return }
    if (!description) { setFormError('חובה להזין תאור.'); return }

    setSaving(true)
    setFormError('')
    try {
      let imageUrl = formExistingImageUrl || null

      if (formImageFile) {
        const path = `${projectId}/${newUuid()}.${fileExt(formImageFile.name)}`
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, formImageFile)
        if (upErr) throw upErr
        const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)
        /* Old image (if any) is now orphaned — remove it only AFTER the
           new one is safely uploaded, so a failed upload never leaves
           the model with no image at all. */
        if (formExistingImageUrl) {
          const oldPath = storagePath(formExistingImageUrl)
          if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath])
        }
        imageUrl = publicUrl
      } else if (formRemoveImage && formExistingImageUrl) {
        const oldPath = storagePath(formExistingImageUrl)
        if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath])
        imageUrl = null
      }

      const payload = {
        name,
        description,
        image_url: imageUrl,
        notes: formNotes.trim() || null,
      }

      if (editingId) {
        const { error } = await supabase.from('project_models').update(payload).eq('id', editingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('project_models').insert({ ...payload, project_id: projectId })
        if (error) throw error
      }

      setFormOpen(false)
      setFormImageFile(null)
      setFormImagePreview('')
      await loadModels(projectId)
    } catch (e) {
      setFormError(e.message || 'שגיאה בשמירה')
    }
    setSaving(false)
  }

  /* ── Delete — storage image (if any) then the row, matching
     DocumentsTab's per-file delete: storage removal is fired first but
     doesn't block the DB delete (an orphaned/already-missing object
     shouldn't prevent cleaning up the row). ── */
  const handleDelete = async (model) => {
    setDeleting(true)
    try {
      if (model.image_url) {
        const path = storagePath(model.image_url)
        if (path) {
          const { error } = await supabase.storage.from(BUCKET).remove([path])
          if (error) console.warn('project-model-images remove warning:', error)
        }
      }
      const { error } = await supabase.from('project_models').delete().eq('id', model.id)
      if (error) throw error
      setConfirmDeleteId(null)
      await loadModels(projectId)
    } catch (e) {
      console.error('project_models delete error:', e)
      alert('שגיאה במחיקת הדגם. נסה שוב.')
    }
    setDeleting(false)
  }

  /* ── Presentations — parent-level, not per model. Upload fires
     immediately on file selection (no modal — just a name + date +
     link, unlike models there's nothing else to fill in). ── */
  const handlePickPresentation = () => presentationInputRef.current?.click()

  const handlePresentationFileSelected = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // allow re-selecting the same file later
    setUploadingPresentation(true)
    try {
      const ext = fileExtOrNull(file.name)
      const path = `${projectId}/${newUuid()}${ext ? `.${ext}` : ''}`
      const { error: upErr } = await supabase.storage.from(PRESENTATIONS_BUCKET).upload(path, file)
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from(PRESENTATIONS_BUCKET).getPublicUrl(path)

      const { error: insErr } = await supabase.from('project_model_presentations').insert({
        project_id: projectId,
        file_url: publicUrl,
        file_name: file.name,
      })
      if (insErr) throw insErr

      await loadPresentations(projectId)
    } catch (err) {
      console.error('project_model_presentations upload error:', err)
      alert('שגיאה בהעלאת המצגת. נסה שוב.')
    }
    setUploadingPresentation(false)
  }

  /* ── Delete — same pattern as handleDelete above: storage removal
     fired first but doesn't block the DB delete. ── */
  const handleDeletePresentation = async (presentation) => {
    setDeletingPresentation(true)
    try {
      const path = presentationStoragePath(presentation.file_url)
      if (path) {
        const { error } = await supabase.storage.from(PRESENTATIONS_BUCKET).remove([path])
        if (error) console.warn('project-model-presentations remove warning:', error)
      }
      const { error } = await supabase.from('project_model_presentations').delete().eq('id', presentation.id)
      if (error) throw error
      setConfirmDeletePresentationId(null)
      await loadPresentations(projectId)
    } catch (e) {
      console.error('project_model_presentations delete error:', e)
      alert('שגיאה במחיקת המצגת. נסה שוב.')
    }
    setDeletingPresentation(false)
  }

  /* ── Double-click a row: OPEN the file for viewing, not download it.
     A plain <a target="_blank"> to the raw Storage URL (what the
     existing download icon uses) can't be reused for this — Supabase
     Storage serves these public objects with a forced attachment
     disposition, so a direct navigation always triggers a save dialog
     regardless of file type. Fetching the file as a blob and pointing
     the tab at that blob: URL sidesteps this entirely: there's no
     server-controlled disposition on a blob, so the browser renders it
     purely by MIME type (PDF/image/text preview inline; a type the
     browser truly can't render still falls back to its own save
     prompt, same as any other file). The blank tab is opened
     SYNCHRONOUSLY, before the fetch, so the popup blocker still sees
     it as part of the original click gesture. */
  const handleOpenPresentation = async (presentation) => {
    const newTab = window.open('', '_blank')
    try {
      const res = await fetch(presentation.file_url)
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      if (newTab) newTab.location.href = blobUrl
    } catch (err) {
      console.error('presentation open error:', err)
      if (newTab) newTab.location.href = presentation.file_url
    }
  }

  return (
    <>
      {/* ── Presentations — parent-project level, above the models list ── */}
      <div className="ppm-panel" style={{ marginBottom: 20 }}>
        <div className="ppm-panel-header">
          <div className="ppm-panel-title-group">
            <h2 className="ppm-panel-title">מצגות עבור {projectName || '...'}</h2>
            {!loadingPresentations && (
              <span className="ppm-count-badge" title="מספר מצגות">{presentations.length}</span>
            )}
          </div>
          <input
            ref={presentationInputRef}
            type="file"
            onChange={handlePresentationFileSelected}
            style={{ display: 'none' }}
          />
          <button type="button" className="ppm-add-btn" onClick={handlePickPresentation} disabled={uploadingPresentation}>
            {uploadingPresentation ? 'מעלה...' : '+ הוסף מצגת'}
          </button>
        </div>

        {loadingPresentations && <p className="report-loading">טוען...</p>}

        {!loadingPresentations && presentations.length === 0 && (
          <p className="report-empty">אין עדיין מצגות לפרויקט זה.</p>
        )}

        {!loadingPresentations && presentations.length > 0 && (
          <div className="ppm-list">
            {presentations.map(presentation => (
              <div
                key={presentation.id}
                className="ppm-row"
                onDoubleClick={() => handleOpenPresentation(presentation)}
                style={{ cursor: 'pointer' }}
                title="לחיצה כפולה לפתיחה"
              >
                <div className="ppm-thumb-placeholder">
                  <IconFile />
                </div>
                <div className="ppm-row-body">
                  <div className="ppm-row-name">{presentation.file_name}</div>
                  <div className="ppm-row-desc">{formatDate(presentation.uploaded_at)}</div>
                </div>
                {confirmDeletePresentationId === presentation.id ? (
                  <div className="ppm-delete-confirm">
                    <span className="ppm-delete-confirm-text">למחוק?</span>
                    <button type="button" className="ppm-delete-confirm-yes" onClick={() => handleDeletePresentation(presentation)} disabled={deletingPresentation}>כן</button>
                    <button type="button" className="ppm-delete-confirm-no" onClick={() => setConfirmDeletePresentationId(null)} disabled={deletingPresentation}>לא</button>
                  </div>
                ) : (
                  <div className="ppm-row-actions">
                    <a href={presentation.file_url} target="_blank" rel="noopener noreferrer" className="ppm-icon-btn" title="פתיחה/הורדה">
                      <IconDownload />
                    </a>
                    <button type="button" className="ppm-icon-btn ppm-icon-btn--danger" title="מחיקה" onClick={() => setConfirmDeletePresentationId(presentation.id)}>
                      <IconTrash2 />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Models ── */}
      <div className="ppm-panel">
        <div className="ppm-panel-header">
          <div className="ppm-panel-title-group">
            <h2 className="ppm-panel-title">דגמים עבור {projectName || '...'}</h2>
            {!loadingModels && (
              <span className="ppm-count-badge" title="מספר דגמים">{models.length}</span>
            )}
          </div>
          <button type="button" className="ppm-add-btn" onClick={openAddForm}>
            + דגם חדש
          </button>
        </div>

        {loadingModels && <p className="report-loading">טוען...</p>}

        {!loadingModels && models.length === 0 && (
          <p className="report-empty">אין עדיין דגמים לפרויקט זה.</p>
        )}

        {!loadingModels && models.length > 0 && (
          <div className="ppm-list">
            {models.map(model => (
              <div key={model.id} className="ppm-row">
                {model.image_url ? (
                  <img src={model.image_url} alt={model.name} className="ppm-thumb" />
                ) : (
                  <div className="ppm-thumb-placeholder">—</div>
                )}
                <div className="ppm-row-body">
                  <div className="ppm-row-name">{model.name}</div>
                  {model.description && (
                    <div className="ppm-row-desc">{model.description}</div>
                  )}
                </div>
                {confirmDeleteId === model.id ? (
                  <div className="ppm-delete-confirm">
                    <span className="ppm-delete-confirm-text">למחוק?</span>
                    <button type="button" className="ppm-delete-confirm-yes" onClick={() => handleDelete(model)} disabled={deleting}>כן</button>
                    <button type="button" className="ppm-delete-confirm-no" onClick={() => setConfirmDeleteId(null)} disabled={deleting}>לא</button>
                  </div>
                ) : (
                  <div className="ppm-row-actions">
                    <button type="button" className="ppm-icon-btn" title="עריכה" onClick={() => openEditForm(model)}>
                      <IconPencil />
                    </button>
                    <button type="button" className="ppm-icon-btn ppm-icon-btn--danger" title="מחיקה" onClick={() => setConfirmDeleteId(model.id)}>
                      <IconTrash2 />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {formOpen && (
        <div className="ppm-modal-overlay" onClick={closeForm}>
          <div className="ppm-modal" onClick={e => e.stopPropagation()} dir="rtl">

            <div className="ppm-modal-header">
              <span className="ppm-modal-title">{editingId ? 'עריכת דגם' : 'דגם חדש'}</span>
              <button type="button" className="ppm-modal-close" onClick={closeForm}>×</button>
            </div>

            <div className="ppm-modal-body">
              <div className="ppm-form-row">
                <label className="ppm-form-label">שם הדגם</label>
                <input
                  type="text"
                  className="ppm-form-input"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  dir="rtl"
                  autoFocus
                />
              </div>

              <div className="ppm-form-row">
                <label className="ppm-form-label">תאור</label>
                <textarea
                  className="ppm-form-input"
                  value={formDesc}
                  onChange={e => setFormDesc(e.target.value)}
                  dir="rtl"
                  rows={3}
                />
              </div>

              <div className="ppm-form-row">
                <label className="ppm-form-label">תמונה</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelected}
                  style={{ display: 'none' }}
                />
                {(formImagePreview || (formExistingImageUrl && !formRemoveImage)) ? (
                  <div className="ppm-image-row">
                    <img src={formImagePreview || formExistingImageUrl} alt="" className="ppm-image-preview" />
                    <button type="button" className="ppm-image-btn" onClick={handlePickImage}>החלף תמונה</button>
                    <button type="button" className="ppm-image-remove-btn" onClick={handleRemoveImage}>הסר</button>
                  </div>
                ) : (
                  <div>
                    <button type="button" className="ppm-image-btn" onClick={handlePickImage}>+ בחר תמונה</button>
                  </div>
                )}
              </div>

              <div className="ppm-form-row">
                <label className="ppm-form-label">הערות</label>
                <textarea
                  className="ppm-form-input"
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  dir="rtl"
                  rows={2}
                />
              </div>

              {formError && (
                <p className="ppm-form-error">{formError}</p>
              )}
            </div>

            <div className="ppm-modal-footer">
              <button type="button" className="ppm-modal-cancel" onClick={closeForm} disabled={saving}>ביטול</button>
              <button type="button" className="ppm-modal-save" onClick={handleSave} disabled={saving}>
                {saving ? 'שומר...' : 'שמור'}
              </button>
            </div>

          </div>
        </div>
      )}
    </>
  )
}
