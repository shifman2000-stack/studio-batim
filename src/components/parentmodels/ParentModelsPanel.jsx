// src/components/parentmodels/ParentModelsPanel.jsx
//
// "given a parent project id, render its models + presentations" panel.
// Used from two places: the standalone report page
// (ParentProjectModelsReport, after its own parent picker) and the
// "דגמים" tab on ProjectDetail (which already knows its project id).
//
// Layout mirrors מעקב מסמכים (DocumentsTab): a table on the right and a
// fixed preview pane on the left. The pane, the file-cell icons and the
// file helpers are IMPORTED from components/documents/filePreview —
// the same module DocumentsTab itself uses — so the two screens can't
// drift apart. Row/table chrome reuses DocumentsTab.css's .dt-* classes
// directly; only the column widths are local (.ppm-col-*), since the
// columns differ.
//
// project_models shape (Dev, post-restructure):
//   id, project_id, name, size, plan_file_url, plan_file_name,
//   render_file_url, render_file_name, created_at
// `description` / `notes` / `image_url` were dropped — no references
// remain here.
//
// Presentations are parent-level (not per model) and live in their own
// table + bucket. They're rendered as a slim collapsible strip above
// the table so they don't dominate the tab.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import FilePreviewPane, {
  IconEye, IconDownload,
  getFileExtension, storagePathIn, isExternalUrlFor, downloadBlob,
} from '../documents/filePreview'
import '../../DocumentsTab.css'
import './ParentModelsPanel.css'

/* Same buckets the feature already used — models' files go in the
   models bucket, presentations in theirs. No new bucket. */
const BUCKET               = 'project-model-images'
const PRESENTATIONS_BUCKET = 'project-model-presentations'

const storagePath             = (url) => storagePathIn(BUCKET, url)
const presentationStoragePath = (url) => storagePathIn(PRESENTATIONS_BUCKET, url)

/* The two single-file columns. Each maps to its own pair of columns on
   project_models, so one definition drives the header, the cells and
   every handler. */
const FILE_FIELDS = [
  { key: 'plan',   label: 'תוכנית', urlCol: 'plan_file_url',   nameCol: 'plan_file_name'   },
  { key: 'render', label: 'הדמיה',  urlCol: 'render_file_url', nameCol: 'render_file_name' },
]

/* ── Local icons (the eye/download ones come from filePreview) ── */
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

const IconChevron = ({ open }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

/* ASCII-only extension for storage paths — the original (possibly
   Hebrew) filename never goes into the path itself. */
function asciiExt(name) {
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

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year  = String(d.getFullYear()).slice(2)
  return `${day}/${month}/${year}`
}

/* ── One single-file cell (תוכנית / הדמיה) ───────────────────────────
   Same markup + classes as DocumentsTab's "קובץ" column, with one
   deliberate difference: a model holds exactly ONE file per column, so
   attaching while a file exists REPLACES it (label switches to
   "החלף"). The replace follows the pattern this feature already used
   for the old model image — upload the new object FIRST, then remove
   the old one, so a failed upload never leaves the row file-less. ── */
function ModelFileCell({ model, field, onAttach, onRemove, onPreview }) {
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)

  const url  = model[field.urlCol]
  const name = model[field.nameCol]
    || (url ? decodeURIComponent(url.split('/').pop()) : '')

  const handleChange = async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    await onAttach(model, field, file)
    setBusy(false)
  }

  return (
    <div className="ppm-col-file">
      <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={handleChange} />
      <div className="dt-file-list" style={{ display: 'flex', flexDirection: 'column', gap: 4, direction: 'rtl' }}>
        {url && (
          <div className="dt-file-existing" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span className="dt-file-name" title={name}>
              {getFileExtension({ file_name: model[field.nameCol], file_url: url })}
            </span>
            <button type="button" className="dt-file-icon-btn"
              onClick={() => onPreview({ url, name, bucket: BUCKET })} title="תצוגה מקדימה">
              <IconEye />
            </button>
            <button type="button" className="dt-file-icon-btn"
              onClick={() => isExternalUrlFor(BUCKET, url)
                ? window.open(url, '_blank', 'noopener,noreferrer')
                : downloadBlob(url, name)
              } title="הורד">
              <IconDownload />
            </button>
            <button type="button" className="dt-file-icon-btn dt-file-delete-btn"
              onClick={() => onRemove(model, field)} title="הסר קובץ">
              ×
            </button>
          </div>
        )}
        {busy ? (
          <span className="dt-file-uploading">מעלה...</span>
        ) : (
          <button
            type="button"
            className="dt-file-pick-btn"
            onClick={() => fileRef.current?.click()}
            style={url ? { alignSelf: 'flex-start' } : undefined}
            title={url ? 'החלפת הקובץ הקיים' : 'צירוף קובץ'}
          >
            {url ? '+ החלף' : '+ צרף'}
          </button>
        )}
      </div>
    </div>
  )
}

