import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from './Header'
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

function ProjectsKanban() {
  const [projects, setProjects]             = useState([])
  const [userRole, setUserRole]             = useState(null)
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

  const navigate = useNavigate()

  useEffect(() => { fetchProjects(); fetchUserRole(); fetchUsers() }, [])

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

  const fetchUserRole = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
    if (data) setUserRole(data.role)
  }

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('profiles').select('id, first_name, last_name').in('role', ['admin', 'employee']).order('first_name')
    if (!error && data) setUsers(data)
  }

  const openModal = () => { setNewName(''); setNewResponsible(''); setModalError(''); setShowModal(true) }

  const handleAddProject = async () => {
    if (!newName.trim()) { setModalError('יש להזין שם פרויקט'); return }
    setAdding(true); setModalError('')
    const { data, error } = await supabase.from('projects')
      .insert([{ name: newName.trim(), responsible: newResponsible || null, current_stage: 'קליטת פרויקט', urgency: 'רגיל', archived: false }])
      .select().single()
    setAdding(false)
    if (error) { setModalError(`שגיאה: ${error.message}`); return }
    if (data) { setProjects(prev => [data, ...prev]); setShowModal(false) }
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
    await supabase.from('projects').update({ current_stage: stage }).eq('id', dragId)
    setProjects(prev => prev.map(p => p.id === dragId ? { ...p, current_stage: stage } : p))
    setDragId(null)
  }

  const isAdmin = userRole === 'admin'
  const hasFilter = filterResponsible !== '' || filterUrgency !== ''

  const isVisible = (project) => {
    if (filterResponsible && project.responsible !== filterResponsible) return false
    if (filterUrgency && (project.urgency || 'רגיל') !== filterUrgency) return false
    return true
  }

  return (
    <div className="page" dir="rtl">
      <Header />

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

        {/* Footer: add button */}
        {isAdmin && (
          <div className="kanban-footer">
            <button className="btn-add-project" onClick={openModal}>+ פרויקט חדש</button>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <div className="context-menu-title">{contextMenu.project.name}</div>
          <div className="context-menu-divider" />
          <div className="context-menu-title">אחראית</div>
          <div className="context-menu-inline">
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
          <div className="context-menu-title">דחיפות</div>
          <div className="context-menu-inline">
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
            {modalError && <p style={{ color: 'red', fontSize: '13px', margin: '4px 0 0', textAlign: 'right' }}>{modalError}</p>}
            <div className="modal-actions">
              <button className="modal-btn-add" onClick={handleAddProject} disabled={adding}>{adding ? '...' : 'הוסף'}</button>
              <button className="modal-btn-cancel" onClick={() => setShowModal(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProjectsKanban
