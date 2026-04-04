import { useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import '../../Professionals.css'

/* ── Professions list (full set covering all roles) ── */
export const PROFESSIONS = [
  'אחראית פרויקט', 'מודד', 'קונסטרוקטור', 'מהנדס אינסטלציה',
  'יועץ קרקע', 'קבלן', 'מפקח', 'אחר',
]

const BUCKET = 'professionals-files'

const FILE_SLOTS = [
  { label: 'חתימה',          field: 'file_signature' },
  { label: 'חותמת',          field: 'file_stamp' },
  { label: 'חתימה + חותמת', field: 'file_signature_stamp' },
  { label: 'תעודה מקצועית',  field: 'file_certificate' },
  { label: 'רשיון',          field: 'file_license' },
]

export const EMPTY_PROF_FORM = {
  profession:           '',
  first_name:           '',
  last_name:            '',
  business_name:        '',
  phones:               ['', ''],
  emails:               [''],
  address:              '',
  notes:                '',
  file_signature:       '',
  file_stamp:           '',
  file_signature_stamp: '',
  file_certificate:     '',
  file_license:         '',
  extra_files:          [],
}

/* ── Normalise a DB row into form shape ── */
export function rowToForm(row) {
  let phones = Array.isArray(row.phones) && row.phones.length > 0
    ? row.phones
    : (row.phone ? [row.phone] : [''])
  let emails = Array.isArray(row.emails) && row.emails.length > 0
    ? row.emails
    : (row.email ? [row.email] : [''])
  while (phones.length < 2) phones.push('')
  if (emails.length === 0) emails = ['']

  return {
    profession:           row.profession           ?? '',
    first_name:           row.first_name           ?? '',
    last_name:            row.last_name            ?? '',
    business_name:        row.business_name        ?? '',
    phones,
    emails,
    address:              row.address              ?? '',
    notes:                row.notes                ?? '',
    file_signature:       row.file_signature       ?? '',
    file_stamp:           row.file_stamp           ?? '',
    file_signature_stamp: row.file_signature_stamp ?? '',
    file_certificate:     row.file_certificate     ?? '',
    file_license:         row.file_license         ?? '',
    extra_files:          Array.isArray(row.extra_files) ? row.extra_files : [],
  }
}

function cleanArray(arr) {
  return arr.map(v => v.trim()).filter(Boolean)
}

function storagePath(publicUrl) {
  const marker = `/object/public/${BUCKET}/`
  const idx = publicUrl.indexOf(marker)
  return idx === -1 ? null : publicUrl.slice(idx + marker.length)
}

function prettyName(url) {
  if (!url) return ''
  const raw = decodeURIComponent(url.split('/').pop())
  return raw.replace(/^\d{13}-[a-z0-9]{6}\./, '')
}

async function downloadFile(url, fileName) {
  const response = await fetch(url)
  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = fileName
  a.click()
  URL.revokeObjectURL(blobUrl)
}

async function copyToClipboard(text) {
  if (!text) return
  try { await navigator.clipboard.writeText(text) } catch (e) {}
}

/* ── Inline SVGs (lucide-react not installed) ── */
const IconCopy = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
)

const IconPencil = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
  </svg>
)

const IconDownload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
)

const IconTrash = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    <line x1="10" y1="11" x2="10" y2="17"/>
    <line x1="14" y1="11" x2="14" y2="17"/>
  </svg>
)

