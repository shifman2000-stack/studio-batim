import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import ProfessionalModal from './components/professionals/ProfessionalModal'
import './Professionals.css'

export default function Professionals() {
  const [activeTab, setActiveTab] = useState(1)
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editRow, setEditRow]     = useState(null) // null = add new

  /* ── Fetch ── */
  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('professionals')
      .select('*')
      .order('profession')
      .order('last_name')
    if (data) setRows(data)
    setLoading(false)
  }

  const openNew  = ()    => { setEditRow(null); setModalOpen(true) }
  const openEdit = (row) => { setEditRow(row);  setModalOpen(true) }
  const closeModal = ()  => { setModalOpen(false); setEditRow(null) }

  const handleSaved = (row, isNew) => {
    if (isNew) setRows(prev => [...prev, row])
    else       setRows(prev => prev.map(r => r.id === row.id ? row : r))
    closeModal()
  }

  const handleDeleted = (id) => {
    setRows(prev => prev.filter(r => r.id !== id))
    closeModal()
  }

  const handleRowPatched = (id, patch) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  /* ── Table display helpers ── */
  const displayPhone = (row, idx) => {
    const phones = Array.isArray(row.phones) && row.phones.length > 0
      ? row.phones
      : (row.phone ? [row.phone] : [])
    return phones[idx] || '—'
  }
  const displayEmail = (row) => {
    const emails = Array.isArray(row.emails) && row.emails.length > 0
      ? row.emails
      : (row.email ? [row.email] : [])
    return emails[0] || '—'
  }

  return (
    <div className="prof-page" dir="rtl">

      {/* ── Header ── */}
      <div className="prof-header-row">
        <h1 className="prof-title">בעלי מקצוע וספקים</h1>
      </div>

      {/* ── Tabs bar ── */}
      <div className="prof-tabs-bar">
        {[
          { id: 1, label: 'בעלי מקצוע' },
          { id: 2, label: 'ספקים' },
          { id: 3, label: 'רשויות' },
        ].map(tab => (
          <button
            key={tab.id}
            className={'prof-tab' + (activeTab === tab.id ? ' prof-tab--active' : '')}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab actions bar (below tabs) ── */}
      {activeTab === 1 && (
        <div className="prof-tab-actions">
          <button className="prof-add-btn prof-add-btn--icon" onClick={openNew} title="הוסף בעל מקצוע חדש">
            +
          </button>
        </div>
      )}

      {/* ── Tab 1: בעלי מקצוע ── */}
      {activeTab === 1 && (
        <div className="prof-card">
          {loading ? (
            <p className="prof-loading">טוען...</p>
          ) : rows.length === 0 ? (
            <p className="prof-empty">לא נמצאו רשומות. לחץ "+" להוספה.</p>
          ) : (
            <table className="prof-table">
              <thead>
                <tr>
                  <th className="prof-col-profession">מקצוע</th>
                  <th className="prof-col-name">שם</th>
                  <th className="prof-col-business">שם עסק</th>
                  <th className="prof-col-phone">טלפון פרטי</th>
                  <th className="prof-col-phone">טלפון משרד</th>
                  <th className="prof-col-email">מייל</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="prof-row" onClick={() => openEdit(row)}>
                    <td className="prof-col-profession">
                      {row.profession || '—'}
                    </td>
                    <td className="prof-col-name">
                      {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="prof-col-business">{row.business_name || '—'}</td>
                    <td className="prof-col-phone prof-cell-center" dir="ltr">{displayPhone(row, 0)}</td>
                    <td className="prof-col-phone prof-cell-center" dir="ltr">{displayPhone(row, 1)}</td>
                    <td className="prof-col-email prof-cell-center">{displayEmail(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab 2: ספקים ── */}
      {activeTab === 2 && (
        <div className="prof-card prof-placeholder">
          בפיתוח
        </div>
      )}

      {/* ── Tab 3: רשויות ── */}
      {activeTab === 3 && (
        <div className="prof-card prof-placeholder">
          בפיתוח
        </div>
      )}

      {/* ── Modal (shared component) ── */}
      {modalOpen && (
        <ProfessionalModal
          key={editRow?.id ?? 'new'}
          editRow={editRow}
          onClose={closeModal}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onRowPatched={handleRowPatched}
        />
      )}

    </div>
  )
}
