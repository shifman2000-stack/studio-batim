import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Header from './Header'
import { supabase } from './supabaseClient'
import './Projects.css'

/* ─────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────── */
// Columns after the project name (in display order, RTL)
const COL_LABELS = [
  'אחראית', 'דחיפות', 'קליטת פרויקט',
  'סקיצות', 'הדמיה', 'גרמושקה', 'רישוי',
  'תכניות עבודה', 'בניה', 'גמר', 'השהייה',
]

const STAGES = ['סקיצות', 'הדמיה', 'גרמושקה', 'רישוי', 'תכניות עבודה', 'בניה', 'גמר', 'השהייה']
const URGENCY_OPTIONS = ['רגיל', 'דחוף', 'דחוף מאוד']

// Header cell colors (shown in the header row)
const HEADER_COLORS = {
  'קליטת פרויקט': { bg: '#f0f0f0', text: '#000' },
  'סקיצות':        { bg: '#e8e197', text: '#000' },
  'הדמיה':         { bg: '#cbc9a2', text: '#000' },
  'גרמושקה':       { bg: '#73946e', text: '#fff' },
  'רישוי':         { bg: '#7bc1b5', text: '#000' },
  'תכניות עבודה':  { bg: '#676977', text: '#fff' },
  'בניה':          { bg: '#89748b', text: '#fff' },
  'גמר':           { bg: '#87526d', text: '#fff' },
  'השהייה':        { bg: '#bcaaae', text: '#000' },
}

// Active stage cell colors (when project.current_stage === col)
const STAGE_COLORS = HEADER_COLORS

