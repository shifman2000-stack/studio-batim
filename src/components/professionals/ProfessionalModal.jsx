import { useEffect, useRef, useState } from 'react'
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
  /* Portal login. portal_access is an ACCESS GRANT, not a preference;
     portal_code is minted by the DB and never edited here. */
  portal_access:        false,
  portal_code:          '',
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
    portal_access:        row.portal_access === true,
    portal_code:          row.portal_code          ?? '',
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

  /* ── Portal login controls — ADMIN ONLY ──────────────────────────────
     The DB enforces this twice over: enforce_professional_portal_columns
     raises PT006 on a non-admin write to portal_access/portal_code, and
     issue_contractor_portal_code raises PT003 for a non-admin caller.
     This probe only decides whether to RENDER the controls, so an
     employee is never shown an affordance that would fail. Same
     profiles.role probe Reports.jsx and ProjectsKanban.jsx already use. */
  const [isAdmin, setIsAdmin] = useState(false)
  const [codeBusy, setCodeBusy] = useState(false)
  const [codeError, setCodeError] = useState('')
  const [codeCopied, setCodeCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session || cancelled) return
        const { data } = await supabase
          .from('profiles').select('role').eq('id', session.user.id).maybeSingle()
        if (!cancelled) setIsAdmin(data?.role === 'admin')
      } catch {
        /* Probe failure leaves isAdmin false — the controls stay hidden
           rather than being shown to someone who may not be an admin. */
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleClose = () => { setSaveError(''); setDeleteConfirm(false); onClose() }

  /* ── Mint the registration code ──────────────────────────────────────
     MINT-ONCE by design: the RPC returns the existing code unchanged if
     one is already set, so there is deliberately no "regenerate" or
     "refresh" control anywhere — a code Einav has already sent must stay
     valid. */
  const handleIssueCode = async () => {
    if (!editId || codeBusy) return
    setCodeBusy(true); setCodeError('')
    try {
      const { data, error } = await supabase
        .rpc('issue_contractor_portal_code', { p_professional_id: editId })

      if (error) {
        console.error('issue_contractor_portal_code failed:', error)
        setCodeError(
          error.code === 'PT003' ? 'רק מנהלת יכולה להפיק קוד הרשאה.' :
          error.code === 'PT004' ? 'בעל המקצוע לא נמצא. יש לשמור את הכרטיס ולנסות שוב.' :
          error.code === 'PT005' ? 'לא נמצא קוד פנוי. יש לפנות לתמיכה.' :
          'לא הצלחנו להפיק קוד, נסי שוב.'
        )
        return
      }
      if (!data) {
        /* No error and no code — treat as a failure rather than showing
           an empty code field as if it had worked. */
        console.error('issue_contractor_portal_code returned no code')
        setCodeError('לא הצלחנו להפיק קוד, נסי שוב.')
        return
      }

      setForm(prev => ({ ...prev, portal_code: data }))
      onRowPatched?.(editId, { portal_code: data })
    } catch (e) {
      console.error('issue_contractor_portal_code threw:', e)
      setCodeError('לא הצלחנו להפיק קוד, נסי שוב.')
    } finally {
      setCodeBusy(false)
    }
  }

  /* ── Toggle portal access ────────────────────────────────────────────
     Written immediately rather than on save, matching how the file slots
     on this card already behave. Row count is checked: a refused UPDATE
     answers 204 with no body, which is otherwise indistinguishable from
     success, and this particular write decides whether a person can log
     in to the studio's data. */
  const handleTogglePortalAccess = async (next) => {
    if (!editId || codeBusy) return
    setCodeBusy(true); setCodeError('')
    const prev = form.portal_access
    setForm(f => ({ ...f, portal_access: next }))
    try {
      const { data, error } = await supabase
        .from('professionals')
        .update({ portal_access: next })
        .eq('id', editId)
        .select('id')

      if (error || !Array.isArray(data) || data.length === 0) {
        console.error('portal_access update failed:', error || '0 rows affected')
        setForm(f => ({ ...f, portal_access: prev }))
        setCodeError(error?.code === 'PT006'
          ? 'רק מנהלת יכולה לשנות הרשאת כניסה.'
          : 'לא הצלחנו לעדכן את ההרשאה, נסי שוב.')
        return
      }
      onRowPatched?.(editId, { portal_access: next })
    } catch (e) {
      console.error('portal_access update threw:', e)
      setForm(f => ({ ...f, portal_access: prev }))
      setCodeError('לא הצלחנו לעדכן את ההרשאה, נסי שוב.')
    } finally {
      setCodeBusy(false)
    }
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(form.portal_code)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } catch { /* clipboard blocked — the code is on screen to read */ }
  }

  /* ── Invitation message ──────────────────────────────────────────────
     The contractor counterpart of ProjectsKanban.handleOpenWelcomeMessage:
     same structure (greeting → what the space is for → the login URL and
     the כניסת משתמשים button → which address to use → prefer Google →
     the code for the non-Google path → sign-off), same voice, same
     emoji. Two deliberate differences, both forced by who is reading it:
     it is singular rather than the client message's plural family
     address, and it is sourced from THIS CARD rather than from a project,
     because a contractor may work on several projects or none yet. */
  const [invitePopup, setInvitePopup] = useState(null)

  const buildInviteMessage = () => {
    const name = [form.first_name, form.last_name].filter(Boolean).join(' ').trim()
      || (form.business_name || '').trim()

    const addresses = cleanArray(form.emails)
    const emailsBlock =
      addresses.length === 0
        ? 'חשוב: ההתחברות חייבת להיות עם המייל הרשום אצלנו.'
        : addresses.length === 1
          ? `חשוב: ההתחברות חייבת להיות עם המייל הרשום אצלנו: ${addresses[0]}`
          : `חשוב: ההתחברות חייבת להיות עם אחד מהמיילים הרשומים אצלנו:\n${addresses.join('\n')}`

    return `שלום ${name || ''} 🏠

שמחה לפתוח עבורך גישה אישית למערכת של סטודיו בתים — מקום אחד שבו תוכל לצפות בתוכניות לביצוע של הפרויקטים שלך, להוריד אותן, ולהחזיר אלינו קבצים חתומים.

הכניסה למערכת היא דרך האתר שלנו:
https://batim-es.com/
דרך כפתור "כניסת משתמשים"

${emailsBlock}

ההמלצה שלנו היא להתחבר עם חשבון Google (הכי פשוט ומאובטח).

אם המייל שלך אינו חשבון Google, ניתן להירשם עם המייל הזה וסיסמה שתבחר, באמצעות קוד ההרשאה:
${form.portal_code || '—'}

אשמח לעמוד לרשותך בכל שאלה 🤍
עינב | סטודיו בתים`
  }

  const handleCopyInvite = async () => {
    if (!invitePopup) return
    try {
      await navigator.clipboard.writeText(invitePopup.message)
      setInvitePopup(prev => prev ? { ...prev, copied: true } : null)
      setTimeout(() => {
        setInvitePopup(prev => prev ? { ...prev, copied: false } : null)
      }, 2000)
    } catch { /* clipboard blocked — the text is selectable on screen */ }
  }

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

                {/* ── כניסה למערכת — ADMIN ONLY, and only on a saved card ──
                    HIDDEN rather than disabled for non-admins: a disabled
                    control advertises a capability an employee cannot use
                    and invites "why not?", and greying out the code would
                    still put it on their screen. Hiding is a UI-clarity
                    choice, not a security boundary — the boundary is the
                    DB trigger (PT006) and the RPC's own admin check
                    (PT003), both of which hold regardless of this render.

                    Sits directly under מיילים because it acts ON those
                    addresses: the code lets the person register, and
                    link_contractor_on_login matches whatever they sign in
                    with against emails[]. */}
                {isAdmin && editId && (
                  <div className="prof-form-row">
                    <label className="prof-form-label">כניסה למערכת</label>
                    <div className="prof-list-group">

                      <label style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        cursor: codeBusy ? 'default' : 'pointer', direction: 'rtl',
                      }}>
                        <input
                          type="checkbox"
                          checked={!!form.portal_access}
                          disabled={codeBusy}
                          onChange={e => handleTogglePortalAccess(e.target.checked)}
                          style={{ marginTop: 3, flexShrink: 0 }}
                        />
                        <span>
                          <span style={{ fontWeight: 600 }}>
                            מאפשר לבעל המקצוע להתחבר למערכת של הסטודיו
                          </span>
                          <span style={{ display: 'block', fontSize: 12, color: '#8a8680', lineHeight: 1.5 }}>
                            סימון האפשרות נותן גישה אישית למערכת עם אחת מכתובות המייל שלמעלה.
                            הפרויקטים שיוצגו לו נקבעים לפי שיוכו כקבלן בכרטיסי הפרויקטים.
                          </span>
                        </span>
                      </label>

                      <div className="prof-list-item" style={{ marginTop: 10, alignItems: 'center' }}>
                        {form.portal_code ? (
                          <>
                            <span
                              dir="ltr"
                              style={{
                                fontFamily: 'monospace', fontSize: 15, fontWeight: 700,
                                letterSpacing: 1, color: '#1a1a18',
                                background: '#eee9e1', borderRadius: 4, padding: '4px 8px',
                              }}
                            >
                              {form.portal_code}
                            </span>
                            <button type="button" className="prof-list-add" onClick={copyCode}>
                              {codeCopied ? 'הועתק ✓' : 'העתק קוד'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="prof-list-add"
                            onClick={handleIssueCode}
                            disabled={codeBusy}
                          >
                            {codeBusy ? 'מפיק…' : 'הפק קוד הרשאה'}
                          </button>
                        )}
                      </div>

                      <div style={{ fontSize: 12, color: '#8a8680', lineHeight: 1.5, marginTop: 4 }}>
                        הקוד נועד למי שכתובת המייל שלו אינה חשבון Google. הוא אישי, קבוע, ומשמש פעם אחת ליצירת החשבון.
                      </div>

                      {form.portal_code && (
                        <div className="prof-list-item" style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            className="prof-list-add"
                            onClick={() => setInvitePopup({ message: buildInviteMessage(), copied: false })}
                          >
                            הודעת הזמנה
                          </button>
                        </div>
                      )}

                      {codeError && (
                        <div style={{
                          marginTop: 8, fontSize: 12, color: '#a83232',
                          background: '#fff5f5', border: '1px solid #f4c8c8',
                          borderRadius: 6, padding: '6px 10px',
                        }} role="alert">
                          {codeError}
                        </div>
                      )}
                    </div>
                  </div>
                )}

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

      {/* ── Invitation message popup ──
          Overlays the card and returns to it on close, the same way
          ProjectsKanban's welcome popup overlays the settings modal.
          Einav copies the text and sends it herself — nothing is sent
          from the app. */}
      {invitePopup && (
        <div className="prof-modal-overlay">
          <div className="prof-modal">
            <div className="prof-modal-header">
              <span className="prof-modal-title">הודעת הזמנה לבעל מקצוע</span>
              <button className="prof-modal-close" onClick={() => setInvitePopup(null)}>×</button>
            </div>
            <div className="prof-modal-body">
              <textarea
                readOnly
                value={invitePopup.message}
                rows={18}
                dir="rtl"
                className="prof-form-input prof-form-textarea"
                style={{ width: '100%', lineHeight: 1.6, fontSize: 13, resize: 'vertical' }}
                onFocus={e => e.target.select()}
              />
            </div>
            <div className="prof-modal-footer">
              <span />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="prof-modal-cancel" onClick={() => setInvitePopup(null)}>סגור</button>
                <button className="prof-modal-save" onClick={handleCopyInvite}>
                  {invitePopup.copied ? 'הועתק ✓' : 'העתק הודעה'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
