import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import ProfessionalModal from './components/professionals/ProfessionalModal'
import SupplierModal from './components/professionals/SupplierModal'
import AuthorityModal from './components/professionals/AuthorityModal'
import './Professionals.css'

export default function Professionals() {
  const [activeTab, setActiveTab] = useState(1)
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editRow, setEditRow]     = useState(null) // null = add new

  /* ── Suppliers tab state ── */
  const [suppliers, setSuppliers]                 = useState([])
  const [suppliersLoading, setSuppliersLoading]   = useState(true)
  const [supplierModalOpen, setSupplierModalOpen] = useState(false)
  const [supplierEditRow, setSupplierEditRow]     = useState(null)

  /* ── Authorities tab state ── */
  const [authorities, setAuthorities]               = useState([])
  const [authoritiesLoading, setAuthoritiesLoading] = useState(true)
  const [authorityModalOpen, setAuthorityModalOpen] = useState(false)
  const [authorityEditRow, setAuthorityEditRow]     = useState(null)

  /* ── Fetch ── */
  useEffect(() => { fetchAll(); fetchAllSuppliers(); fetchAllAuthorities() }, [])

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

  const fetchAllSuppliers = async () => {
    setSuppliersLoading(true)
    const { data } = await supabase
      .from('suppliers')
      .select('*')
      .order('domain')
      .order('name')
    if (data) setSuppliers(data)
    setSuppliersLoading(false)
  }

  const fetchAllAuthorities = async () => {
    setAuthoritiesLoading(true)
    const { data } = await supabase
      .from('authorities')
      .select('*')
      .order('name')
    if (data) setAuthorities(data)
    setAuthoritiesLoading(false)
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

  /* ── Suppliers handlers ── */
  const openNewSupplier    = ()    => { setSupplierEditRow(null); setSupplierModalOpen(true) }
  const openEditSupplier   = (row) => { setSupplierEditRow(row);  setSupplierModalOpen(true) }
  const closeSupplierModal = ()    => { setSupplierModalOpen(false); setSupplierEditRow(null) }

  const handleSupplierSaved = (row, isNew) => {
    if (isNew) setSuppliers(prev => [...prev, row])
    else       setSuppliers(prev => prev.map(r => r.id === row.id ? row : r))
    closeSupplierModal()
  }

  const handleSupplierDeleted = (id) => {
    setSuppliers(prev => prev.filter(r => r.id !== id))
    closeSupplierModal()
  }

  /* ── Authorities handlers ── */
  const openNewAuthority    = ()    => { setAuthorityEditRow(null); setAuthorityModalOpen(true) }
  const openEditAuthority   = (row) => { setAuthorityEditRow(row);  setAuthorityModalOpen(true) }
  const closeAuthorityModal = ()    => { setAuthorityModalOpen(false); setAuthorityEditRow(null) }

  const handleAuthoritySaved = (row, isNew) => {
    if (isNew) setAuthorities(prev => [...prev, row])
    else       setAuthorities(prev => prev.map(r => r.id === row.id ? row : r))
    closeAuthorityModal()
  }

  const handleAuthorityDeleted = (id) => {
    setAuthorities(prev => prev.filter(r => r.id !== id))
    closeAuthorityModal()
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
      {activeTab === 2 && (
        <div className="prof-tab-actions">
          <button className="prof-add-btn prof-add-btn--icon" onClick={openNewSupplier} title="הוסף ספק חדש">
            +
          </button>
        </div>
      )}
      {activeTab === 3 && (
        <div className="prof-tab-actions">
          <button className="prof-add-btn prof-add-btn--icon" onClick={openNewAuthority} title="הוסף רשות חדשה">
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
        <div className="prof-card">
          {suppliersLoading ? (
            <p className="prof-loading">טוען...</p>
          ) : suppliers.length === 0 ? (
            <p className="prof-empty">לא נמצאו רשומות. לחץ "+" להוספה.</p>
          ) : (
            <table className="prof-table">
              <thead>
                <tr>
                  <th className="prof-col-profession">תחום</th>
                  <th className="prof-col-name">שם</th>
                  <th className="prof-col-business">כתובת</th>
                  <th className="prof-col-phone">טלפון</th>
                  <th className="prof-col-phone">טלפון נוסף</th>
                  <th className="prof-col-email">מייל</th>
                  <th className="prof-col-email">אתר</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(row => (
                  <tr key={row.id} className="prof-row" onClick={() => openEditSupplier(row)}>
                    <td className="prof-col-profession">{row.domain  || '—'}</td>
                    <td className="prof-col-name">{row.name    || '—'}</td>
                    <td className="prof-col-business">{row.address || '—'}</td>
                    <td className="prof-col-phone prof-cell-center" dir="ltr">{row.phone   || '—'}</td>
                    <td className="prof-col-phone prof-cell-center" dir="ltr">{row.phone2  || '—'}</td>
                    <td className="prof-col-email prof-cell-center">{row.email   || '—'}</td>
                    <td className="prof-col-email prof-cell-center" dir="ltr">{row.website || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Tab 3: רשויות ── */}
      {activeTab === 3 && (
        <div className="prof-card">
          {authoritiesLoading ? (
            <p className="prof-loading">טוען...</p>
          ) : authorities.length === 0 ? (
            <p className="prof-empty">לא נמצאו רשומות. לחץ "+" להוספה.</p>
          ) : (
            <table className="prof-table">
              <thead>
                <tr>
                  <th className="prof-col-profession">רשות</th>
                  <th className="prof-col-name">איש קשר</th>
                  <th className="prof-col-business">כתובת</th>
                  <th className="prof-col-phone">טלפון</th>
                  <th className="prof-col-email">מייל</th>
                </tr>
              </thead>
              <tbody>
                {authorities.map(row => (
                  <tr key={row.id} className="prof-row" onClick={() => openEditAuthority(row)}>
                    <td className="prof-col-profession">{row.name         || '—'}</td>
                    <td className="prof-col-name">{row.contact_name || '—'}</td>
                    <td className="prof-col-business">{row.address      || '—'}</td>
                    <td className="prof-col-phone prof-cell-center" dir="ltr">{row.phone || '—'}</td>
                    <td className="prof-col-email prof-cell-center">{row.email           || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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

      {/* ── Supplier modal ── */}
      {supplierModalOpen && (
        <SupplierModal
          key={supplierEditRow?.id ?? 'new'}
          editRow={supplierEditRow}
          onClose={closeSupplierModal}
          onSaved={handleSupplierSaved}
          onDeleted={handleSupplierDeleted}
        />
      )}

      {/* ── Authority modal ── */}
      {authorityModalOpen && (
        <AuthorityModal
          key={authorityEditRow?.id ?? 'new'}
          editRow={authorityEditRow}
          onClose={closeAuthorityModal}
          onSaved={handleAuthoritySaved}
          onDeleted={handleAuthorityDeleted}
        />
      )}

    </div>
  )
}
