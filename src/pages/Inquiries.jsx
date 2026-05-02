import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuoteBuilder from '../components/QuoteBuilder'
import './Inquiries.css'

/* ─────────── Status config ─────────── */
const STATUS_OPTIONS = ['טרם נשלח', 'נשלח', 'התקבל']

const STATUS_META = {
  'טרם נשלח': { color: '#E24B4A' },
  'נשלח':     { color: '#F6BF26' },
  'התקבל':    { color: '#1D9E75' },
}

function statusIcon(status, size = 18) {
  const color = STATUS_META[status]?.color ?? '#9ca3af'
  if (status === 'טרם נשלח') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    )
  }
  if (status === 'נשלח') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    )
  }
  // התקבל
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function IconTrash({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  )
}

function IconPlus({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function IconCheckCircle({ size = 18, color = '#1D9E75' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

/* ─────────── Quote status icon button ─────────── */
function QuoteIcon({ quote, onClick }) {
  const formatHebrewDate = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
  }

  // No quote yet → plus button
  if (!quote) {
    return (
      <button className="inq-status-trigger" onClick={onClick} title="צור הצעת מחיר">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#8a8680" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    )
  }

  const { status } = quote

  if (status === 'draft') {
    // Yellow clock
    return (
      <button className="inq-status-trigger" onClick={onClick} title="טיוטה — פתח עורך">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="#F6BF26" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </button>
    )
  }

  if (status === 'sent') {
    // Green document
    return (
      <button className="inq-status-trigger" onClick={onClick} title={quote.sent_at ? `נשלח בתאריך ${formatHebrewDate(quote.sent_at)}` : 'נשלח — פתח עורך'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#1D9E75" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </button>
    )
  }

  // signed → green checkmark
  return (
    <button className="inq-status-trigger" onClick={onClick} title="נחתם — פתח עורך">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke="#1D9E75" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    </button>
  )
}

function ConvertBtn({ row, onRequestConvert }) {
  const [tooltip, setTooltip] = useState(null)
  const btnRef = useRef(null)

  const handleMouseEnter = () => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setTooltip({ top: rect.top - 28, left: rect.left + rect.width / 2 })
  }

  if (!row) return null

  const tooltipText = row.converted_to_project ? 'הפך לפרויקט' : 'הפוך לפרויקט'

  if (row.converted_to_project) {
    return (
      <span
        ref={btnRef}
        className="inq-converted-icon"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltip(null)}
      >
        <IconCheckCircle size={18} color="#1D9E75" />
        {tooltip && createPortal(
          <div style={{
            position: 'fixed',
            top: tooltip.top,
            left: tooltip.left,
            transform: 'translateX(-50%)',
            background: '#374151',
            color: '#fff',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 5,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 9999,
          }}>
            {tooltipText}
          </div>,
          document.body
        )}
      </span>
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        className="inq-convert-btn"
        type="button"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setTooltip(null)}
        onClick={() => onRequestConvert(row)}
      >
        <IconPlus size={18} />
      </button>
      {tooltip && createPortal(
        <div style={{
          position: 'fixed',
          top: tooltip.top,
          left: tooltip.left,
          transform: 'translateX(-50%)',
          background: '#374151',
          color: '#fff',
          fontSize: 11,
          padding: '3px 8px',
          borderRadius: 5,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 9999,
        }}>
          {tooltipText}
        </div>,
        document.body
      )}
    </>
  )
}

/* ─────────── Convert confirm modal ─────────── */
function ConvertConfirmModal({ row, onConfirm, onCancel, converting }) {
  const name = [row.first_name, row.last_name].filter(Boolean).join(' ')
  return (
    <div className="inq-modal-overlay" onClick={onCancel}>
      <div className="inq-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="inq-modal-header">
          <span className="inq-modal-title">הפיכת פניה לפרויקט</span>
          <button className="inq-modal-close" onClick={onCancel}>×</button>
        </div>
        <div className="inq-modal-body">
          <p style={{ margin: 0, fontSize: 15, color: '#374151', lineHeight: 1.6 }}>
            האם להפוך את הפניה של <strong>{name}</strong> לפרויקט חדש?
          </p>
        </div>
        <div className="inq-modal-footer">
          <div />
          <div className="inq-modal-footer-right">
            <button className="inq-modal-cancel" onClick={onCancel} disabled={converting}>ביטול</button>
            <button className="inq-modal-save" onClick={onConfirm} disabled={converting}>
              {converting ? 'יוצר...' : 'צור פרויקט'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────── Status Popover ─────────── */
function StatusPopover({ status, onChange }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos]   = useState({ top: 0, left: 0 })
  const triggerRef      = useRef(null)

  const handleOpen = (e) => {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const rect = triggerRef.current.getBoundingClientRect()
    const popoverHeight = 130
    const below = rect.bottom + 4
    const above = rect.top - popoverHeight - 4
    const top = below + popoverHeight > window.innerHeight ? above : below
    setPos({ top, left: rect.left })
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <button ref={triggerRef} className="inq-status-trigger" onClick={handleOpen} title={status}>
        {statusIcon(status)}
      </button>
      {open && createPortal(
        <div
          className="inq-status-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          onClick={e => e.stopPropagation()}
        >
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt}
              className={'inq-status-option' + (opt === status ? ' inq-status-option--active' : '')}
              onClick={() => { onChange(opt); setOpen(false) }}
            >
              {statusIcon(opt, 16)}
              {opt}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

/* ─────────── Coupled-name detection ─────────── */
// Detects "רותם ואלמוג" → { part1: 'רותם', part2: 'אלמוג' }
// Returns null if not a coupled name.
function splitCoupledFirstName(firstName) {
  if (!firstName) return null
  const words = firstName.trim().split(/\s+/)
  // Find first word that starts with ו and has at least one more letter
  const connIdx = words.findIndex(w => w.length > 1 && w[0] === 'ו')
  if (connIdx === -1) return null          // no connector found
  const part1 = words.slice(0, connIdx).join(' ')
  if (!part1) return null                  // first_name itself starts with ו — not a coupled name
  const afterWords = [...words.slice(connIdx)]
  afterWords[0] = afterWords[0].slice(1)  // strip the ו prefix
  const part2 = afterWords.join(' ')
  if (!part2) return null
  return { part1, part2 }
}

/* ─────────── Modal ─────────── */
const todayISO = () => new Date().toISOString().slice(0, 10)

const SOURCE_OPTIONS = ['המלצה', 'אתר', 'רשתות חברתיות', 'אחר']

function InquiryModal({ row, onClose, onSaved, onDeleted, onRequestConvert }) {
  const isEdit = Boolean(row)

  const [form, setForm] = useState({
    date:                   row?.date                   ?? todayISO(),
    first_name:             row?.first_name             ?? '',
    last_name:              row?.last_name              ?? '',
    phone:                  row?.phone                  ?? '',
    email:                  row?.email                  ?? '',
    city:                   row?.city                   ?? '',
    project_description:    row?.project_description    ?? '',
    source:                 row?.source                 ?? '',
    questionnaire_status:   row?.questionnaire_status   ?? 'טרם נשלח',
    meeting_date:           row?.meeting_date           ?? '',
    proposal_status:        row?.proposal_status        ?? 'טרם נשלח',
    notes:                  row?.notes                  ?? '',
  })

  const [additionalContacts, setAdditionalContacts] = useState(
    Array.isArray(row?.additional_contacts) ? row.additional_contacts : []
  )

  // contact2 — split contact2_name into first / last on load
  const [contact2FirstName, setContact2FirstName] = useState(() => {
    const c2 = row?.contact2_name ?? ''
    const idx = c2.indexOf(' ')
    return idx > -1 ? c2.slice(0, idx) : c2
  })
  const [contact2LastName, setContact2LastName] = useState(() => {
    const c2 = row?.contact2_name ?? ''
    const idx = c2.indexOf(' ')
    return idx > -1 ? c2.slice(idx + 1) : ''
  })
  const [contact2Phone, setContact2Phone] = useState(row?.contact2_phone ?? '')
  const [contact2Email, setContact2Email] = useState(row?.contact2_email ?? '')

  const [saving, setSaving]             = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]         = useState(false)
  const [copied, setCopied]             = useState(false)

  // Pre-generate token when NEW modal opens
  const [formToken] = useState(() => isEdit ? null : crypto.randomUUID())

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }))

  const addContact    = () => setAdditionalContacts(c => [...c, { first_name: '', last_name: '', phone: '' }])
  const removeContact = (i) => setAdditionalContacts(c => c.filter((_, idx) => idx !== i))
  const setContact    = (i, field, val) => setAdditionalContacts(c =>
    c.map((item, idx) => idx === i ? { ...item, [field]: val } : item)
  )

  const handleSave = async () => {
    if (!form.first_name.trim() && !form.last_name.trim()) return
    setSaving(true)
    // Normalize empty strings to null for nullable text columns
    const payload = Object.fromEntries(
      Object.entries(form).map(([k, v]) => [k, v === '' ? null : v])
    )
    // contact2 — combine first + last into single name field
    payload.contact2_name  = [contact2FirstName.trim(), contact2LastName.trim()].filter(Boolean).join(' ') || null
    payload.contact2_phone = contact2Phone.trim() || null
    payload.contact2_email = contact2Email.trim() || null

    // Attach additional contacts (filter out fully-empty rows)
    payload.additional_contacts = additionalContacts
      .filter(c => c.first_name.trim() || c.last_name.trim() || c.phone.trim())
      .map(c => ({
        first_name: c.first_name.trim() || null,
        last_name:  c.last_name.trim()  || null,
        phone:      c.phone.trim()      || null,
      }))
    if (isEdit) {
      const { data, error } = await supabase
        .from('inquiries').update(payload).eq('id', row.id).select().single()
      setSaving(false)
      if (!error && data) onSaved(data, false)
    } else {
      payload.form_token = formToken
      payload.questionnaire_status = 'נשלח'
      const { data, error } = await supabase
        .from('inquiries').insert([payload]).select().single()
      setSaving(false)
      if (!error && data) onSaved(data, true)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    await supabase.from('inquiries').delete().eq('id', row.id)
    setDeleting(false)
    onDeleted(row.id)
  }

  return (
    <div className="inq-modal-overlay" onClick={onClose}>
      <div className="inq-modal" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="inq-modal-header">
          <span className="inq-modal-title">{isEdit ? 'עריכת פניה' : 'פניה חדשה'}</span>
          <button className="inq-modal-close" onClick={onClose}>×</button>
        </div>

        {/* Body */}
        <div className="inq-modal-body">

          {/* Date */}
          <div className="inq-form-row">
            <label className="inq-form-label">תאריך פניה</label>
            <input type="date" className="inq-form-input"
              value={form.date}
              onChange={e => set('date', e.target.value)} />
          </div>

          {/* Main contact — same 3-col layout as additional contacts, no × */}
          <div className="inq-additional-contact-row inq-main-contact-row">
            <input
              className="inq-form-input"
              placeholder="שם פרטי"
              value={form.first_name}
              onChange={e => set('first_name', e.target.value)}
            />
            <input
              className="inq-form-input"
              placeholder="שם משפחה"
              value={form.last_name}
              onChange={e => set('last_name', e.target.value)}
            />
            <input
              className="inq-form-input"
              placeholder="טלפון"
              dir="ltr"
              value={form.phone}
              onChange={e => set('phone', e.target.value)}
            />
          </div>

          <div className="inq-form-row">
            <input
              className="inq-form-input"
              placeholder="מייל"
              type="email"
              dir="ltr"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Contact 2 */}
          <div className="inq-form-row">
            <label className="inq-form-label">איש קשר נוסף</label>
            <div className="inq-additional-contact-row inq-main-contact-row">
              <input
                className="inq-form-input"
                placeholder="שם פרטי"
                value={contact2FirstName}
                onChange={e => setContact2FirstName(e.target.value)}
              />
              <input
                className="inq-form-input"
                placeholder="שם משפחה"
                value={contact2LastName}
                onChange={e => setContact2LastName(e.target.value)}
              />
              <input
                className="inq-form-input"
                placeholder="טלפון"
                dir="ltr"
                value={contact2Phone}
                onChange={e => setContact2Phone(e.target.value)}
              />
            </div>
            <input
              className="inq-form-input"
              placeholder="אימייל"
              type="email"
              dir="ltr"
              value={contact2Email}
              onChange={e => setContact2Email(e.target.value)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Additional contacts */}
          <div className="inq-form-row">
            <div className="inq-additional-contacts-header">
              <span className="inq-form-label" style={{ marginBottom: 0 }}>אנשי קשר נוספים</span>
            </div>
            {additionalContacts.map((c, i) => (
              <div key={i} className="inq-additional-contact-row">
                <input
                  className="inq-form-input"
                  placeholder="שם פרטי"
                  value={c.first_name}
                  onChange={e => setContact(i, 'first_name', e.target.value)}
                />
                <input
                  className="inq-form-input"
                  placeholder="שם משפחה"
                  value={c.last_name}
                  onChange={e => setContact(i, 'last_name', e.target.value)}
                />
                <input
                  className="inq-form-input"
                  placeholder="טלפון"
                  dir="ltr"
                  value={c.phone}
                  onChange={e => setContact(i, 'phone', e.target.value)}
                />
                <button
                  type="button"
                  className="inq-additional-contact-remove"
                  onClick={() => removeContact(i)}
                  title="הסר"
                >×</button>
              </div>
            ))}
            <button type="button" className="inq-additional-contact-add" onClick={addContact}>
              + הוסף איש קשר
            </button>
          </div>

          {/* City */}
          <div className="inq-form-row">
            <label className="inq-form-label">יישוב</label>
            <input className="inq-form-input" placeholder="עיר / יישוב"
              value={form.city}
              onChange={e => set('city', e.target.value)} />
          </div>

          {/* Project description */}
          <div className="inq-form-row">
            <label className="inq-form-label">מהות הפרויקט</label>
            <textarea className="inq-form-input inq-form-textarea"
              placeholder="תיאור קצר של הפרויקט..."
              value={form.project_description}
              onChange={e => set('project_description', e.target.value)} />
          </div>

          {/* Source */}
          <div className="inq-form-row">
            <label className="inq-form-label">מקור הפניה</label>
            <select className="inq-form-select"
              value={form.source}
              onChange={e => set('source', e.target.value)}>
              <option value="">-- בחר --</option>
              {SOURCE_OPTIONS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* WhatsApp button (placeholder) — hidden until implemented */}
          {/* <div>
            <button className="inq-whatsapp-btn" disabled type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#25D366">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.936.526 3.745 1.438 5.291L2 22l4.842-1.417A9.956 9.956 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.958 7.958 0 0 1-4.28-1.244l-.307-.182-3.18.93.972-3.093-.2-.317A7.958 7.958 0 0 1 4 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z"/>
              </svg>
              שלח וואטסאפ
              <span className="inq-whatsapp-dev">בפיתוח</span>
            </button>
          </div> */}

          {/* ── Edit-only: טופס פניה status (read-only) ── */}
          {isEdit && (
            <>
              {/* טופס פניה — read-only display */}
              <div className="inq-form-row">
                <label className="inq-form-label">טופס פניה</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 2 }}>
                  {form.questionnaire_status === 'התקבל' && row?.form_token ? (
                    <a
                      href={`${import.meta.env.VITE_APP_URL}/inquiry-form/${row.form_token}?preview=true`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center' }}
                      title="פתח טופס"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7a9478"
                        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <polyline points="10 9 9 9 8 9"/>
                      </svg>
                    </a>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      {statusIcon(form.questionnaire_status ?? 'טרם נשלח', 18)}
                    </span>
                  )}
                  {form.questionnaire_status === 'התקבל' && row?.form_submitted_at && (() => {
                    const d = new Date(row.form_submitted_at)
                    const fmt = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`
                    return (
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}>
                        {fmt}
                      </span>
                    )
                  })()}
                </div>
              </div>
            </>
          )}

          {/* ── הערות פנימיות (always visible) ── */}
          <div className="inq-form-row">
            <label className="inq-form-label">הערות פנימיות</label>
            <textarea className="inq-form-input inq-form-textarea"
              placeholder="הערות פנימיות..."
              value={form.notes}
              onChange={e => set('notes', e.target.value)} />
          </div>

          {/* ── קישור לטופס — new inquiry uses generated formToken; edit uses row.form_token ── */}
          {(() => {
            const displayToken = isEdit ? row?.form_token : formToken
            return displayToken ? (
              <div className="inq-form-row">
                <div className="inq-modal-section-title">קישור לטופס הלקוח</div>
                <div className="inq-form-link-row">
                  <input
                    className="inq-form-input inq-form-link-input"
                    type="text"
                    readOnly
                    value={`${import.meta.env.VITE_APP_URL}/inquiry-form/${displayToken}`}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    className="inq-form-copy-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(`${import.meta.env.VITE_APP_URL}/inquiry-form/${displayToken}`)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    }}
                  >
                    {copied ? '✓ הועתק' : 'העתק'}
                  </button>
                </div>
              </div>
            ) : null
          })()}

        </div>

        {/* Footer */}
        <div className="inq-modal-footer">
          {/* Left: convert + trash (edit only) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isEdit && !confirmDelete && !row?.converted_to_project && onRequestConvert && (
              <button
                className="inq-modal-convert-btn"
                type="button"
                onClick={() => onRequestConvert(row)}
              >
                <IconPlus size={14} />
                הפוך לפרויקט
              </button>
            )}
            {isEdit && !confirmDelete && (
              <button className="inq-modal-trash-btn" onClick={() => setConfirmDelete(true)} title="מחק פניה">
                <IconTrash size={18} />
              </button>
            )}
            {isEdit && confirmDelete && (
              <div className="inq-modal-delete-confirm">
                <span className="inq-modal-delete-confirm-text">למחוק?</span>
                <button className="inq-modal-delete-yes" onClick={handleDelete} disabled={deleting}>
                  {deleting ? '...' : 'מחק'}
                </button>
                <button className="inq-modal-delete-no" onClick={() => setConfirmDelete(false)}>ביטול</button>
              </div>
            )}
          </div>

          {/* Right: save + cancel */}
          <div className="inq-modal-footer-right">
            <button className="inq-modal-cancel" onClick={onClose}>ביטול</button>
            <button
              className="inq-modal-save"
              onClick={handleSave}
              disabled={saving || (!form.first_name.trim() && !form.last_name.trim())}
            >
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

/* ─────────── Main page ─────────── */
export default function Inquiries() {
  const navigate = useNavigate()
  const [checking, setChecking]         = useState(true)
  const [currentUserId, setCurrentUserId] = useState(null)
  const [rows, setRows]                 = useState([])
  const [loading, setLoading]           = useState(true)
  const [modalRow, setModalRow]         = useState(undefined) // undefined = closed, null = new, obj = edit
  const [confirmId, setConfirmId]       = useState(null)      // row id pending inline delete
  const [convertModalRow, setConvertModalRow] = useState(null) // row pending conversion
  const [converting, setConverting]     = useState(false)
  const [quotes, setQuotes]             = useState({})        // { [inquiry_id]: quote_object }
  const [quoteBuilderRow, setQuoteBuilderRow] = useState(null)

  /* ── Admin guard ── */
  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role, first_name, last_name').eq('id', session.user.id).single()
      if (profile?.role !== 'admin') { navigate('/dashboard'); return }
      setCurrentUserId(session.user.id)
      setChecking(false)
    }
    check()
  }, [navigate])

  /* ── Fetch ── */
  useEffect(() => {
    if (!checking) fetchAll()
  }, [checking])

  const fetchAll = async () => {
    setLoading(true)
    const [{ data: inquiriesData }, { data: quotesData }, { data: versionsData }] = await Promise.all([
      supabase.from('inquiries').select('*').order('created_at', { ascending: false }),
      supabase.from('quotes').select('id, inquiry_id, status, updated_at'),
      supabase.from('quote_versions')
        .select('quote_id, sent_at, version_number')
        .not('form_token', 'is', null)
        .order('version_number', { ascending: false }),
    ])
    if (inquiriesData) setRows(inquiriesData)
    if (quotesData) {
      const qMap = {}
      quotesData.forEach(q => { qMap[q.inquiry_id] = q })

      // Attach the latest sent_at (versions already sorted desc by version_number,
      // so first occurrence per quote_id is the most recent)
      if (versionsData) {
        const seen = new Set()
        versionsData.forEach(v => {
          if (seen.has(v.quote_id)) return
          seen.add(v.quote_id)
          const inquiryId = Object.keys(qMap).find(iid => qMap[iid].id === v.quote_id)
          if (inquiryId) {
            qMap[inquiryId] = { ...qMap[inquiryId], sent_at: v.sent_at }
          }
        })
      }

      setQuotes(qMap)
    }
    setLoading(false)
  }

  /* ── Quote updated callback ── */
  const handleQuoteUpdated = (inquiryId, update) => {
    setQuotes(prev => ({
      ...prev,
      [inquiryId]: { ...(prev[inquiryId] ?? {}), ...update },
    }))
  }

  /* ── Inline patch (status / meeting_date) ── */
  const patchRow = async (id, patch) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    await supabase.from('inquiries').update(patch).eq('id', id)
  }

  /* ── Modal callbacks ── */
  const handleSaved = (row, isNew) => {
    if (isNew) fetchAll()
    else       setRows(prev => prev.map(r => r.id === row.id ? row : r))
    setModalRow(undefined)
  }

  const handleDeleted = (id) => {
    setRows(prev => prev.filter(r => r.id !== id))
    setModalRow(undefined)
  }

  /* ── Inline row delete ── */
  const handleRowDelete = async (id) => {
    await supabase.from('inquiries').delete().eq('id', id)
    setRows(prev => prev.filter(r => r.id !== id))
    setConfirmId(null)
  }

  /* ── Convert inquiry → project ── */
  const handleConvert = async () => {
    const inq = convertModalRow
    setConverting(true)

    // a. Create project
    const projectName = [inq.first_name, inq.last_name].filter(Boolean).join(' ').trim()
    const { data: newProject, error: projErr } = await supabase
      .from('projects')
      .insert([{
        name:          projectName,
        current_stage: 'קליטת פרויקט',
        responsible_id: currentUserId || null,
        urgency:       null,
        intake_date:   todayISO(),
        archived:      false,
      }])
      .select('id')
      .single()

    if (projErr || !newProject) {
      setConverting(false)
      return
    }

    // b. Create project contacts (main + additional)
    // Check if first_name is a coupled name (e.g. "רותם ואלמוג")
    const coupled = splitCoupledFirstName(inq.first_name ?? '')
    const mainContacts = coupled
      ? [
          // Contact 1: first part + last_name + phone
          {
            project_id: newProject.id,
            first_name: coupled.part1,
            last_name:  inq.last_name ?? null,
            phone:      inq.phone     ?? null,
            email:      null,
          },
          // Contact 2: second part + last_name, no phone
          {
            project_id: newProject.id,
            first_name: coupled.part2,
            last_name:  inq.last_name ?? null,
            phone:      null,
            email:      null,
          },
        ]
      : [
          {
            project_id: newProject.id,
            first_name: inq.first_name ?? null,
            last_name:  inq.last_name  ?? null,
            phone:      inq.phone      ?? null,
            email:      null,
          },
        ]

    const contactRows = [
      ...mainContacts,
      ...((Array.isArray(inq.additional_contacts) ? inq.additional_contacts : [])
        .filter(c => c.first_name || c.last_name || c.phone)
        .map(c => ({
          project_id: newProject.id,
          first_name: c.first_name ?? null,
          last_name:  c.last_name  ?? null,
          phone:      c.phone      ?? null,
          email:      null,
        }))
      ),
    ]
    await supabase.from('project_contacts').insert(contactRows)

    // c. Create client info
    await supabase.from('client_info').insert([{
      project_id: newProject.id,
      city:       inq.city ?? null,
    }])

    // d. Mark inquiry as converted
    await supabase.from('inquiries').update({ converted_to_project: true }).eq('id', inq.id)

    // e. Update local state and navigate
    setRows(prev => prev.map(r => r.id === inq.id ? { ...r, converted_to_project: true } : r))
    setConverting(false)
    setConvertModalRow(null)
    setModalRow(undefined)
    navigate('/פרויקטים')
  }

  const fullName = (row) =>
    [row.first_name, row.last_name].filter(Boolean).join(' ') || '—'

  const formatDate = (iso) => {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y}`
  }

  if (checking) return null

  return (
    <div className="inq-page">

      {/* ── Page header ── */}
      <div className="inq-header-row">
        <h1 className="inq-title">פניות</h1>
        <button className="inq-add-btn" onClick={() => setModalRow(null)} title="הוסף פניה חדשה">
          +
        </button>
      </div>

      {/* ── Table card ── */}
      <div className="inq-card">
        {loading ? (
          <p className="inq-loading">טוען...</p>
        ) : rows.length === 0 ? (
          <p className="inq-empty">אין פניות עדיין. לחץ "+" להוספה.</p>
        ) : (
          <table className="inq-table">
            <thead>
              <tr>
                <th className="inq-col-name">שם</th>
                <th className="inq-col-phone">טלפון</th>
                <th className="inq-col-date">תאריך פניה</th>
                <th className="inq-col-action">טופס פניה</th>
                <th className="inq-col-action">פגישת היכרות</th>
                <th className="inq-col-action">הצעת מחיר</th>
                <th className="inq-col-convert">הפוך לפרויקט</th>
                <th className="inq-col-delete">×</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={row.id}
                  className="inq-row"
                  onClick={() => setModalRow(row)}
                >
                  {/* שם */}
                  <td className="inq-col-name">{fullName(row)}</td>

                  {/* טלפון */}
                  <td className="inq-col-phone" dir="ltr">{row.phone || '—'}</td>

                  {/* תאריך פניה */}
                  <td className="inq-col-date">{formatDate(row.date)}</td>

                  {/* טופס פניה — read-only; document icon + link when התקבל */}
                  <td className="inq-col-action" onClick={e => e.stopPropagation()}>
                    {(row.questionnaire_status ?? 'טרם נשלח') === 'התקבל' && row.form_token ? (
                      <a
                        href={`${import.meta.env.VITE_APP_URL}/inquiry-form/${row.form_token}?preview=true`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        title="פתח טופס הלקוח"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7a9478"
                          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                          <polyline points="10 9 9 9 8 9"/>
                        </svg>
                      </a>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2px' }}>
                        {statusIcon(row.questionnaire_status ?? 'טרם נשלח')}
                      </span>
                    )}
                  </td>

                  {/* פגישת היכרות */}
                  <td className="inq-col-action" onClick={e => e.stopPropagation()}>
                    <input
                      type="date"
                      className="inq-date-input"
                      value={row.meeting_date ?? ''}
                      onChange={e => patchRow(row.id, { meeting_date: e.target.value || null })}
                    />
                  </td>

                  {/* הצעת מחיר */}
                  <td className="inq-col-action" onClick={e => e.stopPropagation()}>
                    <QuoteIcon
                      quote={quotes[row.id] ?? null}
                      onClick={() => setQuoteBuilderRow(row)}
                    />
                  </td>

                  {/* הפוך לפרויקט */}
                  <td className="inq-col-convert" onClick={e => e.stopPropagation()}>
                    <ConvertBtn
                      row={row}
                      onRequestConvert={r => setConvertModalRow(r)}
                    />
                  </td>

                  {/* מחק */}
                  <td className="inq-col-delete" onClick={e => e.stopPropagation()}>
                    {confirmId === row.id ? (
                      <div className="inq-delete-confirm">
                        <span className="inq-delete-confirm-text">מחק?</span>
                        <button className="inq-delete-confirm-yes"
                          onClick={() => handleRowDelete(row.id)}>כן</button>
                        <button className="inq-delete-confirm-no"
                          onClick={() => setConfirmId(null)}>לא</button>
                      </div>
                    ) : (
                      <button
                        className="inq-delete-btn"
                        onClick={() => setConfirmId(row.id)}
                        title="מחק"
                      >
                        <IconTrash size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Edit / Add modal ── */}
      {modalRow !== undefined && (
        <InquiryModal
          key={modalRow?.id ?? 'new'}
          row={modalRow}
          onClose={() => setModalRow(undefined)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onRequestConvert={r => setConvertModalRow(r)}
        />
      )}

      {/* ── Convert confirm modal ── */}
      {convertModalRow && (
        <ConvertConfirmModal
          row={convertModalRow}
          onConfirm={handleConvert}
          onCancel={() => setConvertModalRow(null)}
          converting={converting}
        />
      )}

      {/* ── Quote Builder (full-screen) ── */}
      {quoteBuilderRow && (
        <QuoteBuilder
          inquiry={quoteBuilderRow}
          onClose={() => setQuoteBuilderRow(null)}
          onQuoteUpdated={handleQuoteUpdated}
        />
      )}
    </div>
  )
}