/* ── Single file slot (edit mode) ── */
function FileSlot({ label, url, uploading, onUpload, onDelete }) {
  const inputRef = useRef(null)
  return (
    <div className="prof-file-slot">
      <span className="prof-file-slot-label">{label}</span>
      <div className="prof-file-slot-content">
        {uploading ? (
          <span className="prof-file-uploading">מעלה...</span>
        ) : url ? (
          <div className="prof-file-existing">
            <a href={url} target="_blank" rel="noopener noreferrer" className="prof-file-link"
              onClick={e => e.stopPropagation()}>
              📄 {prettyName(url)}
            </a>
            <button type="button" className="prof-file-download"
              onClick={e => { e.stopPropagation(); downloadFile(url, prettyName(url)) }} title="הורד קובץ">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button type="button" className="prof-file-delete" onClick={onDelete}>×</button>
          </div>
        ) : (
          <>
            <input type="file" ref={inputRef} style={{ display: 'none' }}
              onChange={e => { if (e.target.files[0]) { onUpload(e.target.files[0]); e.target.value = '' } }} />
            <button type="button" className="prof-file-pick-btn" onClick={() => inputRef.current?.click()}>
              + בחר קובץ
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────
 * ProfessionalModal
 *
 * Mount/unmount to open/close — no `open` prop.
 * Parents: {modalOpen && <ProfessionalModal key={editRow?.id ?? 'new'} .../>}
 *
 * Props:
 *   editRow      object | null  — null = add new; full DB row = edit
 *   onClose      () => void
 *   onSaved      (row, isNew: boolean) => void
 *   onDeleted    (id) => void
 *   onRowPatched (id, patch) => void   — optional
 * ──────────────────────────────────────────────────────────────── */
export default function ProfessionalModal({ editRow, onClose, onSaved, onDeleted, onRowPatched }) {
  const editId = editRow?.id ?? null

  /* view = read-only (default for existing), edit = full form (default for new) */
  const [mode, setMode] = useState(editId ? 'view' : 'edit')

  const [form, setForm]                     = useState(editRow ? rowToForm(editRow) : EMPTY_PROF_FORM)
  const [saving, setSaving]                 = useState(false)
  const [saveError, setSaveError]           = useState('')
  const [deleteConfirm, setDeleteConfirm]   = useState(false)
  const [uploadingSlots, setUploadingSlots] = useState({})
  const [addingExtra, setAddingExtra]       = useState(false)
  const [newExtraLabel, setNewExtraLabel]   = useState('')

  const handleClose = () => { setSaveError(''); setDeleteConfirm(false); onClose() }

  /* ── View mode: build flat field list ── */
  const viewFields = [
    { label: 'מקצוע',      value: form.profession },
    { label: 'שם פרטי',    value: form.first_name },
    { label: 'שם משפחה',   value: form.last_name },
    { label: 'שם עסק',     value: form.business_name },
    { label: 'טלפון פרטי', value: form.phones[0] },
    { label: 'טלפון משרד', value: form.phones[1] },
    ...form.phones.slice(2).map((ph, i) => ({ label: `טלפון ${i + 3}`, value: ph })),
    ...form.emails.map((em, i) => ({ label: i === 0 ? 'מייל' : `מייל ${i + 1}`, value: em })),
    { label: 'כתובת',      value: form.address },
    { label: 'הערות',      value: form.notes },
  ].filter(f => f.value?.trim())

  const viewFiles = [
    ...FILE_SLOTS.map(s => ({ label: s.label, url: form[s.field] })),
    ...form.extra_files.map(ef => ({ label: ef.label, url: ef.url })),
  ].filter(f => f.url)

  /* ── Edit mode handlers ── */
  const handleField = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const setListItem = (field, idx, val) =>
    setForm(prev => { const next = [...prev[field]]; next[idx] = val; return { ...prev, [field]: next } })
  const addListItem = field =>
    setForm(prev => ({ ...prev, [field]: [...prev[field], ''] }))
  const removeListItem = (field, idx) =>
    setForm(prev => { const next = prev[field].filter((_, i) => i !== idx); return { ...prev, [field]: next.length > 0 ? next : [''] } })

  /* ── Storage ── */
  const uploadToStorage = async (file) => {
    const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
    const path = `files/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file)
    if (error) { console.error('Upload error:', error); return null }
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)
    return publicUrl
  }

  const removeFromStorage = async (url) => {
    const path = storagePath(url)
    if (path) await supabase.storage.from(BUCKET).remove([path])
  }

  const handleSlotUpload = async (field, file) => {
    setUploadingSlots(prev => ({ ...prev, [field]: true }))
    const url = await uploadToStorage(file)
    if (url) {
      setForm(prev => ({ ...prev, [field]: url }))
      if (editId) { await supabase.from('professionals').update({ [field]: url }).eq('id', editId); onRowPatched?.(editId, { [field]: url }) }
    }
    setUploadingSlots(prev => ({ ...prev, [field]: false }))
  }

  const handleSlotDelete = async (field) => {
    const url = form[field]
    if (url) await removeFromStorage(url)
    setForm(prev => ({ ...prev, [field]: '' }))
    if (editId) { await supabase.from('professionals').update({ [field]: null }).eq('id', editId); onRowPatched?.(editId, { [field]: null }) }
  }

  const handleExtraUpload = async (index, file) => {
    const key = `extra_${index}`
    setUploadingSlots(prev => ({ ...prev, [key]: true }))
    const url = await uploadToStorage(file)
    if (url) {
      const updated = form.extra_files.map((ef, i) => i === index ? { ...ef, url } : ef)
      setForm(prev => ({ ...prev, extra_files: updated }))
      if (editId) { await supabase.from('professionals').update({ extra_files: updated }).eq('id', editId); onRowPatched?.(editId, { extra_files: updated }) }
    }
    setUploadingSlots(prev => ({ ...prev, [key]: false }))
  }

  const handleExtraDelete = async (index) => {
    const ef = form.extra_files[index]
    if (ef?.url) await removeFromStorage(ef.url)
    const updated = form.extra_files.filter((_, i) => i !== index)
    setForm(prev => ({ ...prev, extra_files: updated }))
    if (editId) { await supabase.from('professionals').update({ extra_files: updated }).eq('id', editId); onRowPatched?.(editId, { extra_files: updated }) }
  }

  const confirmAddExtra = () => {
    if (!newExtraLabel.trim()) return
    setForm(prev => ({ ...prev, extra_files: [...prev.extra_files, { label: newExtraLabel.trim(), url: '' }] }))
    setNewExtraLabel(''); setAddingExtra(false)
  }

  const handleSave = async () => {
    if (!form.first_name.trim() && !form.last_name.trim()) return
    setSaving(true); setSaveError('')
    const payload = {
      profession: form.profession, first_name: form.first_name.trim(), last_name: form.last_name.trim(),
      business_name: form.business_name, phones: cleanArray(form.phones), emails: cleanArray(form.emails),
      address: form.address, notes: form.notes,
      file_signature: form.file_signature || null, file_stamp: form.file_stamp || null,
      file_signature_stamp: form.file_signature_stamp || null, file_certificate: form.file_certificate || null,
      file_license: form.file_license || null, extra_files: form.extra_files.filter(ef => ef.label),
    }
    try {
      if (editId) {
        const { data, error } = await supabase.from('professionals').update(payload).eq('id', editId).select().single()
        if (error) throw error
        onSaved(data, false)
      } else {
        const { data, error } = await supabase.from('professionals').insert([payload]).select().single()
        if (error) throw error
        onSaved(data, true)
      }
      handleClose()
    } catch (err) {
      console.error('Save error:', err); setSaveError(err?.message || 'שגיאה בשמירה')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    await supabase.from('professionals').delete().eq('id', editId)
    onDeleted(editId); handleClose()
  }

  /* ── Title ── */
  const modalTitle = editId
    ? (mode === 'view' ? 'פרטי בעל מקצוע' : 'עריכת בעל מקצוע')
    : 'בעל מקצוע חדש'

  return (
    <>
      <div className="prof-modal-overlay">
        <div className={`prof-modal${mode === 'view' ? ' prof-modal--view' : ''}`}>

          {/* ── Header ── */}
          <div className="prof-modal-header">
            <span className="prof-modal-title">{modalTitle}</span>
            <div className="prof-modal-header-actions">
              {editId && mode === 'view' && (
                <button type="button" className="prof-view-edit-btn" onClick={() => setMode('edit')} title="ערוך">
                  <IconPencil />
                </button>
              )}
              {editId && mode === 'edit' && (
                <button type="button" className="prof-mode-back-btn" onClick={() => setMode('view')}>
                  חזור לתצוגה
                </button>
              )}
              <button className="prof-modal-close" onClick={handleClose}>×</button>
            </div>
          </div>

          {/* ════════════════ VIEW MODE ════════════════ */}
          {mode === 'view' && (
            <>
              <div className="prof-modal-body prof-view-body">

                {/* Text fields */}
                {viewFields.map(({ label, value }) => (
                  <div key={label} className="prof-view-row">
                    <span className="prof-view-label">{label}</span>
                    <span className="prof-view-value">{value}</span>
                    <button type="button" className="prof-view-copy"
                      onClick={() => copyToClipboard(value)} title="העתק">
                      <IconCopy />
                    </button>
                  </div>
                ))}

                {/* Files — compact, download-only */}
                {viewFiles.length > 0 && (
                  <div className="prof-view-files">
                    <div className="prof-files-title">קבצים ומסמכים</div>
                    {viewFiles.map(({ label, url }) => (
                      <div key={url} className="prof-view-row">
                        <span className="prof-view-label">{label}</span>
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="prof-file-link prof-view-value" onClick={e => e.stopPropagation()}>
                          📄 {prettyName(url)}
                        </a>
                        <button type="button" className="prof-view-copy"
                          onClick={() => downloadFile(url, prettyName(url))} title="הורד קובץ">
                          <IconDownload />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

              </div>

              {/* View footer — trash only */}
              <div className="prof-modal-footer">
                <button type="button" className="prof-modal-trash-btn"
                  onClick={() => setDeleteConfirm(true)} title="מחק בעל מקצוע">
                  <IconTrash />
                </button>
                <span />
              </div>
            </>
          )}

          {/* ════════════════ EDIT MODE ════════════════ */}
          {mode === 'edit' && (
            <>
              <div className="prof-modal-body">

                {/* מקצוע */}
                <div className="prof-form-row">
                  <label className="prof-form-label">מקצוע</label>
                  <select name="profession" className="prof-form-input" value={form.profession} onChange={handleField}>
                    <option value="">— בחר מקצוע —</option>
                    {PROFESSIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                {/* שם */}
                <div className="prof-form-row-2col">
                  <div className="prof-form-row">
                    <label className="prof-form-label">שם פרטי</label>
                    <input name="first_name" className="prof-form-input" value={form.first_name} onChange={handleField} placeholder="שם פרטי" />
                  </div>
                  <div className="prof-form-row">
                    <label className="prof-form-label">שם משפחה</label>
                    <input name="last_name" className="prof-form-input" value={form.last_name} onChange={handleField} placeholder="שם משפחה" />
                  </div>
                </div>

                {/* שם עסק */}
                <div className="prof-form-row">
                  <label className="prof-form-label">שם עסק</label>
                  <input name="business_name" className="prof-form-input" value={form.business_name} onChange={handleField} placeholder="שם העסק" />
                </div>

                {/* טלפונים */}
                <div className="prof-form-row">
                  <label className="prof-form-label">טלפונים</label>
                  <div className="prof-list-group">
                    <div className="prof-list-item">
                      <span className="prof-phone-label">טלפון פרטי</span>
                      <input type="tel" className="prof-form-input" value={form.phones[0]}
                        onChange={e => setListItem('phones', 0, e.target.value)} placeholder="05X-XXXXXXX" dir="ltr" />
                    </div>
                    <div className="prof-list-item">
                      <span className="prof-phone-label">טלפון משרד</span>
                      <input type="tel" className="prof-form-input" value={form.phones[1]}
                        onChange={e => setListItem('phones', 1, e.target.value)} placeholder="0X-XXXXXXX" dir="ltr" />
                    </div>
                    {form.phones.slice(2).map((ph, i) => (
                      <div key={i + 2} className="prof-list-item">
                        <span className="prof-phone-label" />
                        <input type="tel" className="prof-form-input" value={ph}
                          onChange={e => setListItem('phones', i + 2, e.target.value)} placeholder="05X-XXXXXXX" dir="ltr" />
                        <button type="button" className="prof-list-remove" onClick={() => removeListItem('phones', i + 2)}>×</button>
                      </div>
                    ))}
                    <button type="button" className="prof-list-add" onClick={() => addListItem('phones')}>+ הוסף טלפון</button>
                  </div>
                </div>

                {/* מיילים */}
                <div className="prof-form-row">
                  <label className="prof-form-label">מיילים</label>
                  <div className="prof-list-group">
                    {form.emails.map((em, i) => (
                      <div key={i} className="prof-list-item">
                        <input type="email" className="prof-form-input" value={em}
                          onChange={e => setListItem('emails', i, e.target.value)} placeholder="example@mail.com" dir="ltr" />
                        {form.emails.length > 1 && (
                          <button type="button" className="prof-list-remove" onClick={() => removeListItem('emails', i)}>×</button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="prof-list-add" onClick={() => addListItem('emails')}>+ הוסף מייל</button>
                  </div>
                </div>

                {/* כתובת */}
                <div className="prof-form-row">
                  <label className="prof-form-label">כתובת</label>
                  <input name="address" className="prof-form-input" value={form.address} onChange={handleField} placeholder="כתובת" />
                </div>

                {/* הערות */}
                <div className="prof-form-row">
                  <label className="prof-form-label">הערות</label>
                  <textarea name="notes" className="prof-form-input prof-form-textarea"
                    value={form.notes} onChange={handleField} placeholder="הערות נוספות..." rows={3} />
                </div>

                {/* קבצים ומסמכים */}
                <div className="prof-files-section">
                  <div className="prof-files-title">קבצים ומסמכים</div>
                  {FILE_SLOTS.map(({ label, field }) => (
                    <FileSlot key={field} label={label} url={form[field]}
                      uploading={!!uploadingSlots[field]}
                      onUpload={file => handleSlotUpload(field, file)}
                      onDelete={() => handleSlotDelete(field)} />
                  ))}
                  {form.extra_files.map((ef, i) => (
                    <FileSlot key={i} label={ef.label} url={ef.url}
                      uploading={!!uploadingSlots[`extra_${i}`]}
                      onUpload={file => handleExtraUpload(i, file)}
                      onDelete={() => handleExtraDelete(i)} />
                  ))}
                  {addingExtra ? (
                    <div className="prof-extra-add-row">
                      <input className="prof-form-input" value={newExtraLabel}
                        onChange={e => setNewExtraLabel(e.target.value)} placeholder="שם המסמך..."
                        onKeyDown={e => { if (e.key === 'Enter') confirmAddExtra() }} autoFocus />
                      <button type="button" className="prof-extra-confirm-btn" onClick={confirmAddExtra}>הוסף</button>
                      <button type="button" className="prof-list-remove"
                        onClick={() => { setAddingExtra(false); setNewExtraLabel('') }}>×</button>
                    </div>
                  ) : (
                    <button type="button" className="prof-list-add prof-files-add-btn" onClick={() => setAddingExtra(true)}>
                      + הוסף קובץ
                    </button>
                  )}
                </div>

              </div>

              {/* Edit footer */}
              <div className="prof-modal-footer">
                {editId ? (
                  <button type="button" className="prof-modal-trash-btn"
                    onClick={() => setDeleteConfirm(true)} title="מחק בעל מקצוע">
                    <IconTrash />
                  </button>
                ) : <span />}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {saveError && <span style={{ color: '#ef4444', fontSize: '13px' }}>⚠ {saveError}</span>}
                  <button className="prof-modal-cancel" onClick={handleClose}>ביטול</button>
                  <button className="prof-modal-save" onClick={handleSave}
                    disabled={saving || (!form.first_name.trim() && !form.last_name.trim())}>
                    {saving ? 'שומר...' : 'שמור'}
                  </button>
                </div>
              </div>
            </>
          )}

        </div>
      </div>

      {/* ── Delete Confirm ── */}
      {deleteConfirm && (
        <div className="prof-modal-overlay">
          <div className="prof-modal prof-modal--sm">
            <div className="prof-modal-header">
              <span className="prof-modal-title">מחיקת בעל מקצוע</span>
              <button className="prof-modal-close" onClick={() => setDeleteConfirm(false)}>×</button>
            </div>
            <div className="prof-modal-body">
              <p className="prof-confirm-text">האם למחוק את בעל המקצוע? פעולה זו אינה הפיכה.</p>
            </div>
            <div className="prof-modal-footer">
              <span />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="prof-modal-cancel" onClick={() => setDeleteConfirm(false)}>ביטול</button>
                <button className="prof-modal-delete" onClick={handleDelete}>מחק</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
