// src/pages/ChildInquiryForm.jsx
//
// Public, unauthenticated form for a PARENT project's own inquiry
// token (projects.child_inquiry_token) — a completely separate flow
// from the regular InquiryForm.jsx / inquiries table. A visitor with
// this link is asking about a specific model under a specific parent
// project; submitting inserts one row into child_project_inquiries.
//
// Data comes from the SECURITY DEFINER function
// get_child_inquiry_form_data(p_token) — one row per model belonging
// to the token's parent project (or a single null-model row if it has
// none yet), zero rows if the token doesn't match any is_parent_project
// project. No direct table access is needed or granted to anon for the
// read side; the INSERT itself goes through the anon-INSERT-only RLS
// policy on child_project_inquiries.
//
// Visual style intentionally mirrors InquiryForm.jsx (same fonts,
// spacing, RTL layout, theme.css tokens) but is a separate component —
// this flow has nothing else in common with the regular inquiry form
// (no preview mode, no resumable token, no project-type/size fields).

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import logoUrl from '../logo-A-stacked.svg'

/* ID scans go into the SAME bucket the app's documents live in, under a
   `child-inquiries/` prefix — the anon INSERT storage policy
   (anon_upload_child_inquiry_ids) only permits objects whose FIRST path
   segment is exactly that. Keeping them in project-files means the
   conversion flow can attach them to the new project's document rows by
   URL alone, with no copy between buckets. */
const BUCKET = 'project-files'
const ID_FOLDER = 'child-inquiries'

/* ASCII-only extension for the storage path — the original (possibly
   Hebrew) filename is preserved separately in *_id_file_name. */
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

/* One "צילום ת.ז" slot — pick / show / remove. Kept as its own
   component because contact 1 and contact 2 render an identical one and
   the empty-vs-filled branching is fiddly enough to be worth naming.
   Images and PDF only, matching what an ID scan realistically is. */
function IdFileField({ file, uploading, inputRef, onPick, onClear, required, error }) {
  return (
    <div style={styles.fieldGroup}>
      <label style={styles.label}>
        צילום ת.ז {required && <span style={styles.asterisk}>*</span>}
      </label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={onPick}
      />
      {file ? (
        <div style={styles.idFileRow}>
          <span style={styles.idFileName} title={file.name}>{file.name}</span>
          <button
            type="button"
            style={styles.idFileAction}
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            החלף
          </button>
          <button
            type="button"
            style={{ ...styles.idFileAction, color: '#E24B4A' }}
            onClick={onClear}
            disabled={uploading}
          >
            הסר
          </button>
        </div>
      ) : (
        <button
          type="button"
          style={error ? { ...styles.idFilePickBtn, borderColor: '#E24B4A' } : styles.idFilePickBtn}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'מעלה...' : '+ בחר קובץ'}
        </button>
      )}
      {error && <span style={styles.fieldError}>יש לצרף צילום ת.ז</span>}
    </div>
  )
}

