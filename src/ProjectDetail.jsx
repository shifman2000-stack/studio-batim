import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'
import ProfessionalModal from './components/professionals/ProfessionalModal'
import DocumentsTab from './components/documents/DocumentsTab'
import TasksTab from './components/tasks/TasksTab'
import './ProjectDetail.css'

const STAGE_COLORS = {
  'קליטת פרויקט':  { bg: '#f0f0f0', text: '#000' },
  'סקיצות':        { bg: '#e8e197', text: '#000' },
  'הדמיה':         { bg: '#cbc9a2', text: '#000' },
  'גרמושקה':       { bg: '#73946e', text: '#fff' },
  'רישוי':         { bg: '#7bc1b5', text: '#000' },
  'תכניות עבודה':  { bg: '#676977', text: '#fff' },
  'בניה':          { bg: '#89748b', text: '#fff' },
  'גמר':           { bg: '#87526d', text: '#fff' },
  'השהייה':        { bg: '#bcaaae', text: '#000' },
}

const TABS = [
  { id: 1, label: 'פרטי תיק' },
  { id: 3, label: 'מעקב שלבי התקדמות' },
  { id: 2, label: 'מעקב מסמכים' },
  { id: 4, label: 'שעות', disabled: true },
]

/* ── Professional roles (card 3) ── */
const PROF_ROLES = [
  { label: 'אחראית פרויקט',   profession: 'אחראית פרויקט',   idField: 'project_manager_id' },
  { label: 'מודד',             profession: 'מודד',             idField: 'surveyor_id' },
  { label: 'קונסטרוקטור',      profession: 'קונסטרוקטור',      idField: 'constructor_id' },
  { label: 'מהנדס אינסטלציה',  profession: 'מהנדס אינסטלציה',  idField: 'plumbing_engineer_id' },
  { label: 'יועץ קרקע',        profession: 'יועץ קרקע',        idField: 'soil_consultant_id' },
  { label: 'קבלן',             profession: 'קבלן',             idField: 'contractor_id' },
  { label: 'מפקח',             profession: 'מפקח',             idField: 'supervisor_id' },
]

/* ── Inline editable field ── */
function InlineField({ value, onSave, placeholder = '', type = 'text', multiline = false }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value ?? '')

  useEffect(() => { setVal(value ?? '') }, [value])

  if (editing) {
    const props = {
      value: val,
      onChange: e => setVal(e.target.value),
      onBlur: () => { setEditing(false); if (val !== (value ?? '')) onSave(val) },
      autoFocus: true,
      className: 'pd-field-input',
    }
    return multiline
      ? <textarea rows={3} {...props} />
      : <input type={type} {...props} />
  }

  return (
    <span
      className={'pd-field-value' + (val ? '' : ' pd-field-empty')}
      onClick={() => setEditing(true)}
    >
      {val || placeholder}
    </span>
  )
}