/* ─────────────────────────────────────────
   COMPONENT
───────────────────────────────────────── */
function Projects() {
  const [projects, setProjects]             = useState([])
  const [userRole, setUserRole]             = useState(null)
  const [users, setUsers]                   = useState([])
  const [contextMenu, setContextMenu]       = useState(null)
  const [ctxResponsible, setCtxResponsible] = useState('')
  const [ctxUrgency, setCtxUrgency]         = useState('')
  const [showModal, setShowModal]           = useState(false)
  const [newName, setNewName]               = useState('')
  const [newResponsible, setNewResponsible] = useState('')
  const [adding, setAdding]                 = useState(false)
  const [modalError, setModalError]         = useState('')

  const navigate = useNavigate()
  const menuRef  = useRef(null)

  useEffect(() => { fetchProjects(); fetchUserRole(); fetchUsers() }, [])

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setContextMenu(null)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [])

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

  const handleRightClick = (e, project) => {
    if (userRole !== 'admin') return
    e.preventDefault()
    setCtxResponsible(project.responsible || '')
    setCtxUrgency(project.urgency || 'רגיל')
    const menuW = 180
    const menuH = 330
    const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
    setContextMenu({ x, y, project })
  }

  const handleStageSelect = async (stage) => {
    const { project } = contextMenu
    await supabase.from('projects').update({ current_stage: stage }).eq('id', project.id)
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, current_stage: stage } : p))
    setContextMenu(null)
  }

  const handleResponsibleSave = async () => {
    const { project } = contextMenu
    await supabase.from('projects').update({ responsible: ctxResponsible }).eq('id', project.id)
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, responsible: ctxResponsible } : p))
    setContextMenu(null)
  }

  const handleUrgencySelect = async (urgency) => {
    const { project } = contextMenu
    await supabase.from('projects').update({ urgency }).eq('id', project.id)
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, urgency } : p))
    setContextMenu(null)
  }

  // Returns the value and active color for a given project × column
  const getCell = (project, col) => {
    if (col === 'אחראית') return { value: (project.responsible || '').split(' ')[0], color: null }
    if (col === 'דחיפות')  return { value: project.urgency || '', color: null }
    const isActive = project.current_stage === col
    return { value: '', color: isActive ? STAGE_COLORS[col] : null }
  }

  const isAdmin = userRole === 'admin'

  /* ────────────────────────────────────────
     RENDER
  ──────────────────────────────────────── */
  return (
    <div className="page" dir="rtl">
      <Header />

      <div className="projects-container">
        <div className="projects-table-wrapper">
          <table className="projects-table" dir="rtl">

            {/* ── COLGROUP: name + אחראית + דחיפות shrink-to-fit; 9 stage cols share the rest equally ── */}
            <colgroup>
              <col className="col-w-serial" />
              <col className="col-w-name" />
              <col className="col-w-info" />
              <col className="col-w-info" />
              {/* 9 stage columns — no explicit width → equal share of remaining space */}
              {Array.from({ length: 9 }).map((_, i) => <col key={i} className="col-w-stage" />)}
            </colgroup>

            {/* ── HEADER ROW ── */}
            <thead>
              <tr>
                {/* Serial number column header */}
                <th className="col-serial col-header">#</th>
                {/* Project name column header — sticky right */}
                <th className="col-label col-header">שם פרויקט</th>

                {/* אחראית + דחיפות — shrink-to-fit */}
                <th className="col-project col-info col-header">אחראית</th>
                <th className="col-project col-info col-header">דחיפות</th>

                {/* 9 stage column headers — colored, equal width */}
                {COL_LABELS.slice(2).map(col => {
                  const hc = HEADER_COLORS[col]
                  return (
                    <th
                      key={col}
                      className="col-project col-stage col-header"
                      style={hc ? { background: hc.bg, color: hc.text } : undefined}
                    >
                      {col}
                    </th>
                  )
                })}
              </tr>
            </thead>

            {/* ── BODY: one row per project ── */}
            <tbody>
              {projects.map((project, idx) => (
                <tr key={project.id}>
                  {/* Serial number */}
                  <td className="col-serial">{idx + 1}</td>
                  {/* Project name — sticky right, bold */}
                  <td
                    className="col-label col-name"
                    onDoubleClick={() => navigate(`/projects/${project.id}`)}
                    onContextMenu={(e) => handleRightClick(e, project)}
                  >
                    {project.name}
                  </td>

                  {/* אחראית + דחיפות cells */}
                  <td className="col-project col-info">{(project.responsible || '').split(' ')[0]}</td>
                  <td className="col-project col-info">{project.urgency || ''}</td>

                  {/* 9 stage cells */}
                  {COL_LABELS.slice(2).map(col => {
                    const isActive = project.current_stage === col
                    const color = isActive ? STAGE_COLORS[col] : null
                    return (
                      <td
                        key={col}
                        className={`col-project col-stage${color ? ' col-colored' : ''}`}
                      >
                        {color
                          ? <div className="cell-fill" style={{ background: color.bg, color: color.text }} />
                          : null
                        }
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>

          </table>
        </div>

        {/* ── Footer (admin only) ── */}
        {isAdmin && (
          <div className="projects-footer">
            <button className="btn-add-project" onClick={openModal}>הוספת פרויקט</button>
            <button className="btn-archive">העברה לארכיון</button>
          </div>
        )}
      </div>

      {/* ── Add Project Modal ── */}
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

      {/* ── Right-click Context Menu ── */}
      {contextMenu && (
        <div className="context-menu" style={{ top: contextMenu.y, left: contextMenu.x }} ref={menuRef} dir="rtl">
          <div className="context-menu-title">שלב:</div>
          {STAGES.map(stage => (
            <button key={stage} className="context-menu-item"
              style={{ backgroundColor: STAGE_COLORS[stage]?.bg, color: STAGE_COLORS[stage]?.text }}
              onClick={() => handleStageSelect(stage)}>
              {stage}
            </button>
          ))}
          <div className="context-menu-divider" />
          <div className="context-menu-title">אחראי:</div>
          <div className="context-menu-inline">
            <select className="context-menu-input" value={ctxResponsible} onChange={e => setCtxResponsible(e.target.value)}>
              <option value="">בחר אחראי...</option>
              {users.map(u => (
                <option key={u.id} value={`${u.first_name} ${u.last_name}`}>
                  {u.first_name} {u.last_name}
                </option>
              ))}
            </select>
            <button className="context-menu-save" onClick={handleResponsibleSave}>✓</button>
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-title">דחיפות:</div>
          {URGENCY_OPTIONS.map(u => (
            <button key={u} className={`context-menu-item${ctxUrgency === u ? ' context-menu-item--active' : ''}`}
              onClick={() => handleUrgencySelect(u)}>
              {u}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default Projects