export default function ChildInquiryForm() {
  const { token } = useParams()

  const [status, setStatus] = useState('loading') // loading | not_found | form | success
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  /* One flag per validated field. Contact 1 + מגרש + (when the parent
     has any) דגם are always required; contact 2's six fields are
     all-or-nothing — see buildErrors below. */
  const EMPTY_ERRORS = {
    firstName: false, lastName: false, phone: false, email: false,
    idNumber: false, idFile: false,
    plot: false, model: false,
    c2FirstName: false, c2LastName: false, c2Phone: false, c2Email: false,
    c2IdNumber: false, c2IdFile: false,
  }
  const [fieldErrors, setFieldErrors] = useState(EMPTY_ERRORS)
  /* Convenience for the many onChange handlers that just clear one flag. */
  const clearError = (key) => setFieldErrors(prev => (prev[key] ? { ...prev, [key]: false } : prev))

  const [parentProjectId, setParentProjectId] = useState('')
  const [projectName, setProjectName] = useState('')
  const [models, setModels]           = useState([]) // [{ id, name, size, render_url }]

  const [contact1FirstName, setContact1FirstName] = useState('')
  const [contact1LastName, setContact1LastName]   = useState('')
  const [contact1Phone, setContact1Phone] = useState('')
  const [contact1Email, setContact1Email] = useState('')
  const [contact2FirstName, setContact2FirstName] = useState('')
  const [contact2LastName, setContact2LastName]   = useState('')
  const [contact2Phone, setContact2Phone] = useState('')
  const [contact2Email, setContact2Email] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')

  /* ת.ז — text + an uploaded scan, per contact. Neither is required
     (see handleSubmit): only contact 1's name/phone/email are, and
     contact 2 stays entirely optional, so these follow that pattern. */
  const [contact1IdNumber, setContact1IdNumber] = useState('')
  const [contact2IdNumber, setContact2IdNumber] = useState('')
  /* { url, name } | null — set once the file is uploaded, which happens
     immediately on pick (before submit) so the row insert only ever
     carries a finished URL. */
  const [contact1IdFile, setContact1IdFile] = useState(null)
  const [contact2IdFile, setContact2IdFile] = useState(null)
  const [uploadingId, setUploadingId] = useState(null) // 1 | 2 | null

  const [plotNumber, setPlotNumber] = useState('')

  const idFileInput1 = useRef(null)
  const idFileInput2 = useRef(null)

  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase.rpc('get_child_inquiry_form_data', { p_token: token })
      if (error || !Array.isArray(data) || data.length === 0) { setStatus('not_found'); return }

      setParentProjectId(data[0].project_id)
      setProjectName(data[0].project_name || '')
      setModels(
        data
          .filter(r => r.model_id)
          .map(r => ({
            id: r.model_id,
            name: r.model_name,
            /* The RPC's model columns follow project_models' restructure:
               model_description → model_size (project_models.size), and
               model_image_url → model_render_url
               (project_models.render_file_url). */
            size: r.model_size,
            render_url: r.model_render_url,
          }))
      )
      setStatus('form')
    }
    fetchData()
  }, [token])

  /* Has the visitor touched ANY contact-2 field? Drives both the
     all-or-nothing validation and the asterisks in the contact-2 block,
     which appear only once the block is in play. */
  const contact2AnyFilled = !!(
    contact2FirstName.trim() || contact2LastName.trim() ||
    contact2Phone.trim()     || contact2Email.trim()    ||
    contact2IdNumber.trim()  || contact2IdFile
  )

  /* If the visitor empties the contact-2 block again after a failed
     submit, it goes back to being optional — so its "שדה חובה" markers
     must go with it. Without this they'd linger on fields that are no
     longer required (clearError only fires for the field being typed
     in, and emptying the LAST filled field is what flips the whole
     block back to optional). */
  useEffect(() => {
    if (contact2AnyFilled) return
    setFieldErrors(prev => (
      (prev.c2FirstName || prev.c2LastName || prev.c2Phone ||
       prev.c2Email || prev.c2IdNumber || prev.c2IdFile)
        ? { ...prev, c2FirstName: false, c2LastName: false, c2Phone: false,
                     c2Email: false, c2IdNumber: false, c2IdFile: false }
        : prev
    ))
  }, [contact2AnyFilled])

  /* Upload an ID scan the moment it's picked, so submit only ever
     writes an already-finished public URL. `which` is 1 | 2.

     NOTE: the anon policy grants INSERT only — there is no anon DELETE
     on storage.objects. "הסר" therefore just drops the reference from
     this form; the object itself stays in the bucket. Replacing a file
     likewise leaves the previous object behind. Harmless (nothing links
     to it) but it does mean abandoned uploads accumulate under
     child-inquiries/ and would need an occasional sweep. */
  async function handleIdFileSelected(e, which) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setErrorMsg('')
    setUploadingId(which)
    try {
      const ext  = asciiExt(file.name)
      const path = `${ID_FOLDER}/${token}/${newUuid()}${ext ? `.${ext}` : ''}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, file)
      if (error) throw error
      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)
      const picked = { url: publicUrl, name: file.name }
      if (which === 1) { setContact1IdFile(picked); clearError('idFile') }
      else             { setContact2IdFile(picked); clearError('c2IdFile') }
    } catch (err) {
      console.error('child inquiry ID upload error:', err)
      setErrorMsg('אירעה שגיאה בהעלאת הקובץ. אנא נסה שוב.')
    }
    setUploadingId(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErrorMsg('')

    const errors = {
      /* Contact 1 — everything, including the ת.ז scan. */
      firstName: !contact1FirstName.trim(),
      lastName:  !contact1LastName.trim(),
      phone:     !contact1Phone.trim(),
      email:     !contact1Email.trim(),
      idNumber:  !contact1IdNumber.trim(),
      idFile:    !contact1IdFile,

      plot:      !plotNumber.trim(),
      /* Only meaningful when the parent actually has models — with none
         the field isn't rendered at all, so it can't be required. */
      model:     models.length > 0 && !selectedModelId,

      /* Contact 2 — all-or-nothing. Untouched, the whole block stays
         optional; touch ANY one of its six fields and the rest become
         required so we never store a half-filled second applicant. */
      c2FirstName: contact2AnyFilled && !contact2FirstName.trim(),
      c2LastName:  contact2AnyFilled && !contact2LastName.trim(),
      c2Phone:     contact2AnyFilled && !contact2Phone.trim(),
      c2Email:     contact2AnyFilled && !contact2Email.trim(),
      c2IdNumber:  contact2AnyFilled && !contact2IdNumber.trim(),
      c2IdFile:    contact2AnyFilled && !contact2IdFile,
    }
    setFieldErrors(errors)
    if (Object.values(errors).some(Boolean)) return

    setSubmitting(true)

    const contact1FullName = [contact1FirstName.trim(), contact1LastName.trim()].filter(Boolean).join(' ')
    const contact2FullName = [contact2FirstName.trim(), contact2LastName.trim()].filter(Boolean).join(' ') || null

    const { error } = await supabase.from('child_project_inquiries').insert({
      parent_project_id: parentProjectId,
      contact1_name:  contact1FullName,
      contact1_phone: contact1Phone.trim(),
      contact1_email: contact1Email.trim(),
      contact2_name:  contact2FullName,
      contact2_phone: contact2Phone.trim() || null,
      contact2_email: contact2Email.trim() || null,
      selected_model_id: selectedModelId || null,
      contact1_id_number: contact1IdNumber.trim() || null,
      contact2_id_number: contact2IdNumber.trim() || null,
      contact1_id_file_url:  contact1IdFile?.url  || null,
      contact1_id_file_name: contact1IdFile?.name || null,
      contact2_id_file_url:  contact2IdFile?.url  || null,
      contact2_id_file_name: contact2IdFile?.name || null,
      plot_number: plotNumber.trim() || null,
    })

    setSubmitting(false)

    if (error) {
      setErrorMsg('אירעה שגיאה בשליחת הטופס. אנא נסה שוב.')
      return
    }

    setStatus('success')
  }

  // ── Render states ──

  if (status === 'loading') {
    return <div style={styles.page}><p style={styles.stateMsg}>טוען...</p></div>
  }

  if (status === 'not_found') {
    return (
      <div style={styles.page}>
        <img src={logoUrl} alt="סטודיו בתים" style={styles.logo} />
        <div style={styles.stateBox}>
          <p style={styles.stateMsg}>הקישור אינו תקין.</p>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div style={styles.page}>
        <img src={logoUrl} alt="סטודיו בתים" style={styles.logo} />
        <div style={styles.stateBox}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7a9478"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <p style={{ ...styles.stateMsg, fontSize: '1.05rem', lineHeight: 1.7, textAlign: 'center', margin: 0 }}>
              הטופס נשלח בהצלחה. תודה
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page} dir="rtl">
      <img src={logoUrl} alt="סטודיו בתים" style={styles.logo} />

      <form onSubmit={handleSubmit} style={styles.form}>

        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>{projectName}</h2>
        </div>

        <div style={styles.divider} />

        {/* ══ Contact 1 ══ */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>פרטי יצירת קשר</h2>

          {/* שם פרטי + שם משפחה */}
          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                שם פרטי <span style={styles.asterisk}>*</span>
              </label>
              <input
                style={fieldErrors.firstName ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="text"
                value={contact1FirstName}
                onChange={e => { setContact1FirstName(e.target.value); setFieldErrors(prev => ({ ...prev, firstName: false })) }}
                placeholder="שם פרטי"
              />
              {fieldErrors.firstName && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                שם משפחה <span style={styles.asterisk}>*</span>
              </label>
              <input
                style={fieldErrors.lastName ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="text"
                value={contact1LastName}
                onChange={e => { setContact1LastName(e.target.value); setFieldErrors(prev => ({ ...prev, lastName: false })) }}
                placeholder="שם משפחה"
              />
              {fieldErrors.lastName && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
          </div>

          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                טלפון <span style={styles.asterisk}>*</span>
              </label>
              <input
                style={fieldErrors.phone ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="tel"
                value={contact1Phone}
                onChange={e => { setContact1Phone(e.target.value); setFieldErrors(prev => ({ ...prev, phone: false })) }}
                placeholder="050-0000000"
                dir="ltr"
              />
              {fieldErrors.phone && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                אימייל <span style={styles.asterisk}>*</span>
              </label>
              <input
                style={fieldErrors.email ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="email"
                value={contact1Email}
                onChange={e => { setContact1Email(e.target.value); setFieldErrors(prev => ({ ...prev, email: false })) }}
                placeholder="example@email.com"
                dir="ltr"
              />
              {fieldErrors.email && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
          </div>

          {/* ת.ז + צילום ת.ז — איש קשר 1 */}
          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                ת.ז <span style={styles.asterisk}>*</span>
              </label>
              <input
                style={fieldErrors.idNumber ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="text"
                value={contact1IdNumber}
                onChange={e => { setContact1IdNumber(e.target.value); clearError('idNumber') }}
                placeholder="מספר תעודת זהות"
                /* No dir override — inherits the form's rtl, so the value
                   and placeholder sit at the visual RIGHT like the name
                   fields. (Phone/email keep dir="ltr" because those
                   genuinely read left-to-right.) Matches ClientFile.jsx,
                   where id_number is likewise left at the default. */
              />
              {fieldErrors.idNumber && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
            <IdFileField
              file={contact1IdFile}
              uploading={uploadingId === 1}
              inputRef={idFileInput1}
              onPick={e => handleIdFileSelected(e, 1)}
              onClear={() => setContact1IdFile(null)}
              required
              error={fieldErrors.idFile}
            />
          </div>

          <div style={styles.subDivider} />

          {/* איש קשר נוסף */}
          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                שם פרטי — איש קשר נוסף {contact2AnyFilled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.c2FirstName ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="text"
                value={contact2FirstName}
                onChange={e => { setContact2FirstName(e.target.value); clearError('c2FirstName') }}
                placeholder="שם פרטי"
              />
              {fieldErrors.c2FirstName && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                שם משפחה {contact2AnyFilled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.c2LastName ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="text"
                value={contact2LastName}
                onChange={e => { setContact2LastName(e.target.value); clearError('c2LastName') }}
                placeholder="שם משפחה"
              />
              {fieldErrors.c2LastName && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
          </div>

          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                טלפון {contact2AnyFilled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.c2Phone ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="tel"
                value={contact2Phone}
                onChange={e => { setContact2Phone(e.target.value); clearError('c2Phone') }}
                placeholder="050-0000000"
                dir="ltr"
              />
              {fieldErrors.c2Phone && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                אימייל {contact2AnyFilled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.c2Email ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="email"
                value={contact2Email}
                onChange={e => { setContact2Email(e.target.value); clearError('c2Email') }}
                placeholder="example@email.com"
                dir="ltr"
              />
              {fieldErrors.c2Email && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
          </div>

          {/* ת.ז + צילום ת.ז — איש קשר 2 */}
          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                ת.ז {contact2AnyFilled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.c2IdNumber ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="text"
                value={contact2IdNumber}
                onChange={e => { setContact2IdNumber(e.target.value); clearError('c2IdNumber') }}
                placeholder="מספר תעודת זהות"
                /* See contact 1's ת.ז — inherits rtl on purpose. */
              />
              {fieldErrors.c2IdNumber && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
            <IdFileField
              file={contact2IdFile}
              uploading={uploadingId === 2}
              inputRef={idFileInput2}
              onPick={e => handleIdFileSelected(e, 2)}
              onClear={() => setContact2IdFile(null)}
              required={contact2AnyFilled}
              error={fieldErrors.c2IdFile}
            />
          </div>
        </div>

        <div style={styles.divider} />

        {/* ══ מספר מגרש ══ */}
        <div style={styles.section}>
          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                מספר מגרש <span style={styles.asterisk}>*</span>
              </label>
              <input
                style={fieldErrors.plot ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                type="text"
                value={plotNumber}
                onChange={e => { setPlotNumber(e.target.value); clearError('plot') }}
                placeholder="מספר מגרש"
              />
              {fieldErrors.plot && <span style={styles.fieldError}>שדה חובה</span>}
            </div>

            {/* דגם נבחר — second column of the SAME row as מספר מגרש.
                RTL: מגרש is the first child so it sits on the visual
                RIGHT, the dropdown to its visual LEFT. When the parent
                has no models the dropdown isn't rendered at all (it
                isn't required either); the italic note takes its column
                so the row doesn't collapse to a lone half-width field. */}
            {models.length === 0 ? (
              <div style={styles.fieldGroup}>
                <label style={styles.label}>דגם נבחר</label>
                <p style={{ ...styles.label, fontStyle: 'italic', margin: 0, alignSelf: 'center' }}>
                  אין עדיין דגמים זמינים לבחירה
                </p>
              </div>
            ) : (
              <div style={styles.fieldGroup}>
                <label style={styles.label}>
                  דגם נבחר <span style={styles.asterisk}>*</span>
                </label>
                <select
                  style={fieldErrors.model ? { ...styles.input, borderColor: '#E24B4A' } : styles.input}
                  value={selectedModelId}
                  onChange={e => { setSelectedModelId(e.target.value); clearError('model') }}
                >
                  <option value="">בחרו דגם</option>
                  {models.map(model => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
                {fieldErrors.model && <span style={styles.fieldError}>יש לבחור דגם</span>}
              </div>
            )}
          </div>
        </div>

        {errorMsg && (
          <p style={styles.errorMsg}>{errorMsg}</p>
        )}

        <button
          type="submit"
          style={submitting ? { ...styles.submitBtn, opacity: 0.65 } : styles.submitBtn}
          disabled={submitting}
        >
          {submitting ? 'שולח...' : 'שליחת הטופס'}
        </button>

      </form>
    </div>
  )
}

// ─────────────────────────────────────────
// ── Styles — mirrors InquiryForm.jsx's own style constants ──
// ─────────────────────────────────────────

const styles = {
  page: {
    height: '100%',
    overflowY: 'auto',
    background: 'var(--bg-page)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '1.5rem 1.5rem 2.5rem',
    fontFamily: 'var(--font-body)',
  },
  logo: {
    height: '64px',
    width: 'auto',
    marginBottom: '1.4rem',
  },
  stateBox: {
    maxWidth: '480px',
    width: '100%',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-lg)',
    padding: '2.5rem 2rem',
    textAlign: 'center',
  },
  stateMsg: {
    fontFamily: 'var(--font-body)',
    fontSize: '1rem',
    color: 'var(--text-primary)',
    margin: 0,
  },
  form: {
    width: '100%',
    maxWidth: '600px',
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.7rem',
    paddingBottom: '0.7rem',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-body)',
    marginBottom: '0.25rem',
    letterSpacing: '0.02em',
  },
  divider: {
    height: '1px',
    background: 'var(--border-default)',
    margin: '1rem 0',
  },
  subDivider: {
    height: '1px',
    background: 'var(--border-subtle)',
    margin: '0.35rem 0',
  },
  row2: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    flex: 1,
    minWidth: '140px',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: 400,
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-body)',
    letterSpacing: '0.02em',
  },
  asterisk: {
    color: '#E24B4A',
    marginRight: '2px',
  },
  fieldError: {
    fontSize: '0.72rem',
    color: '#E24B4A',
    fontFamily: 'var(--font-body)',
    marginTop: '2px',
  },
  input: {
    width: '100%',
    padding: '9px 12px',
    fontSize: '0.9rem',
    fontFamily: 'var(--font-body)',
    background: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--input-text)',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
    height: '36px',
  },
  /* ── צילום ת.ז slot ── */
  idFileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    height: '36px',
    padding: '0 10px',
    background: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: 'var(--radius-md)',
    boxSizing: 'border-box',
  },
  idFileName: {
    flex: 1,
    minWidth: 0,
    fontSize: '0.82rem',
    fontFamily: 'var(--font-body)',
    color: 'var(--input-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  idFileAction: {
    flexShrink: 0,
    background: 'none',
    border: 'none',
    padding: 0,
    fontSize: '0.78rem',
    fontFamily: 'var(--font-body)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  idFilePickBtn: {
    height: '36px',
    padding: '0 12px',
    fontSize: '0.85rem',
    fontFamily: 'var(--font-body)',
    background: 'var(--input-bg)',
    border: '1px dashed var(--input-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    boxSizing: 'border-box',
    textAlign: 'center',
  },
  checkboxGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    paddingTop: '2px',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    accentColor: 'var(--sage)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  modelOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
  },
  modelThumb: {
    width: '44px',
    height: '44px',
    borderRadius: '6px',
    objectFit: 'cover',
    border: '1px solid var(--border-subtle)',
    flexShrink: 0,
  },
  modelThumbPlaceholder: {
    width: '44px',
    height: '44px',
    borderRadius: '6px',
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-surface-deep)',
    flexShrink: 0,
  },
  modelOptionText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  modelOptionName: {
    fontSize: '0.9rem',
    fontWeight: 500,
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-body)',
  },
  modelOptionDesc: {
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-body)',
  },
  submitBtn: {
    marginTop: '1.4rem',
    width: '100%',
    padding: '13px',
    fontSize: '1rem',
    fontFamily: 'var(--font-body)',
    fontWeight: 400,
    background: 'var(--btn-primary-bg)',
    color: 'var(--btn-primary-text)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    letterSpacing: '0.04em',
    transition: 'background 0.15s',
  },
  errorMsg: {
    marginTop: '0.75rem',
    fontSize: '0.85rem',
    color: 'var(--badge-urgent-text)',
    fontFamily: 'var(--font-body)',
    textAlign: 'center',
  },
}
