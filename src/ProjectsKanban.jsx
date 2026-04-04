import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import './ProjectsKanban.css'

const STAGES = [
  'קליטת פרויקט', 'סקיצות', 'הדמיה', 'גרמושקה', 'רישוי',
  'תכניות עבודה', 'בניה', 'גמר', 'השהייה',
]

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

const URGENCY_COLOR = {
  'דחוף':      '#f59e0b',
  'דחוף מאוד': '#ef4444',
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysInStage(stage_entered_at) {
  if (!stage_entered_at) return 0
  const entered = new Date(stage_entered_at)
  const today   = new Date()
  entered.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today - entered) / 86400000))
}

function ProjectsKanban() {
  const [projects, setProjects]             = useState([])
  const [userRole, setUserRole]             = useState(null)
  const [currentUserName, setCurrentUserName] = useState('')
  const [users, setUsers]                   = useState([])
  const [showModal, setShowModal]           = useState(false)
  const [newName, setNewName]               = useState('')
  const [newResponsible, setNewResponsible] = useState('')
  const [adding, setAdding]                 = useState(false)
  const [modalError, setModalError]         = useState('')
  const [dragId, setDragId]                 = useState(null)
  const [contextMenu, setContextMenu]       = useState(null) // { x, y, project }
  const [ctxResponsible, setCtxResponsible] = useState('')
  const [filterResponsible, setFilterResponsible] = useState('')
  const [filterUrgency, setFilterUrgency]         = useState('')
  const menuRef                             = useRef(null)
  // Inquiry search state
  const [showInquirySearch, setShowInquirySearch] = useState(false)
  const [inquiryQuery, setInquiryQuery]           = useState('')
  const [inquiries, setInquiries]                 = useState([])
  const [selectedInquiry, setSelectedInquiry]     = useState(null) // inquiry to link on save

  const navigate = useNavigate()

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, first_name, last_name')
        .eq('id', session.user.id)
        .single()
      if (profile) {
        setUserRole(profile.role)
        setCurrentUserName([profile.first_name, profile.last_name].filter(Boolean).join(' '))
      }

      const { data: projectsData } = await supabase
        .from('projects')
        .select('*')
        .eq('archived', false)
        .order('created_at', { ascending: false })
      if (projectsData) {
        // Patch projects with no stage_entered_at
        const today = todayISO()
        const nullIds = projectsData.filter(p => !p.stage_entered_at).map(p => p.id)
        if (nullIds.length > 0) {
          await supabase.from('projects').update({ stage_entered_at: today }).in('id', nullIds)
          projectsData.forEach(p => { if (!p.stage_entered_at) p.stage_entered_at = today })
        }
        setProjects(projectsData)
      }

      const { data: usersData } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('role', ['admin', 'employee'])
        .order('first_name')
      if (usersData) setUsers(usersData)
    }
    init()
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  const fetchProjects = async () => {
    const { data, error } = await supabase
      .from('projects').select('*').eq('archived', false).order('created_at', { ascending: false })
    if (!error && data) setProjects(data)
  }

  const openModal = () => {
    setNewName(''); setNewResponsible(''); setModalError('')
    setShowInquirySearch(false); setInquiryQuery(''); setInquiries([])
    setSelectedInquiry(null)
    setShowModal(true)
  }

  const handleAddProject = async () => {
    if (!newName.trim()) { setModalError('יש להזין שם פרויקט'); return }
    setAdding(true); setModalError('')
    const { data, error } = await supabase.from('projects')
      .insert([{ name: newName.trim(), responsible: newResponsible || null, current_stage: 'קליטת פרויקט', stage_entered_at: todayISO(), urgency: 'רגיל', archived: false }])
      .select().single()
    setAdding(false)
    if (error) { setModalError(`שגיאה: ${error.message}`); return }
    if (!data) return

    // If an inquiry was linked, create contacts/client_info and mark it converted
    if (selectedInquiry) {
      const inq = selectedInquiry
      const coupled = splitCoupledFirstName(inq.first_name ?? '')
      const mainContacts = coupled
        ? [
            { project_id: data.id, first_name: coupled.part1, last_name: inq.last_name ?? null, phone: inq.phone ?? null, email: null },
            { project_id: data.id, first_name: coupled.part2, last_name: inq.last_name ?? null, phone: null, email: null },
          ]
        : [{ project_id: data.id, first_name: inq.first_name ?? null, last_name: inq.last_name ?? null, phone: inq.phone ?? null, email: null }]
      const contactRows = [
        ...mainContacts,
        ...((Array.isArray(inq.additional_contacts) ? inq.additional_contacts : [])
          .filter(c => c.first_name || c.last_name || c.phone)
          .map(c => ({ project_id: data.id, first_name: c.first_name ?? null, last_name: c.last_name ?? null, phone: c.phone ?? null, email: null }))
        ),
      ]
      await supabase.from('project_contacts').insert(contactRows)
      await supabase.from('client_info').insert([{ project_id: data.id, city: inq.city ?? null }])
      await supabase.from('inquiries').update({ converted_to_project: true }).eq('id', inq.id)
      setProjects(prev => [data, ...prev])
      setShowModal(false)
      navigate('/פרויקטים')
    } else {
      setProjects(prev => [data, ...prev])
      setShowModal(false)
    }
  }

  // ── Inquiry helpers ──
  function splitCoupledFirstName(firstName) {
    if (!firstName) return null
    const words = firstName.trim().split(/\s+/)
    const connIdx = words.findIndex(w => w.length > 1 && w[0] === 'ו')
    if (connIdx === -1) return null
    const part1 = words.slice(0, connIdx).join(' ')
    if (!part1) return null
    const afterWords = [...words.slice(connIdx)]
    afterWords[0] = afterWords[0].slice(1)
    const part2 = afterWords.join(' ')
    if (!part2) return null
    return { part1, part2 }
  }

  const loadInquiries = async () => {
    const { data } = await supabase
      .from('inquiries')
      .select('id, first_name, last_name, phone, city, additional_contacts')
      .eq('converted_to_project', false)
      .order('date', { ascending: false })
    setInquiries(data ?? [])
  }

  // Selecting an inquiry only populates the form — does NOT create anything
  const selectInquiry = (inq) => {
    const fullName = [inq.first_name, inq.last_name].filter(Boolean).join(' ')
    setNewName(fullName)
    setSelectedInquiry(inq)
    setShowInquirySearch(false)
    setInquiryQuery('')
  }

  // ── Context menu handlers (admin only) ──
  const handleCardRightClick = (e, project) => {
    if (!isAdmin) return
    e.preventDefault()
    const menuW = 180, menuH = 260
    const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
    setCtxResponsible(project.responsible || '')
    setContextMenu({ x, y, project })
  }

  const handleResponsibleChange = async (value) => {
    if (!contextMenu) return
    await supabase.from('projects').update({ responsible: value || null }).eq('id', contextMenu.project.id)
    setProjects(prev => prev.map(p => p.id === contextMenu.project.id ? { ...p, responsible: value || null } : p))
    setContextMenu(null)
  }

  const handleUrgencySelect = async (urgency) => {
    if (!contextMenu) return
    await supabase.from('projects').update({ urgency }).eq('id', contextMenu.project.id)
    setProjects(prev => prev.map(p => p.id === contextMenu.project.id ? { ...p, urgency } : p))
    setContextMenu(null)
  }

  // ── Drag handlers (admin only) ──
  const handleDragStart = (e, projectId) => {
    if (userRole !== 'admin') { e.preventDefault(); return }
    setDragId(projectId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e, stage) => {
    e.preventDefault()
    if (!dragId) return
    const project = projects.find(p => p.id === dragId)
    if (!project || project.current_stage === stage) { setDragId(null); return }

    const today      = todayISO()
    const enteredAt  = project.stage_entered_at || today
    const days       = daysInStage(enteredAt)

    // Log history for the stage being left
    await supabase.from('project_stage_history').insert([{
      project_id:    project.id,
      stage:         project.current_stage,
      entered_at:    enteredAt,
      exited_at:     today,
      days_in_stage: days,
    }])

    // Move to new stage, reset timer
    await supabase.from('projects')
      .update({ current_stage: stage, stage_entered_at: today })
      .eq('id', dragId)

    setProjects(prev => prev.map(p =>
      p.id === dragId ? { ...p, current_stage: stage, stage_entered_at: today } : p
    ))
    setDragId(null)
  }

  const isAdmin = userRole === 'admin'

  const filteredInquiries = inquiries.filter(inq => {
    if (!inquiryQuery) return true
    const label = [inq.first_name, inq.last_name].filter(Boolean).join(' ') + (inq.city ? ` ${inq.city}` : '')
    return label.includes(inquiryQuery)
  })
  const hasFilter = filterResponsible !== '' || filterUrgency !== ''

  const isVisible = (project) => {
    if (filterResponsible && project.responsible !== filterResponsible) return false
    if (filterUrgency && (project.urgency || 'רגיל') !== filterUrgency) return false
    return true
  }

  return (
    <div className="page" dir="rtl">
      <div className="kanban-container">

        {/* Topbar */}
        <div className="kanban-topbar">
          <span className="kanban-total">סה״כ פרויקטים: {projects.length}</span>
          <div className="kanban-filters">
            <select className="kanban-filter-select" value={filterResponsible} onChange={e => setFilterResponsible(e.target.value)}>
              <option value="">אחראית: הכל</option>
              {users.map(u => (
                <option key={u.id} value={`${u.first_name} ${u.last_name}`}>
                  {u.first_name} {u.last_name}
                </option>
              ))}
            </select>
            <select className="kanban-filter-select" value={filterUrgency} onChange={e => setFilterUrgency(e.target.value)}>
              <option value="">דחיפות: הכל</option>
              {['רגיל', 'דחוף', 'דחוף מאוד'].map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
            {hasFilter && (
              <button className="kanban-filter-reset" onClick={() => { setFilterResponsible(''); setFilterUrgency('') }}>
                בטל סינון
              </button>
            )}
          </div>
          {isAdmin && (
            <button className="btn-add-project kanban-add-btn" title="פרויקט חדש" onClick={openModal}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
                <path d="M9 21V12h6v9"/>
                <circle cx="18.5" cy="5.5" r="3.5" fill="#1a1a1a" stroke="none"/>
                <line x1="18.5" y1="3.5" x2="18.5" y2="7.5" stroke="white" strokeWidth="1.8"/>
                <line x1="16.5" y1="5.5" x2="20.5" y2="5.5" stroke="white" strokeWidth="1.8"/>
              </svg>
            </button>
          )}
        </div>

        {/* Board */}
        <div className="kanban-board">
          {STAGES.map(stage => {
            const { bg, text } = STAGE_COLORS[stage]
            const cards = projects.filter(p => p.current_stage === stage)
            return (
              <div
                key={stage}
                className="kanban-column"
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                {/* Column header */}
                <div className="kanban-col-header" style={{ background: bg, color: text }}>
                  {stage}
                  <span className="kanban-col-count">{cards.length}</span>
                </div>

                {/* Cards */}
                <div className="kanban-cards">
                  {cards.map(project => (
                    <div
                      key={project.id}
                      className="kanban-card"
                      draggable={isAdmin}
                      onDragStart={(e) => handleDragStart(e, project.id)}
                      onDoubleClick={() => navigate(`/projects/${project.id}`)}
                      onContextMenu={(e) => handleCardRightClick(e, project)}
                      style={!isVisible(project) ? { opacity: 0.25, filter: 'grayscale(1)' } : undefined}
                    >
                      <div className="kanban-card-days">{daysInStage(project.stage_entered_at)}</div>
                      <div className="kanban-card-name">{project.name}</div>
                      <div className="kanban-card-meta">
                        {project.responsible && (
                          <span className="kanban-card-responsible">
                            {(project.responsible).split(' ')[0]}
                          </span>
                        )}
                        {project.urgency && project.urgency !== 'רגיל' && (
                          <span
                            className="kanban-card-urgency"
                            style={{ background: URGENCY_COLOR[project.urgency] }}
                          >
                            {project.urgency}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="context-menu-row">
            <span className="context-menu-label">אחראית</span>
            <select
              className="context-menu-input"
              value={ctxResponsible}
              onChange={e => handleResponsibleChange(e.target.value)}
            >
              <option value="">ללא</option>
              {users.map(u => (
                <option key={u.id} value={`${u.first_name} ${u.last_name}`}>
                  {u.first_name} {u.last_name}
                </option>
              ))}
            </select>
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-row">
            <span className="context-menu-label">דחיפות</span>
            <select
              className="context-menu-input"
              value={contextMenu.project.urgency || 'רגיל'}
              onChange={e => handleUrgencySelect(e.target.value)}
            >
              {['רגיל', 'דחוף', 'דחוף מאוד'].map(urg => (
                <option key={urg} value={urg}>{urg}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Add Project Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} dir="rtl">
            <h3 className="modal-title">פרויקט חדש</h3>

            <label className="modal-label">שם פרויקט</label>
            <input className="modal-input" placeholder="שם פרויקט" value={newName}
              onChange={e => setNewName(e.target.value)} autoFocus />

            <label className="modal-label">אחראי פרויקט</label>
            <select className="modal-input" value={newResponsible} onChange={e => setNewResponsible(e.target.value)}>
              <option value="">בחר אחראי...</option>
              {users.map(u => (
                <option key={u.id} value={`${u.first_name} ${u.last_name}`}>
                  {u.first_name} {u.last_name}
                </option>
              ))}
            </select>

            {/* טען פניה — below אחראית */}
            <div style={{ marginTop: 10, position: 'relative' }}>
              {selectedInquiry ? (
                /* Selected state — read-only display matching input style */
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: '#F3F4F6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, color: '#1a1a2e', fontFamily: 'inherit', minHeight: 38, boxSizing: 'border-box' }}>
                  <span style={{ flex: 1 }}>
                    {[selectedInquiry.first_name, selectedInquiry.last_name].filter(Boolean).join(' ')}
                    {selectedInquiry.city ? ` — ${selectedInquiry.city}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedInquiry(null); setShowInquirySearch(false); setInquiryQuery('') }}
                    style={{ background: 'none', border: 'none', fontSize: 16, color: '#9ca3af', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 }}
                    title="נקה בחירה"
                  >
                    ×
                  </button>
                </div>
              ) : showInquirySearch ? (
                /* Search input + dropdown */
                <>
                  <input
                    className="modal-input"
                    placeholder="חיפוש לפי שם או יישוב..."
                    value={inquiryQuery}
                    onChange={e => setInquiryQuery(e.target.value)}
                    style={{ marginBottom: 0 }}
                    autoFocus
                  />
                  {filteredInquiries.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: 200, overflowY: 'auto' }}>
                      {filteredInquiries.slice(0, 8).map(inq => {
                        const label = [inq.first_name, inq.last_name].filter(Boolean).join(' ') + (inq.city ? ` — ${inq.city}` : '')
                        return (
                          <button
                            key={inq.id}
                            type="button"
                            onClick={() => selectInquiry(inq)}
                            style={{ display: 'block', width: '100%', textAlign: 'right', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid #f0f0f0', fontSize: 13, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseOver={e => e.currentTarget.style.background = '#f3f4f6'}
                            onMouseOut={e => e.currentTarget.style.background = 'none'}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {inquiries.length === 0 && (
                    <p style={{ fontSize: 12, color: '#888', margin: '5px 0 0', textAlign: 'right' }}>אין פניות פתוחות</p>
                  )}
                </>
              ) : (
                /* Trigger button */
                <button
                  type="button"
                  onClick={() => { setShowInquirySearch(true); loadInquiries() }}
                  style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 7, padding: '6px 14px', fontSize: 13, color: '#888', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
                >
                  + טען פניה
                </button>
              )}
            </div>

            {modalError && <p style={{ color: 'red', fontSize: '13px', margin: '8px 0 0', textAlign: 'right' }}>{modalError}</p>}
            <div className="modal-actions">
              <button className="modal-btn-add" onClick={handleAddProject} disabled={adding}>{adding ? '...' : 'צור פרויקט'}</button>
              <button className="modal-btn-cancel" onClick={() => setShowModal(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProjectsKanban
