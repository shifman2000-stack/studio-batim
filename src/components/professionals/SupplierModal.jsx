import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import '../../Professionals.css'

const EMPTY_FORM = {
  name: '', domain: '', address: '', phone: '', phone2: '',
  email: '', website: '', notes: '',
}

function rowToForm(row) {
  return {
    name:    row.name    ?? '',
    domain:  row.domain  ?? '',
    address: row.address ?? '',
    phone:   row.phone   ?? '',
    phone2:  row.phone2  ?? '',
    email:   row.email   ?? '',
    website: row.website ?? '',
    notes:   row.notes   ?? '',
  }
}

/* Trash icon — same SVG used in ProfessionalModal */
const IconTrash = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    <line x1="10" y1="11" x2="10" y2="17"/>
    <line x1="14" y1="11" x2="14" y2="17"/>
  </svg>
)

/* ────────────────────────────────────────────────────────────────
 * SupplierModal
 *
 * Mount/unmount to open/close — no `open` prop.
 * Parents: {modalOpen && <SupplierModal key={editRow?.id ?? 'new'} .../>}
 *
 * Props:
 *   editRow   object | null  — null = add new; full DB row = edit
 *   onClose   () => void
 *   onSaved   (row, isNew: boolean) => void
 *   onDeleted (id) => void
 * ──────────────────────────────────────────────────────────────── */