/* ── Main component ── */
function ProjectDetail() {
  const { id }     = useParams()
  const navigate   = useNavigate()

  const [project, setProject]       = useState(null)
  const [activeTab, setActiveTab]   = useState(1)
  const [contacts, setContacts]     = useState([])
  const [clientInfo, setClientInfo] = useState(null)

  /* professionals list — lightweight (id, name, profession only) */
  const [profList, setProfList] = useState([])

  /* shared professional modal */
  const [profModalOpen, setProfModalOpen]       = useState(false)
  const [profModalEditRow, setProfModalEditRow] = useState(null) // null = add new

  /* selection popover — tracks which role's popover is open (idField or null) */
  const [selectionPopover, setSelectionPopover] = useState(null)

  /* ── fetch project ── */
  useEffect(() => {
    const fetchProject = async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, current_stage')
        .eq('id', id)
        .single()
      if (data) setProject(data)
    }
    fetchProject()
  }, [id])

  /* ── fetch tab-1 data ── */
  useEffect(() => {
    const fetchTabData = async () => {
      const [{ data: c }, { data: ci }] = await Promise.all([
        supabase.from('project_contacts').select('*').eq('project_id', id).order('created_at'),
        supabase.from('client_info').select('*').eq('project_id', id).maybeSingle(),
      ])
      if (c)  setContacts(c)
      if (ci) setClientInfo(ci)
    }
    fetchTabData()
  }, [id])

  /* ── fetch professionals list ── */
  useEffect(() => {
    const fetchProfessionals = async () => {
      const { data } = await supabase
        .from('professionals')
        .select('id, first_name, last_name, profession')
        .order('first_name')
      if (data) setProfList(data)
    }
    fetchProfessionals()
  }, [])

  /* ── Contact helpers ── */
  const saveContact = async (contactId, field, val) => {
    await supabase.from('project_contacts').update({ [field]: val }).eq('id', contactId)
  }

  const addContact = async () => {
    const { data } = await supabase
      .from('project_contacts')
      .insert([{ project_id: id, first_name: '', last_name: '', id_number: '', phone: '', email: '' }])
      .select()
      .single()
    if (data) setContacts(prev => [...prev, data])
  }

  const deleteContact = async (contactId) => {
    await supabase.from('project_contacts').delete().eq('id', contactId)
    setContacts(prev => prev.filter(c => c.id !== contactId))
  }

  /* ── Client info helper ── */
  const saveClientInfo = async (field, val) => {
    const value = val === '' ? null : val
    if (clientInfo?.id) {
      await supabase.from('client_info').update({ [field]: value }).eq('id', clientInfo.id)
      setClientInfo(prev => ({ ...prev, [field]: value }))
    } else {
      const { data } = await supabase
        .from('client_info')
        .insert([{ project_id: id, [field]: value }])
        .select()
        .single()
      if (data) setClientInfo(data)
    }
  }

  /* ── Professional modal helpers ── */
  const openProfNew = () => {
    setProfModalEditRow(null)
    setProfModalOpen(true)
  }

  const openProfEdit = async (profId) => {
    const { data } = await supabase.from('professionals').select('*').eq('id', profId).single()
    if (data) {
      setProfModalEditRow(data)
      setProfModalOpen(true)
    }
  }

  const closeProfModal = () => {
    setProfModalOpen(false)
    setProfModalEditRow(null)
  }

  const handleProfSaved = async (row, isNew) => {
    const slim = { id: row.id, first_name: row.first_name, last_name: row.last_name, profession: row.profession }
    if (isNew) {
      setProfList(prev => [...prev, slim])
      // Auto-select in the matching role dropdown if the slot is empty
      const role = PROF_ROLES.find(r => r.profession === row.profession)
      if (role && !clientInfo?.[role.idField]) {
        await saveClientInfo(role.idField, row.id)
      }
    } else {
      setProfList(prev => prev.map(p => p.id === row.id ? slim : p))
    }
    closeProfModal()
  }

  const handleProfDeleted = async (id) => {
    setProfList(prev => prev.filter(p => p.id !== id))
    // Clear any client_info references to this professional
    const clearedFields = {}
    PROF_ROLES.forEach(role => {
      if (clientInfo?.[role.idField] === id) clearedFields[role.idField] = null
    })
    if (Object.keys(clearedFields).length > 0 && clientInfo?.id) {
      await supabase.from('client_info').update(clearedFields).eq('id', clientInfo.id)
      setClientInfo(prev => ({ ...prev, ...clearedFields }))
    }
    closeProfModal()
  }

  const stageColor = project?.current_stage
    ? STAGE_COLORS[project.current_stage] || { bg: '#e0e0e0', text: '#000' }
    : null

  /* ── Committee fields ── */
  const committeeFields = [
    { label: 'ועדה',                      field: 'committee' },
    { label: 'בודקת',                     field: 'checker' },
    { label: 'תיק מידע רישוי זמין',       field: 'info_license_file' },
    { label: 'תיק בניין',                 field: 'building_file' },
    { label: 'מספר בקשה פנימי/ועדה',      field: 'internal_request_num' },
    { label: 'מספר בקשה רישוי זמין',      field: 'available_license_num' },
    { label: 'תיק הג"א',                  field: 'civil_defense_file' },
    { label: 'מהות הבקשה',               field: 'request_essence', multiline: true },
  ]

  return (
    <div className="pd-page" dir="rtl">

      {/* ── Header ── */}
      <div className="pd-header">
        <div className="pd-header-left">
          <h1 className="pd-title">{project ? project.name : '…'}</h1>
          {project?.current_stage && stageColor && (
            <span
              className="pd-stage-badge"
              style={{ background: stageColor.bg, color: stageColor.text }}
            >
              {project.current_stage}
            </span>
          )}
        </div>
        <button className="pd-back-btn" onClick={() => navigate('/פרויקטים')}>
          ← חזרה לפרויקטים
        </button>
      </div>

      {/* ── Tabs bar ── */}
      <div className="pd-tabs-bar">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={
              'pd-tab' +
              (activeTab === tab.id ? ' pd-tab--active' : '') +
              (tab.disabled ? ' pd-tab--disabled' : '')
            }
            onClick={() => { if (!tab.disabled) setActiveTab(tab.id) }}
            disabled={tab.disabled}
          >
            {tab.label}
            {tab.disabled && <span className="pd-tab-soon">בקרוב</span>}
          </button>
        ))}
      </div>

      {/* ── Scrollable tab content ── */}
      <div className="pd-tab-content">

        {/* ── Tab 1 — פרטי תיק ── */}
        {activeTab === 1 && (
          <div className="pd-tab1-grid">

            {/* Top row: 3 cards */}
            <div className="pd-info-cards-row">

              {/* Right 50%: אנשי קשר */}
              <div className="pd-info-card">
                <div className="pd-card-title">אנשי קשר</div>

                {contacts.length > 0 && (
                  <div className="pd-contact-header">
                    <span className="pd-contact-col-label">שם פרטי</span>
                    <span className="pd-contact-col-label">שם משפחה</span>
                    <span className="pd-contact-col-label">ת.ז</span>
                    <span className="pd-contact-col-label">טלפון</span>
                    <span className="pd-contact-col-label">מייל</span>
                    <span />
                  </div>
                )}

                {contacts.map(contact => (
                  <div key={contact.id} className="pd-contact-row">
                    <InlineField
                      value={contact.first_name}
                      placeholder="שם פרטי"
                      onSave={val => saveContact(contact.id, 'first_name', val)}
                    />
                    <InlineField
                      value={contact.last_name}
                      placeholder="שם משפחה"
                      onSave={val => saveContact(contact.id, 'last_name', val)}
                    />
                    <InlineField
                      value={contact.id_number}
                      placeholder="ת.ז"
                      onSave={val => saveContact(contact.id, 'id_number', val)}
                    />
                    <InlineField
                      value={contact.phone}
                      placeholder="טלפון"
                      type="tel"
                      onSave={val => saveContact(contact.id, 'phone', val)}
                    />
                    <InlineField
                      value={contact.email}
                      placeholder="מייל"
                      type="email"
                      onSave={val => saveContact(contact.id, 'email', val)}
                    />
                    <button
                      className="pd-delete-btn"
                      onClick={() => deleteContact(contact.id)}
                      title="מחק איש קשר"
                    >
                      ×
                    </button>
                  </div>
                ))}

                <button className="pd-add-btn" onClick={addContact}>
                  + הוסף איש קשר
                </button>
              </div>

              {/* Middle 25%: פרטי מגרש */}
              <div className="pd-info-card">
                <div className="pd-card-title">פרטי מגרש</div>
                {[
                  { label: 'ישוב',                 field: 'city' },
                  { label: 'גוש',                  field: 'gush' },
                  { label: 'חלקה',                 field: 'helka' },
                  { label: 'מגרש',                 field: 'migrash' },
                  { label: 'שטח המגרש',            field: 'area' },
                  { label: 'תוכניות חלות במקום',   field: 'active_plans', multiline: true },
                ].map(({ label, field, multiline }) => (
                  <div key={field} className="pd-field-row">
                    <span className="pd-field-label">{label}</span>
                    <div className="pd-field-cell">
                      <InlineField
                        value={clientInfo?.[field]}
                        placeholder="—"
                        multiline={multiline}
                        onSave={val => saveClientInfo(field, val)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Left 25%: בעלי מקצוע */}
              <div className="pd-info-card">
                <div className="pd-card-title">בעלי מקצוע</div>
                {PROF_ROLES.map(({ label, profession, idField }) => {
                  const options      = profList.filter(p => p.profession === profession)
                  const selectedId   = clientInfo?.[idField] ?? ''
                  const selectedProf = profList.find(p => p.id === selectedId)
                  const fullName     = selectedProf
                    ? `${selectedProf.first_name ?? ''} ${selectedProf.last_name ?? ''}`.trim()
                    : ''
                  return (
                    <div key={idField} className="pd-prof-row">
                      <span className="pd-prof-label">{label}</span>
                      <div className="pd-prof-value-wrap">
                        {/* Name or dash */}
                        {selectedId && fullName ? (
                          <button
                            type="button"
                            className="pd-prof-name-btn"
                            onClick={() => openProfEdit(selectedId)}
                            title="ערוך פרטי בעל מקצוע"
                          >
                            {fullName}
                          </button>
                        ) : (
                          <span className="pd-prof-empty">—</span>
                        )}

                        {/* Trash — clear selection */}
                        {selectedId && (
                          <button
                            type="button"
                            className="pd-prof-clear-btn"
                            onClick={() => saveClientInfo(idField, '')}
                            title="הסר בחירה"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              <line x1="10" y1="11" x2="10" y2="17"/>
                              <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                          </button>
                        )}

                        {/* Plus — open selection popover */}
                        <div className="pd-prof-popover-wrap">
                          <button
                            type="button"
                            className="pd-prof-pick-btn"
                            onClick={() => setSelectionPopover(selectionPopover === idField ? null : idField)}
                            title="בחר בעל מקצוע"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/>
                              <line x1="12" y1="8" x2="12" y2="16"/>
                              <line x1="8" y1="12" x2="16" y2="12"/>
                            </svg>
                          </button>
                          {selectionPopover === idField && (
                            <div className="pd-prof-popover">
                              {options.length === 0 ? (
                                <div className="pd-prof-popover-empty">אין בעלי מקצוע במקצוע זה</div>
                              ) : (
                                options.map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    className="pd-prof-popover-item"
                                    onClick={() => {
                                      saveClientInfo(idField, p.id)
                                      setSelectionPopover(null)
                                    }}
                                  >
                                    {`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—'}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
                <button type="button" className="pd-add-btn" onClick={openProfNew}>
                  + הוסף בעל מקצוע חדש
                </button>
              </div>

            </div>{/* end pd-info-cards-row */}

            {/* Bottom row: פרטי רישוי full width */}
            <div className="pd-info-card pd-info-card--wide">
              <div className="pd-card-title">פרטי רישוי</div>
              <div className="pd-committee-grid">
                {/* Right column: ועדה, בודקת, תיק מידע רישוי זמין, תיק בניין */}
                <div className="pd-committee-col">
                  {committeeFields.slice(0, 4).map(({ label, field, multiline }) => (
                    <div key={field} className="pd-field-row">
                      <span className="pd-field-label">{label}</span>
                      <div className="pd-field-cell">
                        <InlineField
                          value={clientInfo?.[field]}
                          placeholder="—"
                          multiline={multiline}
                          onSave={val => saveClientInfo(field, val)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Left column: מספר בקשה פנימי/ועדה, מספר בקשה רישוי זמין, תיק הג"א, מהות הבקשה */}
                <div className="pd-committee-col">
                  {committeeFields.slice(4).map(({ label, field, multiline }) => (
                    <div key={field} className="pd-field-row">
                      <span className="pd-field-label">{label}</span>
                      <div className="pd-field-cell">
                        <InlineField
                          value={clientInfo?.[field]}
                          placeholder="—"
                          multiline={multiline}
                          onSave={val => saveClientInfo(field, val)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── Tab 2 — מעקב מסמכים ── */}
        {activeTab === 2 && (
          <DocumentsTab projectId={id} />
        )}

        {/* ── Tab 3 — מעקב שלבי התקדמות ── */}
        {activeTab === 3 && (
          <TasksTab projectId={id} />
        )}

      </div>{/* end pd-tab-content */}

      {/* ── Popover backdrop ── */}
      {selectionPopover && (
        <div className="pd-prof-backdrop" onClick={() => setSelectionPopover(null)} />
      )}

      {/* ── Professional modal (shared component) ── */}
      {profModalOpen && (
        <ProfessionalModal
          key={profModalEditRow?.id ?? 'new'}
          editRow={profModalEditRow}
          onClose={closeProfModal}
          onSaved={handleProfSaved}
          onDeleted={handleProfDeleted}
        />
      )}

    </div>
  )
}

export default ProjectDetail
