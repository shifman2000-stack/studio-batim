import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import * as mammoth from 'mammoth'
import '../../DocumentsTab.css'

const ACCENT   = '#7bc1b5'
const ACCENT_DARK = '#4a9a8c'
const BUCKET   = 'project-files'

const STAGE_ORDER = [
  'קליטה ותיק מידע',
  'הגא פטור',
  'הגא ממד חדש',
  'הקלה',
  'פתיחת בקשה',
  'הכנת מסמכים למנהל',
  'בקרת תכן',
  'סיום בקשה',
  'תחילת עבודה - טופס 2',
  'תעודת גמר - טופס 4',
]

const STATUS_OPTIONS = ['חסר', 'התקבל']

/* ── Utilities ── */
function storagePath(url) {
  const marker = `/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length))
}

function fileExt(url) {
  if (!url) return ''
  const name = url.split('/').pop()
  const dot  = name.lastIndexOf('.')
  return dot !== -1 ? name.slice(dot + 1).toLowerCase() : name
}

async function downloadBlob(url, fileName) {
  const res  = await fetch(url)
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = href; a.download = fileName; a.click()
  URL.revokeObjectURL(href)
}

/* ── Utilities ── */
function previewType(url) {
  if (!url) return null
  const ext = fileExt(url.split('?')[0])
  if (['jpg','jpeg','png','gif','webp','bmp','svg','tiff','tif'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['doc','docx'].includes(ext)) return 'word'
  return 'unsupported'
}

/* ── Inline SVGs ── */
const IconEye = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

const IconDownload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)

/* XCircle — חסר */
const IconXCircle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
)

/* ChevronDown — collapsed accordion */
const IconChevronDown = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

/* ChevronUp — expanded accordion */
const IconChevronUp = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
)

/* Trash2 — delete doc */
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

/* CheckCircle — התקבל */
const IconCheckCircle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
)

const STATUS_META = {
  'חסר':   { icon: <IconXCircle />,     color: '#E24B4A', next: 'התקבל' },
  'התקבל': { icon: <IconCheckCircle />, color: '#1D9E75', next: 'חסר'   },
}

function StatusIcon({ status }) {
  const current = STATUS_META[status] ? status : 'חסר'
  const meta    = STATUS_META[current]
  return (
    <span className="dt-status-icon" style={{ color: meta.color }}>
      {meta.icon}
    </span>
  )
}

/* ── Single document row ── */
function DocRow({ doc, index, onPatch, onUpload, onFileDelete, onDocDelete, onPreview }) {
  const fileRef                       = useRef(null)
  const [uploading, setUploading]     = useState(false)
  const [confirming, setConfirming]   = useState(false)
  const ext      = fileExt(doc.file_url)
  const fullName = doc.file_url ? decodeURIComponent(doc.file_url.split('/').pop()) : ''

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    await onUpload(doc, file)
    setUploading(false)
    e.target.value = ''
  }

  return (
    <div className={'dt-doc-row' + (index % 2 === 1 ? ' dt-doc-row--even' : '')}>

      {/* שם המסמך */}
      <div className="dt-col-name">
        <span className="dt-doc-name">{doc.name || '—'}</span>
      </div>

      {/* סטטוס */}
      <div className="dt-col-status">
        <StatusIcon status={doc.status} />
      </div>

      {/* תאריך */}
      <div className="dt-col-date">
        <input
          type="date"
          value={doc.date || ''}
          onChange={e => onPatch(doc.id, 'date', e.target.value || null)}
          className="dt-date-input"
        />
      </div>

      {/* קובץ */}
      <div className="dt-col-file">
        {uploading ? (
          <span className="dt-file-uploading">מעלה...</span>
        ) : doc.file_url ? (
          <div className="dt-file-existing">
            <span className="dt-file-name" title={fullName}>{ext}</span>
            <button type="button" className="dt-file-icon-btn"
              onClick={() => onPreview({ url: doc.file_url, name: fullName })} title="תצוגה מקדימה">
              <IconEye />
            </button>
            <button type="button" className="dt-file-icon-btn"
              onClick={() => downloadBlob(doc.file_url, fullName)} title="הורד">
              <IconDownload />
            </button>
            <button type="button" className="dt-file-icon-btn dt-file-delete-btn"
              onClick={() => onFileDelete(doc)} title="מחק קובץ">
              ×
            </button>
          </div>
        ) : (
          <>
            <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={handleFileChange} />
            <button type="button" className="dt-file-pick-btn" onClick={() => fileRef.current?.click()}>
              + צרף
            </button>
          </>
        )}
      </div>

      {/* הערות */}
      <div className="dt-col-notes">
        <input
          type="text"
          defaultValue={doc.notes || ''}
          onBlur={e => { if (e.target.value !== (doc.notes || '')) onPatch(doc.id, 'notes', e.target.value) }}
          className="dt-notes-input"
          placeholder="הערה..."
          dir="rtl"
        />
      </div>

      {/* מחק — כל השורות */}
      <div className="dt-col-delete">
        {confirming ? (
          <div className="dt-delete-confirm">
            <span className="dt-delete-confirm-text">למחוק?</span>
            <button type="button" className="dt-delete-confirm-yes" onClick={() => onDocDelete(doc.id)}>כן</button>
            <button type="button" className="dt-delete-confirm-no"  onClick={() => setConfirming(false)}>לא</button>
          </div>
        ) : (
          <button type="button" className="dt-row-delete-btn" onClick={() => setConfirming(true)} title="מחק מסמך זה מהפרויקט">
            <IconTrash2 />
          </button>
        )}
      </div>

    </div>
  )
}

/* ── Add custom doc inline form ── */
function AddDocRow({ stage, onAdd }) {
  const [adding, setAdding]   = useState(false)
  const [name,   setName]     = useState('')
  const inputRef              = useRef(null)

  const confirm = async () => {
    if (!name.trim()) return
    await onAdd(stage, name.trim())
    setName(''); setAdding(false)
  }

  if (!adding) {
    return (
      <button type="button" className="dt-add-row-link" onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 0) }}>
        + הוסף מסמך
      </button>
    )
  }

  return (
    <div className="dt-add-row-inline">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { setAdding(false); setName('') } }}
        className="dt-add-row-input"
        placeholder="שם המסמך..."
        dir="rtl"
      />
      <button type="button" className="dt-add-row-confirm" onClick={confirm}>אישור</button>
      <button type="button" className="dt-add-row-cancel" onClick={() => { setAdding(false); setName('') }}>ביטול</button>
    </div>
  )
}

/* ── Main component ── */
export default function DocumentsTab({ projectId }) {
  const [docs,        setDocs]        = useState([])
  const [loading,     setLoading]     = useState(true)
  const [openStages,  setOpenStages]  = useState({})
  const [previewFile,    setPreviewFile]    = useState(null) // { url, name }
  const [wordHtml,       setWordHtml]       = useState('')
  const [wordLoading,    setWordLoading]    = useState(false)
  const [wordError,      setWordError]      = useState(false)

  useEffect(() => {
    if (!previewFile || previewType(previewFile.url) !== 'word') return
    setWordHtml('')
    setWordError(false)
    setWordLoading(true)
    ;(async () => {
      try {
        const filePath = storagePath(previewFile.url)
        if (!filePath) throw new Error('bad path')
        const { data, error } = await supabase.storage.from(BUCKET).download(filePath)
        if (error || !data) throw error
        const arrayBuffer = await data.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer })
        setWordHtml(result.value)
      } catch {
        setWordError(true)
      } finally {
        setWordLoading(false)
      }
    })()
  }, [previewFile])

  useEffect(() => { loadDocs() }, [projectId])

  const loadDocs = async () => {
    setLoading(true)

    let { data } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order')

    if (data && data.length === 0) {
      const { data: templates } = await supabase
        .from('document_templates')
        .select('*')
        .order('sort_order')

      if (templates && templates.length > 0) {
        const toInsert = templates.map(t => ({
          project_id:  projectId,
          template_id: t.id,
          stage:       t.stage,
          name:        t.name,
          required:    true,
          status:      'חסר',
          sort_order:  t.sort_order ?? 0,
        }))
        const { data: inserted } = await supabase
          .from('project_documents')
          .insert(toInsert)
          .select('*')
          .order('sort_order')
        if (inserted) data = inserted
      }
    }

    setDocs(data || [])
    const state = {}
    STAGE_ORDER.forEach(s => { state[s] = false })
    setOpenStages(state)
    setLoading(false)
  }

  /* ── Patch a field (optimistic) ── */
  const patchDoc = async (docId, field, value) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, [field]: value } : d))
    await supabase.from('project_documents').update({ [field]: value }).eq('id', docId)
  }

  /* ── File upload ── */
  const uploadFile = async (doc, file) => {
    const fileExt = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
    const path    = `${projectId}/${doc.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file)
    if (error) { console.error('Upload error:', error); return }
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const today = new Date().toISOString().slice(0, 10)
    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, file_url: publicUrl, status: 'התקבל', date: today } : d))
    await supabase.from('project_documents').update({ file_url: publicUrl, status: 'התקבל', date: today }).eq('id', doc.id)
  }

  /* ── File delete ── */
  const deleteFile = async (doc) => {
    if (doc.file_url) {
      const path = storagePath(doc.file_url)
      if (path) await supabase.storage.from(BUCKET).remove([path])
    }
    setDocs(prev => prev.map(d => d.id === doc.id ? { ...d, file_url: null, status: 'חסר', date: null } : d))
    await supabase.from('project_documents').update({ file_url: null, status: 'חסר', date: null }).eq('id', doc.id)
  }

  /* ── Add custom doc ── */
  const addCustomDoc = async (stage, name) => {
    const stageDocs = docs.filter(d => d.stage === stage)
    const maxOrder  = stageDocs.reduce((m, d) => Math.max(m, d.sort_order ?? 0), 0)
    const { data } = await supabase
      .from('project_documents')
      .insert([{
        project_id:  projectId,
        template_id: null,
        stage,
        name,
        required:    true,
        status:      'חסר',
        sort_order:  maxOrder + 1,
      }])
      .select()
      .single()
    if (data) setDocs(prev => [...prev, data])
  }

  /* ── Delete custom doc ── */
  const deleteDoc = async (docId) => {
    const doc = docs.find(d => d.id === docId)
    if (doc?.file_url) {
      const path = storagePath(doc.file_url)
      if (path) await supabase.storage.from(BUCKET).remove([path])
    }
    await supabase.from('project_documents').delete().eq('id', docId)
    setDocs(prev => prev.filter(d => d.id !== docId))
  }

  /* ── Progress ── */
  const receivedDocs = docs.filter(d => d.status === 'התקבל')
  const pct = docs.length > 0
    ? Math.round((receivedDocs.length / docs.length) * 100)
    : 0

  /* ── Group by stage ── */
  const byStage = {}
  STAGE_ORDER.forEach(s => { byStage[s] = [] })
  docs.forEach(d => {
    if (byStage[d.stage]) byStage[d.stage].push(d)
    else byStage[d.stage] = [d]
  })

  const toggleStage = (stage) =>
    setOpenStages(prev => ({ ...prev, [stage]: !prev[stage] }))

  if (loading) return <p className="dt-loading">טוען מסמכים...</p>

  const pType = previewFile ? previewType(previewFile.url) : null

  return (
    <div className="dt-root" dir="rtl">

      {/* ── Right panel: accordion list ── */}
      <div className="dt-panel-right">

        {/* Progress bar */}
        <div className="dt-progress-section">
          <div className="dt-progress-label">
            <strong>{receivedDocs.length} מתוך {docs.length}</strong> מסמכים התקבלו
          </div>
          <div className="dt-progress-track">
            <div className="dt-progress-fill" style={{ width: `${pct}%`, background: ACCENT }} />
          </div>
          <span className="dt-progress-pct">{pct}%</span>
        </div>

        {/* Accordions */}
        <div className="dt-accordions">
          {STAGE_ORDER.map(stage => {
            const stageDocs     = byStage[stage] || []
            const stageReceived = stageDocs.filter(d => d.status === 'התקבל')
            const isComplete    = stageDocs.length > 0 && stageReceived.length === stageDocs.length
            const isOpen        = openStages[stage]

            return (
              <div key={stage} className="dt-accordion">
                <button
                  type="button"
                  className={'dt-accordion-header' + (isComplete ? ' dt-accordion-header--complete' : '')}
                  onClick={() => toggleStage(stage)}
                >
                  <span className="dt-accordion-arrow">{isOpen ? <IconChevronUp /> : <IconChevronDown />}</span>
                  <span className="dt-accordion-title">{stage}</span>
                  <span className={'dt-accordion-count' + (isComplete ? ' dt-accordion-count--complete' : '')}>
                    {stageReceived.length}/{stageDocs.length}
                  </span>
                </button>

                {isOpen && (
                  <div className="dt-accordion-body">
                    <div className="dt-table-header">
                      <div className="dt-col-name">שם המסמך</div>
                      <div className="dt-col-status">סטטוס</div>
                      <div className="dt-col-date">תאריך</div>
                      <div className="dt-col-file">קובץ</div>
                      <div className="dt-col-notes">הערות</div>
                      <div className="dt-col-delete" />
                    </div>

                    {stageDocs.map((doc, i) => (
                      <DocRow
                        key={doc.id}
                        doc={doc}
                        index={i}
                        onPatch={patchDoc}
                        onUpload={uploadFile}
                        onFileDelete={deleteFile}
                        onDocDelete={deleteDoc}
                        onPreview={setPreviewFile}
                      />
                    ))}

                    <AddDocRow stage={stage} onAdd={addCustomDoc} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>

      {/* ── Left panel: preview ── */}
      <div className="dt-panel-left">
        {previewFile && (
          <>
            <div className="dt-preview-label" title={previewFile.name}>{previewFile.name}</div>
            {pType === 'image' && (
              <img src={previewFile.url} style={{ width: '100%', height: '100%', objectFit: 'contain' }} alt={previewFile.name} />
            )}
            {pType === 'pdf' && (
              <iframe src={previewFile.url} width="100%" height="100%" style={{ border: 'none', flex: 1 }} title={previewFile.name} />
            )}
            {pType === 'word' && (
              wordLoading
                ? <div className="dt-preview-unsupported">טוען...</div>
                : wordError
                  ? <div className="dt-preview-unsupported">שגיאה בטעינת הקובץ</div>
                  : <div
                      dangerouslySetInnerHTML={{ __html: wordHtml }}
                      style={{ background: '#fff', padding: '16px', overflowY: 'auto', fontFamily: 'inherit', flex: 1, minHeight: 0 }}
                    />
            )}
            {pType === 'unsupported' && (
              <p className="dt-preview-unsupported">תצוגה מקדימה אינה זמינה לסוג קובץ זה</p>
            )}
          </>
        )}
      </div>

    </div>
  )
}
