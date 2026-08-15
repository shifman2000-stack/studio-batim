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

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import logoUrl from '../logo-A-stacked.svg'

export default function ChildInquiryForm() {
  const { token } = useParams()

  const [status, setStatus] = useState('loading') // loading | not_found | form | success
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [fieldErrors, setFieldErrors] = useState({ firstName: false, lastName: false, phone: false, email: false })

  const [parentProjectId, setParentProjectId] = useState('')
  const [projectName, setProjectName] = useState('')
  const [models, setModels]           = useState([]) // [{ id, name, description, image_url }]

  const [contact1FirstName, setContact1FirstName] = useState('')
  const [contact1LastName, setContact1LastName]   = useState('')
  const [contact1Phone, setContact1Phone] = useState('')
  const [contact1Email, setContact1Email] = useState('')
  const [contact2FirstName, setContact2FirstName] = useState('')
  const [contact2LastName, setContact2LastName]   = useState('')
  const [contact2Phone, setContact2Phone] = useState('')
  const [contact2Email, setContact2Email] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')

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
            description: r.model_description,
            image_url: r.model_image_url,
          }))
      )
      setStatus('form')
    }
    fetchData()
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setErrorMsg('')

    const errors = {
      firstName: !contact1FirstName.trim(),
      lastName:  !contact1LastName.trim(),
      phone:     !contact1Phone.trim(),
      email:     !contact1Email.trim(),
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
              תודה, קיבלנו את הפנייה
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

          <div style={styles.subDivider} />

          {/* איש קשר נוסף */}
          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>שם פרטי — איש קשר נוסף</label>
              <input
                style={styles.input}
                type="text"
                value={contact2FirstName}
                onChange={e => setContact2FirstName(e.target.value)}
                placeholder="שם פרטי"
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>שם משפחה</label>
              <input
                style={styles.input}
                type="text"
                value={contact2LastName}
                onChange={e => setContact2LastName(e.target.value)}
                placeholder="שם משפחה"
              />
            </div>
          </div>

          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>טלפון</label>
              <input
                style={styles.input}
                type="tel"
                value={contact2Phone}
                onChange={e => setContact2Phone(e.target.value)}
                placeholder="050-0000000"
                dir="ltr"
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>אימייל</label>
              <input
                style={styles.input}
                type="email"
                value={contact2Email}
                onChange={e => setContact2Email(e.target.value)}
                placeholder="example@email.com"
                dir="ltr"
              />
            </div>
          </div>
        </div>

        <div style={styles.divider} />

        {/* ══ Model picker ══ */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>דגם מבוקש</h2>
          {models.length === 0 ? (
            <p style={{ ...styles.label, fontStyle: 'italic' }}>אין עדיין דגמים זמינים לבחירה</p>
          ) : (
            <div style={styles.checkboxGroup}>
              {models.map(model => (
                <label key={model.id} style={styles.modelOption}>
                  <input
                    type="radio"
                    name="selectedModel"
                    style={styles.checkbox}
                    checked={selectedModelId === model.id}
                    onChange={() => setSelectedModelId(model.id)}
                  />
                  {model.image_url ? (
                    <img src={model.image_url} alt={model.name} style={styles.modelThumb} />
                  ) : (
                    <div style={styles.modelThumbPlaceholder} />
                  )}
                  <span style={styles.modelOptionText}>
                    <span style={styles.modelOptionName}>{model.name}</span>
                    {model.description && (
                      <span style={styles.modelOptionDesc}>{model.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
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
