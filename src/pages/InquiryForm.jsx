import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import logoUrl from '../logo-A-stacked.svg'

// ── Project type options ──
const PROJECT_TYPE_OPTIONS = [
  'בית פרטי חדש',
  'תוספת לבית קיים',
  'שינויים בבית קיים/מודל קבלני ללא תוספת בניה',
  'תכנון בית ללא טיפול בהיתר',
  'אחר',
]

// ── Inclusions options ──
const INCLUSION_OPTIONS = [
  'מרתף',
  'קומת קרקע',
  'קומה א',
  'ממ"ד',
  'מחסן',
  'יחידת דיור נפרדת',
  'חניה מקורה',
  'בריכה',
  'אחר',
]

export default function InquiryForm() {
  const { token } = useParams()
  const [searchParams] = useSearchParams()
  const isPreview = searchParams.get('preview') === 'true'

  const [status, setStatus] = useState('loading') // loading | not_found | already_submitted | form | preview | success
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [fieldErrors, setFieldErrors] = useState({ firstName: false, lastName: false, phone: false, email: false })

  // ── Section 1 fields ──
  const [firstName, setFirstName]               = useState('')
  const [lastName, setLastName]                 = useState('')
  const [phone, setPhone]                       = useState('')
  const [email, setEmail]                       = useState('')
  const [contact2FirstName, setContact2FirstName] = useState('')
  const [contact2LastName, setContact2LastName]   = useState('')
  const [contact2Phone, setContact2Phone]         = useState('')
  const [contact2Email, setContact2Email]         = useState('')

  // ── Section 2 fields ──
  const [projectTypes, setProjectTypes]       = useState([])
  const [projectTypeOther, setProjectTypeOther] = useState('')
  const [city, setCity]                       = useState('')
  const [plotSize, setPlotSize]               = useState('')
  const [houseSize, setHouseSize]             = useState('')
  const [floors, setFloors]                   = useState('')
  const [inclusions, setInclusions]           = useState([])
  const [inclusionOther, setInclusionOther]   = useState('')
  const [extraNotes, setExtraNotes]           = useState('')

  // ── Raw fetched data (preview mode) — contact2 fields are set via useEffect ──
  const [rawData, setRawData] = useState(null)

  // ── Fetch inquiry on mount ──
  useEffect(() => {
    async function fetchInquiry() {
      // Preview mode: check auth — use authenticated client
      if (isPreview) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          const { data, error } = await supabase
            .from('inquiries')
            .select('id, form_submitted_at, first_name, last_name, phone, email, contact2_name, contact2_phone, contact2_email, project_type, city, plot_size, house_size, floors, inclusions, extra_notes')
            .eq('form_token', token)
            .single()

          if (error || !data) { setStatus('not_found'); return }

          // Populate scalar fields
          setFirstName(data.first_name ?? '')
          setLastName(data.last_name ?? '')
          setPhone(data.phone ?? '')
          setEmail(data.email ?? '')

          // contact2 fields are set via useEffect(rawData) below
          setRawData(data)

          // project_type — Supabase may return jsonb as a string; parse if needed
          const ptArray = typeof data.project_type === 'string'
            ? JSON.parse(data.project_type)
            : (data.project_type ?? [])

          // checkedTypes: values that exactly match a predefined option
          // otherValue: any value NOT in predefined options (stored as "אחר: text" or similar)
          if (Array.isArray(ptArray) && ptArray.length > 0) {
            const checkedTypes = ptArray.filter(t => PROJECT_TYPE_OPTIONS.includes(t))
            const otherValue   = ptArray.find(t => !PROJECT_TYPE_OPTIONS.includes(t))
            if (otherValue !== undefined) {
              if (!checkedTypes.includes('אחר')) checkedTypes.push('אחר')
              setProjectTypeOther(otherValue.startsWith('אחר: ') ? otherValue.slice(5) : otherValue)
            } else {
              setProjectTypeOther('')
            }
            setProjectTypes(checkedTypes)
          }

          setCity(data.city ?? '')
          setPlotSize(data.plot_size ?? '')
          setHouseSize(data.house_size ?? '')
          setFloors(data.floors ?? '')

          // inclusions — same string-or-array handling
          const incArray = typeof data.inclusions === 'string'
            ? JSON.parse(data.inclusions)
            : (data.inclusions ?? [])

          if (Array.isArray(incArray) && incArray.length > 0) {
            const checkedInclusions = incArray.filter(i => INCLUSION_OPTIONS.includes(i))
            const otherValue        = incArray.find(i => !INCLUSION_OPTIONS.includes(i))
            if (otherValue !== undefined) {
              if (!checkedInclusions.includes('אחר')) checkedInclusions.push('אחר')
              setInclusionOther(otherValue.startsWith('אחר: ') ? otherValue.slice(5) : otherValue)
            } else {
              setInclusionOther('')
            }
            setInclusions(checkedInclusions)
          }

          setExtraNotes(data.extra_notes ?? '')
          setStatus('preview')
          return
        }
        // Not authenticated — fall through to normal logic
      }

      // Normal (public) flow — uses RPC so anon role needs no direct table access
      const { data, error } = await supabase.rpc('get_inquiry_status_by_token', { p_token: token })
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null

      if (error || !row) { setStatus('not_found'); return }
      if (row.form_submitted_at) { setStatus('already_submitted'); return }
      setStatus('form')
    }
    fetchInquiry()
  }, [token, isPreview])

  // ── Populate contact2 fields after rawData is set (runs after render) ──
  useEffect(() => {
    if (!rawData) return
    const c2 = rawData.contact2_name ?? ''
    const spaceIdx = c2.indexOf(' ')
    if (spaceIdx > -1) {
      setContact2FirstName(c2.slice(0, spaceIdx))
      setContact2LastName(c2.slice(spaceIdx + 1))
    } else {
      setContact2FirstName(c2)
      setContact2LastName('')
    }
    setContact2Phone(rawData.contact2_phone ?? '')
    setContact2Email(rawData.contact2_email ?? '')
  }, [rawData])

  // ── Toggle helpers ──
  function toggleProjectType(option) {
    setProjectTypes(prev =>
      prev.includes(option) ? prev.filter(o => o !== option) : [...prev, option]
    )
  }

  function toggleInclusion(option) {
    setInclusions(prev =>
      prev.includes(option) ? prev.filter(o => o !== option) : [...prev, option]
    )
  }

  // ── Submit ──
  async function handleSubmit(e) {
    e.preventDefault()
    setErrorMsg('')

    // Validate required fields
    const errors = {
      firstName: !firstName.trim(),
      lastName:  !lastName.trim(),
      phone:     !phone.trim(),
      email:     !email.trim(),
    }
    setFieldErrors(errors)
    if (Object.values(errors).some(Boolean)) return

    setSubmitting(true)

    const finalProjectTypes = projectTypes.map(t =>
      t === 'אחר' && projectTypeOther.trim() ? `אחר: ${projectTypeOther.trim()}` : t
    )

    const finalInclusions = inclusions.map(i =>
      i === 'אחר' && inclusionOther.trim() ? `אחר: ${inclusionOther.trim()}` : i
    )

    const contact2FullName = [contact2FirstName.trim(), contact2LastName.trim()]
      .filter(Boolean).join(' ') || null

    // Uses RPC so anon role needs no direct UPDATE access on inquiries.
    // The function sets form_submitted_at and questionnaire_status internally.
    const { error } = await supabase.rpc('submit_inquiry_by_token', {
      p_token:          token,
      p_first_name:     firstName.trim()      || null,
      p_last_name:      lastName.trim()       || null,
      p_phone:          phone.trim()          || null,
      p_email:          email.trim()          || null,
      p_contact2_name:  contact2FullName,
      p_contact2_phone: contact2Phone.trim()  || null,
      p_contact2_email: contact2Email.trim()  || null,
      p_project_type:   finalProjectTypes.length ? finalProjectTypes : null,
      p_city:           city.trim()           || null,
      p_plot_size:      plotSize.trim()       || null,
      p_house_size:     houseSize.trim()      || null,
      p_floors:         floors.trim()         || null,
      p_inclusions:     finalInclusions.length ? finalInclusions : null,
      p_extra_notes:    extraNotes.trim()     || null,
    })

    setSubmitting(false)

    if (error) {
      setErrorMsg('אירעה שגיאה בשליחת הטופס. אנא נסי שוב.')
      return
    }

    setStatus('success')
  }

  // ─────────────────────────────────────────
  // ── Render states ──
  // ─────────────────────────────────────────

  if (status === 'loading') {
    return <div style={styles.page}><p style={styles.stateMsg}>טוען...</p></div>
  }

  if (status === 'not_found') {
    return (
      <div style={styles.page}>
        <img src={logoUrl} alt="סטודיו בתים" style={styles.logo} />
        <div style={styles.stateBox}>
          <p style={styles.stateMsg}>הטופס אינו זמין.</p>
        </div>
      </div>
    )
  }

  if (status === 'already_submitted') {
    return (
      <div style={styles.page}>
        <img src={logoUrl} alt="סטודיו בתים" style={styles.logo} />
        <div style={styles.stateBox}>
          <p style={styles.stateMsg}>הטופס כבר נשלח, תודה! 🏠</p>
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
              תודה על שיתוף הפעולה, ונאחל לנו דרך צלחה הביתה
            </p>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontFamily: 'var(--font-body)' }}>
              עינב
            </span>
          </div>
        </div>
      </div>
    )
  }

  // ── preview or form ──
  const isReadOnly = status === 'preview'
  const disabled = isReadOnly

  // Helper: input style
  const inputStyle = disabled ? { ...styles.input, ...styles.inputDisabled } : styles.input

  return (
    <div style={styles.page} dir="rtl">
      <img src={logoUrl} alt="סטודיו בתים" style={styles.logo} />

      {/* Admin preview banner — simple text line */}
      {isReadOnly && (
        <p style={styles.previewBanner}>
          תצוגת מנהל — טופס פניה כפי שמולא על ידי הלקוח
        </p>
      )}

      <form onSubmit={isReadOnly ? e => e.preventDefault() : handleSubmit} style={styles.form}>

        {/* ══ SECTION 1 ══ */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>פרטי יצירת קשר</h2>

          {/* שם פרטי + שם משפחה */}
          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                שם פרטי {!disabled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.firstName ? { ...inputStyle, borderColor: '#E24B4A' } : inputStyle}
                type="text"
                value={firstName}
                onChange={e => { setFirstName(e.target.value); setFieldErrors(prev => ({ ...prev, firstName: false })) }}
                placeholder="שם פרטי"
                disabled={disabled}
              />
              {!disabled && fieldErrors.firstName && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                שם משפחה {!disabled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.lastName ? { ...inputStyle, borderColor: '#E24B4A' } : inputStyle}
                type="text"
                value={lastName}
                onChange={e => { setLastName(e.target.value); setFieldErrors(prev => ({ ...prev, lastName: false })) }}
                placeholder="שם משפחה"
                disabled={disabled}
              />
              {!disabled && fieldErrors.lastName && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
          </div>

          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                טלפון {!disabled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.phone ? { ...inputStyle, borderColor: '#E24B4A' } : inputStyle}
                type="tel"
                value={phone}
                onChange={e => { setPhone(e.target.value); setFieldErrors(prev => ({ ...prev, phone: false })) }}
                placeholder="050-0000000"
                dir="ltr"
                disabled={disabled}
              />
              {!disabled && fieldErrors.phone && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>
                אימייל {!disabled && <span style={styles.asterisk}>*</span>}
              </label>
              <input
                style={fieldErrors.email ? { ...inputStyle, borderColor: '#E24B4A' } : inputStyle}
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setFieldErrors(prev => ({ ...prev, email: false })) }}
                placeholder="example@email.com"
                dir="ltr"
                disabled={disabled}
              />
              {!disabled && fieldErrors.email && <span style={styles.fieldError}>שדה חובה</span>}
            </div>
          </div>

          <div style={styles.subDivider} />

          {/* איש קשר נוסף */}
          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>שם פרטי — איש קשר נוסף</label>
              <input
                style={inputStyle}
                type="text"
                value={contact2FirstName}
                onChange={e => setContact2FirstName(e.target.value)}
                placeholder="שם פרטי"
                disabled={disabled}
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>שם משפחה</label>
              <input
                style={inputStyle}
                type="text"
                value={contact2LastName}
                onChange={e => setContact2LastName(e.target.value)}
                placeholder="שם משפחה"
                disabled={disabled}
              />
            </div>
          </div>

          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>טלפון</label>
              <input
                style={inputStyle}
                type="tel"
                value={contact2Phone}
                onChange={e => setContact2Phone(e.target.value)}
                placeholder="050-0000000"
                dir="ltr"
                disabled={disabled}
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>אימייל</label>
              <input
                style={inputStyle}
                type="email"
                value={contact2Email}
                onChange={e => setContact2Email(e.target.value)}
                placeholder="example@email.com"
                dir="ltr"
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        <div style={styles.divider} />

        {/* ══ SECTION 2 ══ */}
        <div style={styles.section}>
          <h2 style={styles.sectionTitle}>פרטי הפרויקט</h2>

          {/* Project type */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>סוג הפרויקט</label>
            <div style={styles.checkboxGroup}>
              {PROJECT_TYPE_OPTIONS.map(opt => (
                <label key={opt} style={{ ...styles.checkboxLabel, ...(disabled ? styles.checkboxLabelDisabled : {}) }}>
                  <input
                    type="checkbox"
                    style={styles.checkbox}
                    checked={projectTypes.includes(opt)}
                    onChange={() => !disabled && toggleProjectType(opt)}
                    disabled={disabled}
                  />
                  <span>{opt}</span>
                </label>
              ))}
              {projectTypes.includes('אחר') && (
                <input
                  style={{ ...(disabled ? { ...styles.input, ...styles.inputDisabled } : styles.input), marginTop: '6px', width: '100%' }}
                  type="text"
                  value={projectTypeOther}
                  onChange={e => setProjectTypeOther(e.target.value)}
                  placeholder="פרטי..."
                  disabled={disabled}
                />
              )}
            </div>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>מיקום הפרויקט (עיר/ישוב)</label>
            <input
              style={inputStyle}
              type="text"
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="עיר"
              disabled={disabled}
            />
          </div>

          <div style={styles.row2}>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>גודל מגרש (מ"ר)</label>
              <input
                style={inputStyle}
                type="text"
                value={plotSize}
                onChange={e => setPlotSize(e.target.value)}
                placeholder='מ"ר'
                dir="ltr"
                disabled={disabled}
              />
            </div>
            <div style={styles.fieldGroup}>
              <label style={styles.label}>גודל בית (מ"ר)</label>
              <input
                style={inputStyle}
                type="text"
                value={houseSize}
                onChange={e => setHouseSize(e.target.value)}
                placeholder='מ"ר'
                dir="ltr"
                disabled={disabled}
              />
            </div>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>מספר קומות</label>
            <input
              style={{ ...inputStyle, maxWidth: '160px' }}
              type="text"
              value={floors}
              onChange={e => setFloors(e.target.value)}
              placeholder="לדוגמה: 2"
              dir="ltr"
              disabled={disabled}
            />
          </div>

          {/* Inclusions */}
          <div style={styles.fieldGroup}>
            <label style={styles.label}>מה כולל הבית?</label>
            <div style={styles.checkboxGroup}>
              {INCLUSION_OPTIONS.map(opt => (
                <label key={opt} style={{ ...styles.checkboxLabel, ...(disabled ? styles.checkboxLabelDisabled : {}) }}>
                  <input
                    type="checkbox"
                    style={styles.checkbox}
                    checked={inclusions.includes(opt)}
                    onChange={() => !disabled && toggleInclusion(opt)}
                    disabled={disabled}
                  />
                  <span>{opt}</span>
                </label>
              ))}
              {inclusions.includes('אחר') && (
                <input
                  style={{ ...(disabled ? { ...styles.input, ...styles.inputDisabled } : styles.input), marginTop: '6px', width: '100%' }}
                  type="text"
                  value={inclusionOther}
                  onChange={e => setInclusionOther(e.target.value)}
                  placeholder="פרטי..."
                  disabled={disabled}
                />
              )}
            </div>
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.label}>דגשים ונתונים נוספים</label>
            <textarea
              style={{ ...(disabled ? { ...styles.textarea, ...styles.inputDisabled } : styles.textarea), width: '100%' }}
              value={extraNotes}
              onChange={e => setExtraNotes(e.target.value)}
              placeholder="כל פרט נוסף שחשוב לך לציין..."
              rows={4}
              disabled={disabled}
            />
          </div>
        </div>

        {!isReadOnly && errorMsg && (
          <p style={styles.errorMsg}>{errorMsg}</p>
        )}

        {!isReadOnly && (
          <button
            type="submit"
            style={submitting ? { ...styles.submitBtn, opacity: 0.65 } : styles.submitBtn}
            disabled={submitting}
          >
            {submitting ? 'שולח...' : 'שליחת הטופס'}
          </button>
        )}

      </form>
    </div>
  )
}

// ─────────────────────────────────────────
// ── Styles ──
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
  previewBanner: {
    width: '100%',
    maxWidth: '600px',
    color: '#8a3020',
    fontSize: '13px',
    textAlign: 'right',
    marginBottom: '1rem',
    fontFamily: 'var(--font-body)',
    fontWeight: 300,
    margin: '0 0 1rem 0',
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
  inputDisabled: {
    background: 'var(--bg-surface-deep)',
    color: 'var(--text-secondary)',
    cursor: 'default',
    borderColor: 'var(--border-subtle)',
  },
  textarea: {
    width: '100%',
    padding: '9px 12px',
    fontSize: '0.9rem',
    fontFamily: 'var(--font-body)',
    background: 'var(--input-bg)',
    border: '1px solid var(--input-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--input-text)',
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box',
    lineHeight: 1.6,
  },
  checkboxGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    paddingTop: '2px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.9rem',
    fontFamily: 'var(--font-body)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
  },
  checkboxLabelDisabled: {
    cursor: 'default',
    color: 'var(--text-secondary)',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    accentColor: 'var(--sage)',
    cursor: 'pointer',
    flexShrink: 0,
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