/* ── One model row ── */
function ModelRow({ model, index, onPatch, onAttach, onRemoveFile, onDelete, onPreview }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={'dt-doc-row' + (index % 2 === 1 ? ' dt-doc-row--even' : '')}>
      {/* שם */}
      <div className="ppm-col-name">
        <input
          type="text"
          defaultValue={model.name || ''}
          onBlur={e => {
            const v = e.target.value.trim()
            /* name is NOT NULL — refuse to blank it, snap back instead. */
            if (!v) { e.target.value = model.name || ''; return }
            if (v !== (model.name || '')) onPatch(model.id, 'name', v)
          }}
          className="dt-notes-input"
          placeholder="שם הדגם"
          dir="rtl"
        />
      </div>

      {/* גודל */}
      <div className="ppm-col-size">
        <input
          type="text"
          defaultValue={model.size || ''}
          onBlur={e => {
            const v = e.target.value.trim() || null
            if (v !== (model.size || null)) onPatch(model.id, 'size', v)
          }}
          className="dt-notes-input"
          placeholder="גודל"
          dir="rtl"
        />
      </div>

      {/* תוכנית / הדמיה */}
      {FILE_FIELDS.map(field => (
        <ModelFileCell
          key={field.key}
          model={model}
          field={field}
          onAttach={onAttach}
          onRemove={onRemoveFile}
          onPreview={onPreview}
        />
      ))}

      {/* מחיקה */}
      <div className="dt-col-delete">
        {confirming ? (
          <div className="dt-delete-confirm">
            <span className="dt-delete-confirm-text">למחוק?</span>
            <button type="button" className="dt-delete-confirm-yes" onClick={() => onDelete(model)}>כן</button>
            <button type="button" className="dt-delete-confirm-no"  onClick={() => setConfirming(false)}>לא</button>
          </div>
        ) : (
          <button type="button" className="dt-row-delete-btn" onClick={() => setConfirming(true)} title="מחק דגם זה">
            <IconTrash2 />
          </button>
        )}
      </div>
    </div>
  )
}

/* ── Inline "add model" row — mirrors DocumentsTab's AddDocRow ── */
function AddModelRow({ onAdd }) {
  const [adding, setAdding] = useState(false)
  const [name,   setName]   = useState('')
  const inputRef            = useRef(null)

  const confirm = async () => {
    const v = name.trim()
    if (!v) return
    await onAdd(v)
    setName('')
    setAdding(false)
  }

  if (!adding) {
    return (
      <div className="ppm-add-row">
        <button type="button" className="dt-file-pick-btn" onClick={() => {
          setAdding(true)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}>
          + דגם חדש
        </button>
      </div>
    )
  }

  return (
    <div className="ppm-add-row">
      <input
        ref={inputRef}
        type="text"
        className="dt-notes-input"
        style={{ maxWidth: 220 }}
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') confirm()
          if (e.key === 'Escape') { setAdding(false); setName('') }
        }}
        placeholder="שם הדגם"
        dir="rtl"
      />
      <button type="button" className="dt-delete-confirm-yes" onClick={confirm} disabled={!name.trim()}>הוסף</button>
      <button type="button" className="dt-delete-confirm-no"  onClick={() => { setAdding(false); setName('') }}>ביטול</button>
    </div>
  )
}