export default function SupplierModal({ editRow, onClose, onSaved, onDeleted }) {
  const editId = editRow?.id ?? null

  const [form, setForm]                   = useState(editRow ? rowToForm(editRow) : EMPTY_FORM)
  const [saving, setSaving]               = useState(false)
  const [saveError, setSaveError]         = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  /* ── Autocomplete: distinct domains ── */
  const [domains, setDomains]               = useState([])
  const [showDomainSugg, setShowDomainSugg] = useState(false)

  useEffect(() => {
    const fetchDomains = async () => {
      const { data } = await supabase
        .from('suppliers')
        .select('domain')
        .not('domain', 'is', null)
        .neq('domain', '')
      if (data) {
        const unique = [...new Set(data.map(r => r.domain).filter(Boolean))]
        setDomains(unique.sort((a, b) => a.localeCompare(b, 'he')))
      }
    }
    fetchDomains()
  }, [])

  const matchingDomains = (() => {
    const q = form.domain.trim().toLowerCase()
    if (!q) return domains
    return domains.filter(d => d.toLowerCase().includes(q) && d !== form.domain.trim())
  })()

  const handleClose = () => { setSaveError(''); setDeleteConfirm(false); onClose() }
  const handleField = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSave = async () => {
    if (!form.name.trim()) return
    setSaving(true); setSaveError('')
    const payload = {
      name:    form.name.trim(),
      domain:  form.domain.trim() || null,
      address: form.address.trim() || null,
      phone:   form.phone.trim() || null,
      phone2:  form.phone2.trim() || null,
      email:   form.email.trim() || null,
      website: form.website.trim() || null,
      notes:   form.notes.trim() || null,
    }
    try {
      if (editId) {
        const { data, error } = await supabase.from('suppliers').update(payload).eq('id', editId).select().single()
        if (error) throw error
        onSaved(data, false)
      } else {
        const { data, error } = await supabase.from('suppliers').insert([payload]).select().single()
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
    await supabase.from('suppliers').delete().eq('id', editId)
    onDeleted(editId); handleClose()
  }

  const modalTitle = editId ? 'עריכת ספק' : 'ספק חדש'

  return (
    <>
      <div className="prof-modal-overlay">
        <div className="prof-modal">

          {/* ── Header ── */}
          <div className="prof-modal-header">
            <span className="prof-modal-title">{modalTitle}</span>
            <button className="prof-modal-close" onClick={handleClose}>×</button>
          </div>

          {/* ── Body ── */}
          <div className="prof-modal-body">

            {/* שם */}
            <div className="prof-form-row">
              <label className="prof-form-label">שם</label>
              <input name="name" className="prof-form-input" value={form.name}
                onChange={handleField} placeholder="שם הספק" />
            </div>

            {/* תחום — autocomplete */}
            <div className="prof-form-row">
              <label className="prof-form-label">תחום</label>
              <div className="prof-autocomplete-wrap">
                <input
                  name="domain"
                  className="prof-form-input"
                  value={form.domain}
                  onChange={e => { setForm(prev => ({ ...prev, domain: e.target.value })); setShowDomainSugg(true) }}
                  onFocus={() => setShowDomainSugg(true)}
                  onBlur={() => setTimeout(() => setShowDomainSugg(false), 150)}
                  placeholder="תחום השירות"
                  autoComplete="off"
                />
                {showDomainSugg && matchingDomains.length > 0 && (
                  <div className="prof-autocomplete-suggestions">
                    {matchingDomains.map(d => (
                      <button
                        key={d}
                        type="button"
                        className="prof-autocomplete-suggestion"
                        onMouseDown={e => {
                          e.preventDefault()
                          setForm(prev => ({ ...prev, domain: d }))
                          setShowDomainSugg(false)
                        }}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* כתובת */}
            <div className="prof-form-row">
              <label className="prof-form-label">כתובת</label>
              <input name="address" className="prof-form-input" value={form.address}
                onChange={handleField} placeholder="כתובת" />
            </div>

            {/* טלפונים — 2 columns */}
            <div className="prof-form-row-2col">
              <div className="prof-form-row">
                <label className="prof-form-label">טלפון</label>
                <input type="tel" name="phone" className="prof-form-input" value={form.phone}
                  onChange={handleField} placeholder="05X-XXXXXXX" dir="ltr" />
              </div>
              <div className="prof-form-row">
                <label className="prof-form-label">טלפון נוסף</label>
                <input type="tel" name="phone2" className="prof-form-input" value={form.phone2}
                  onChange={handleField} placeholder="0X-XXXXXXX" dir="ltr" />
              </div>
            </div>

            {/* מייל */}
            <div className="prof-form-row">
              <label className="prof-form-label">מייל</label>
              <input type="email" name="email" className="prof-form-input" value={form.email}
                onChange={handleField} placeholder="example@mail.com" dir="ltr" />
            </div>

            {/* אתר */}
            <div className="prof-form-row">
              <label className="prof-form-label">אתר</label>
              <input name="website" className="prof-form-input" value={form.website}
                onChange={handleField} placeholder="https://..." dir="ltr" />
            </div>

            {/* הערות */}
            <div className="prof-form-row">
              <label className="prof-form-label">הערות</label>
              <textarea name="notes" className="prof-form-input prof-form-textarea"
                value={form.notes} onChange={handleField} placeholder="הערות נוספות..." rows={3} />
            </div>

          </div>

          {/* ── Footer ── */}
          <div className="prof-modal-footer">
            {editId ? (
              <button type="button" className="prof-modal-trash-btn"
                onClick={() => setDeleteConfirm(true)} title="מחק ספק">
                <IconTrash />
              </button>
            ) : <span />}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {saveError && <span style={{ color: '#ef4444', fontSize: '13px' }}>⚠ {saveError}</span>}
              <button className="prof-modal-cancel" onClick={handleClose}>ביטול</button>
              <button className="prof-modal-save" onClick={handleSave}
                disabled={saving || !form.name.trim()}>
                {saving ? 'שומר...' : 'שמור'}
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ── Delete Confirm ── */}
      {deleteConfirm && (
        <div className="prof-modal-overlay">
          <div className="prof-modal prof-modal--sm">
            <div className="prof-modal-header">
              <span className="prof-modal-title">מחיקת ספק</span>
              <button className="prof-modal-close" onClick={() => setDeleteConfirm(false)}>×</button>
            </div>
            <div className="prof-modal-body">
              <p className="prof-confirm-text">האם למחוק את הספק? פעולה זו אינה הפיכה.</p>
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