export default function ParentModelsPanel({ projectId, projectName }) {
  const [models, setModels]               = useState([])
  const [loadingModels, setLoadingModels] = useState(false)

  const [presentations, setPresentations]                 = useState([])
  const [loadingPresentations, setLoadingPresentations]   = useState(false)
  const [uploadingPresentation, setUploadingPresentation] = useState(false)
  const [confirmDeletePresentationId, setConfirmDeletePresentationId] = useState(null)
  /* Collapsed by default — the whole point of the strip is to keep the
     presentations out of the way until they're wanted. */
  const [presentationsOpen, setPresentationsOpen] = useState(false)
  const presentationInputRef = useRef(null)

  /* { url, name, bucket } — bucket travels with the file so the shared
     pane can download Word docs from whichever bucket it came from. */
  const [previewFile, setPreviewFile] = useState(null)

  /* ── Loads ── */
  const loadModels = async (id) => {
    setLoadingModels(true)
    const { data } = await supabase
      .from('project_models')
      .select('id, project_id, name, size, plan_file_url, plan_file_name, render_file_url, render_file_name, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: true })
    setModels(data || [])
    setLoadingModels(false)
  }

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
    if (!projectId) { setModels([]); setPresentations([]); return }
    loadModels(projectId)
    loadPresentations(projectId)
  }, [projectId])

  /* ── Model mutations ── */
  const patchModel = async (id, field, value) => {
    setModels(prev => prev.map(m => (m.id === id ? { ...m, [field]: value } : m)))
    const { error } = await supabase.from('project_models').update({ [field]: value }).eq('id', id)
    if (error) {
      console.error('project_models patch error:', error)
      await loadModels(projectId)   /* snap back to the DB truth */
    }
  }

  const addModel = async (name) => {
    const { error } = await supabase.from('project_models').insert({ project_id: projectId, name })
    if (error) { console.error('project_models insert error:', error); return }
    await loadModels(projectId)
  }

  /* Attach (or replace) one of the two single-file columns. */
  const attachModelFile = async (model, field, file) => {
    try {
      const ext  = asciiExt(file.name)
      const path = `${projectId}/${model.id}/${field.key}-${newUuid()}${ext ? `.${ext}` : ''}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file)
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

      const { error: updErr } = await supabase
        .from('project_models')
        .update({ [field.urlCol]: publicUrl, [field.nameCol]: file.name })
        .eq('id', model.id)
      if (updErr) throw updErr

      /* Only now is the previous object safe to drop. */
      const oldUrl = model[field.urlCol]
      if (oldUrl) {
        const oldPath = storagePath(oldUrl)
        if (oldPath) {
          const { error } = await supabase.storage.from(BUCKET).remove([oldPath])
          if (error) console.warn('project-model-images remove warning:', error)
        }
      }

      setModels(prev => prev.map(m => (
        m.id === model.id
          ? { ...m, [field.urlCol]: publicUrl, [field.nameCol]: file.name }
          : m
      )))
    } catch (e) {
      console.error('model file attach error:', e)
      alert('שגיאה בהעלאת הקובץ. נסה שוב.')
    }
  }

  const removeModelFile = async (model, field) => {
    const url = model[field.urlCol]
    try {
      if (url) {
        const path = storagePath(url)
        if (path) {
          const { error } = await supabase.storage.from(BUCKET).remove([path])
          if (error) console.warn('project-model-images remove warning:', error)
        }
      }
      const { error } = await supabase
        .from('project_models')
        .update({ [field.urlCol]: null, [field.nameCol]: null })
        .eq('id', model.id)
      if (error) throw error

      /* Drop the preview if it was showing the file we just removed. */
      setPreviewFile(prev => (prev && prev.url === url ? null : prev))
      setModels(prev => prev.map(m => (
        m.id === model.id ? { ...m, [field.urlCol]: null, [field.nameCol]: null } : m
      )))
    } catch (e) {
      console.error('model file remove error:', e)
      alert('שגיאה בהסרת הקובץ. נסה שוב.')
    }
  }

  const deleteModel = async (model) => {
    try {
      /* Both attached files go with the row. */
      const paths = FILE_FIELDS
        .map(f => storagePath(model[f.urlCol]))
        .filter(Boolean)
      if (paths.length > 0) {
        const { error } = await supabase.storage.from(BUCKET).remove(paths)
        if (error) console.warn('project-model-images remove warning:', error)
      }
      const { error } = await supabase.from('project_models').delete().eq('id', model.id)
      if (error) throw error

      const removedUrls = FILE_FIELDS.map(f => model[f.urlCol]).filter(Boolean)
      setPreviewFile(prev => (prev && removedUrls.includes(prev.url) ? null : prev))
      setModels(prev => prev.filter(m => m.id !== model.id))
    } catch (e) {
      console.error('project_models delete error:', e)
      alert('שגיאה במחיקת הדגם. נסה שוב.')
    }
  }

  /* ── Presentations ── */
  const handlePresentationFileSelected = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploadingPresentation(true)
    try {
      const ext  = asciiExt(file.name)
      const path = `${projectId}/${newUuid()}${ext ? `.${ext}` : ''}`
      const { error: upErr } = await supabase.storage.from(PRESENTATIONS_BUCKET).upload(path, file)
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage.from(PRESENTATIONS_BUCKET).getPublicUrl(path)

      const { error: insErr } = await supabase.from('project_model_presentations').insert({
        project_id: projectId,
        file_url:   publicUrl,
        file_name:  file.name,
      })
      if (insErr) throw insErr

      setPresentationsOpen(true)   /* reveal what was just added */
      await loadPresentations(projectId)
    } catch (err) {
      console.error('project_model_presentations upload error:', err)
      alert('שגיאה בהעלאת המצגת. נסה שוב.')
    }
    setUploadingPresentation(false)
  }

  const handleDeletePresentation = async (presentation) => {
    try {
      const path = presentationStoragePath(presentation.file_url)
      if (path) {
        const { error } = await supabase.storage.from(PRESENTATIONS_BUCKET).remove([path])
        if (error) console.warn('project-model-presentations remove warning:', error)
      }
      const { error } = await supabase.from('project_model_presentations').delete().eq('id', presentation.id)
      if (error) throw error
      setConfirmDeletePresentationId(null)
      setPreviewFile(prev => (prev && prev.url === presentation.file_url ? null : prev))
      await loadPresentations(projectId)
    } catch (e) {
      console.error('project_model_presentations delete error:', e)
      alert('שגיאה במחיקת המצגת. נסה שוב.')
    }
  }

  return (
    <div className="dt-root" dir="rtl">

      {/* ── Right panel: presentations strip + models table ── */}
      <div className="dt-panel-right">

        {/* ── Presentations — slim collapsible strip ── */}
        <div className="ppm-pres">
          <div className="ppm-pres-bar">
            <button
              type="button"
              className="ppm-pres-toggle"
              onClick={() => setPresentationsOpen(o => !o)}
              aria-expanded={presentationsOpen}
            >
              <IconChevron open={presentationsOpen} />
              <span className="ppm-pres-title">מצגות עבור {projectName || '...'}</span>
              <span className="ppm-pres-count">{loadingPresentations ? '…' : presentations.length}</span>
            </button>
            <input
              ref={presentationInputRef}
              type="file"
              onChange={handlePresentationFileSelected}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              className="dt-file-pick-btn"
              onClick={() => presentationInputRef.current?.click()}
              disabled={uploadingPresentation}
            >
              {uploadingPresentation ? 'מעלה...' : '+ הוסף מצגת'}
            </button>
          </div>

          {presentationsOpen && (
            <div className="ppm-pres-body">
              {loadingPresentations && <span className="ppm-pres-empty">טוען...</span>}
              {!loadingPresentations && presentations.length === 0 && (
                <span className="ppm-pres-empty">אין עדיין מצגות לפרויקט זה.</span>
              )}
              {!loadingPresentations && presentations.map(p => (
                <div key={p.id} className="ppm-pres-row">
                  <span className="ppm-pres-name" title={p.file_name}>{p.file_name}</span>
                  <span className="ppm-pres-date">{formatDate(p.uploaded_at)}</span>
                  {confirmDeletePresentationId === p.id ? (
                    <div className="dt-delete-confirm">
                      <span className="dt-delete-confirm-text">למחוק?</span>
                      <button type="button" className="dt-delete-confirm-yes" onClick={() => handleDeletePresentation(p)}>כן</button>
                      <button type="button" className="dt-delete-confirm-no"  onClick={() => setConfirmDeletePresentationId(null)}>לא</button>
                    </div>
                  ) : (
                    <div className="ppm-pres-actions">
                      <button type="button" className="dt-file-icon-btn" title="תצוגה מקדימה"
                        onClick={() => setPreviewFile({ url: p.file_url, name: p.file_name, bucket: PRESENTATIONS_BUCKET })}>
                        <IconEye />
                      </button>
                      <button type="button" className="dt-file-icon-btn" title="הורד"
                        onClick={() => isExternalUrlFor(PRESENTATIONS_BUCKET, p.file_url)
                          ? window.open(p.file_url, '_blank', 'noopener,noreferrer')
                          : downloadBlob(p.file_url, p.file_name)
                        }>
                        <IconDownload />
                      </button>
                      <button type="button" className="dt-file-icon-btn dt-file-delete-btn" title="מחק מצגת"
                        onClick={() => setConfirmDeletePresentationId(p.id)}>
                        ×
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Models table ── */}
        <div className="ppm-table">
          <div className="dt-table-header">
            <div className="ppm-col-name">שם</div>
            <div className="ppm-col-size">גודל</div>
            {FILE_FIELDS.map(f => (
              <div key={f.key} className="ppm-col-file">{f.label}</div>
            ))}
            <div className="dt-col-delete" />
          </div>

          {loadingModels && <p className="ppm-pres-empty" style={{ padding: '10px' }}>טוען...</p>}

          {!loadingModels && models.length === 0 && (
            <p className="ppm-pres-empty" style={{ padding: '10px' }}>אין עדיין דגמים לפרויקט זה.</p>
          )}

          {!loadingModels && models.map((model, i) => (
            <ModelRow
              key={model.id}
              model={model}
              index={i}
              onPatch={patchModel}
              onAttach={attachModelFile}
              onRemoveFile={removeModelFile}
              onDelete={deleteModel}
              onPreview={setPreviewFile}
            />
          ))}

          <AddModelRow onAdd={addModel} />
        </div>

      </div>

      {/* ── Left panel: preview — the SAME pane DocumentsTab renders ── */}
      <div className="dt-panel-left">
        <FilePreviewPane file={previewFile} bucket={previewFile?.bucket || BUCKET} />
      </div>

    </div>
  )
}
