import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'
import NewTaskModal from './NewTaskModal'
import './ProjectsKanban.css'

function getTextColor(bgHex) {
  if (!bgHex) return '#1a1a18'
  const hex = bgHex.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#1a1a18' : '#ffffff'
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

const IconArchive = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8"/>
    <rect x="1" y="3" width="22" height="5"/>
    <line x1="10" y1="12" x2="14" y2="12"/>
  </svg>
)

function formatDate(iso) {
  if (!iso) return ''
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function ProjectsKanban() {
  const [projects, setProjects]             = useState([])
  const [stages, setStages]                 = useState([])
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
  const [tasksByProject, setTasksByProject]       = useState({})
  const menuRef                             = useRef(null)

  // Inquiry search state
  const [showInquirySearch, setShowInquirySearch] = useState(false)
  const [inquiryQuery, setInquiryQuery]           = useState('')
  const [inquiries, setInquiries]                 = useState([])
  const [selectedInquiry, setSelectedInquiry]     = useState(null)

  // Archive feature
  const [archiveView, setArchiveView]           = useState(false)
  const [archivedProjects, setArchivedProjects] = useState([])
  const [archiveSearch, setArchiveSearch]       = useState('')
  const [archiveLoading, setArchiveLoading]     = useState(false)
  // Two-step archive confirmation
  const [archiveStep, setArchiveStep]   = useState(0) // 0=none, 1=dialog1, 2=dialog2
  const [archiveTarget, setArchiveTarget] = useState(null) // project to archive

  const navigate = useNavigate()
  const location = useLocation()

  // On mount or navigation: open archive view if requested, otherwise exit it
  useEffect(() => {
    if (location.state?.showArchive) {
      openArchiveView()
    } else if (archiveView) {
      setArchiveView(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // Archive toast
  const [archiveToast, setArchiveToast]   = useState('')
  const showArchiveToast = (msg) => {
    setArchiveToast(msg)
    setTimeout(() => setArchiveToast(''), 2800)
  }

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

      const { data: stagesData } = await supabase
        .from('stages').select('*').order('order_index')
      if (stagesData) setStages(stagesData)

      const { data: projectsData } = await supabase
        .from('projects')
        .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
        .eq('archived', false)
        .order('created_at', { ascending: false })
      if (projectsData) {
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

      const { data: tasksData } = await supabase
        .from('tasks')
        .select('project_id, status')
        .neq('status', 'הושלם')
      if (tasksData) {
        const grouped = {}
        tasksData.forEach(t => {
          if (!t.project_id) return
          if (!grouped[t.project_id]) grouped[t.project_id] = []
          grouped[t.project_id].push(t.status)
        })
        setTasksByProject(grouped)
      }
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
      .from('projects')
      .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
      .eq('archived', false).order('created_at', { ascending: false })
    if (!error && data) setProjects(data)
  }

  // ── Archive view fetch ──
  const fetchArchivedProjects = async () => {
    setArchiveLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('id, name, archived_at, client_info(city)')
      .eq('archived', true)
      .order('archived_at', { ascending: false })
    setArchivedProjects(data || [])
    setArchiveLoading(false)
  }

  const openArchiveView = () => {
    setArchiveView(true)
    setArchiveSearch('')
    fetchArchivedProjects()
  }

  const closeArchiveView = () => {
    setArchiveView(false)
    setArchivedProjects([])
    setArchiveSearch('')
  }

  // ── Restore archived project ──
  const handleRestoreProject = async (projectId) => {
    const target = archivedProjects.find(p => p.id === projectId)
    const { error } = await supabase
      .from('projects')
      .update({ archived: false, archived_at: null })
      .eq('id', projectId)
    if (!error) {
      setArchivedProjects(prev => prev.filter(p => p.id !== projectId))
      const { data: restored } = await supabase
        .from('projects')
        .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
        .eq('id', projectId)
        .single()
      if (restored) setProjects(prev => [restored, ...prev])
      showArchiveToast(`הפרויקט "${target?.name ?? ''}" שוחזר בהצלחה`)
    }
  }

  // ── Two-step archive flow ──
  const startArchiveFlow = (project) => {
    setArchiveTarget(project)
    setContextMenu(null)
    setArchiveStep(1)
  }

  const handleArchiveStep1Confirm = () => setArchiveStep(2)
  const handleArchiveCancel = () => { setArchiveStep(0); setArchiveTarget(null) }

  const handleArchiveStep2Confirm = async () => {
    if (!archiveTarget) return
    const projectId = archiveTarget.id
    const projectName = archiveTarget.name
    setArchiveStep(0)
    setArchiveTarget(null)
    await supabase.from('tasks').delete().eq('project_id', projectId)
    await supabase.from('projects').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', projectId)
    setProjects(prev => prev.filter(p => p.id !== projectId))
    showArchiveToast(`הפרויקט "${projectName}" הועבר לארכיון בהצלחה`)
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
    const firstStageId = stages.find(s => s.name === 'קליטת פרויקט')?.id ?? stages[0]?.id ?? null
    const { data, error } = await supabase.from('projects')
      .insert([{ name: newName.trim(), responsible_id: newResponsible || null, current_stage: 'קליטת פרויקט', stage_id: firstStageId, stage_entered_at: todayISO(), archived: false }])
      .select().single()
    setAdding(false)
    if (error) { setModalError(`שגיאה: ${error.message}`); return }
    if (!data) return

    const { data: fullProject } = await supabase
      .from('projects')
      .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
      .eq('id', data.id)
      .single()
    const projectToAdd = fullProject || data

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
      setProjects(prev => [projectToAdd, ...prev])
      setShowModal(false)
      navigate('/פרויקטים')
    } else {
      setProjects(prev => [projectToAdd, ...prev])
      setShowModal(false)
    }
  }

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

  const selectInquiry = (inq) => {
    const fullName = [inq.first_name, inq.last_name].filter(Boolean).join(' ')
    setNewName(fullName)
    setSelectedInquiry(inq)
    setShowInquirySearch(false)
    setInquiryQuery('')
  }

  const handleCardRightClick = (e, project) => {
    if (!isAdmin) return
    e.preventDefault()
    const menuW = 180, menuH = 300
    const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
    setCtxResponsible(project.responsible_id || '')
    setContextMenu({ x, y, project })
  }

  const handleToggleFavorite = async () => {
    if (!contextMenu) return
    const next = !contextMenu.project.is_favorite
    await supabase.from('projects').update({ is_favorite: next }).eq('id', contextMenu.project.id)
    setProjects(prev => prev.map(p => p.id === contextMenu.project.id ? { ...p, is_favorite: next } : p))
    setContextMenu(null)
  }

  const handleResponsibleChange = async (value) => {
    if (!contextMenu) return
    const user = users.find(u => u.id === value)
    await supabase.from('projects').update({ responsible_id: value || null }).eq('id', contextMenu.project.id)
    setProjects(prev => prev.map(p => p.id === contextMenu.project.id
      ? { ...p, responsible_id: value || null, profiles: user ? { first_name: user.first_name } : null }
      : p
    ))
    setContextMenu(null)
  }

  const handleDragStart = (e, projectId) => {
    if (userRole !== 'admin') { e.preventDefault(); return }
    setDragId(projectId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e, stageObj) => {
    e.preventDefault()
    if (!dragId) return
    const project = projects.find(p => p.id === dragId)
    if (!project || project.stage_id === stageObj.id) { setDragId(null); return }

    const today     = todayISO()
    const enteredAt = project.stage_entered_at || today
    const days      = daysInStage(enteredAt)

    await supabase.from('project_stage_history').insert([{
      project_id:    project.id,
      stage:         project.current_stage,
      entered_at:    enteredAt,
      exited_at:     today,
      days_in_stage: days,
    }])

    await supabase.from('projects')
      .update({ stage_id: stageObj.id, stage_entered_at: today })
      .eq('id', dragId)

    setProjects(prev => prev.map(p =>
      p.id === dragId
        ? { ...p, stage_id: stageObj.id, stages: { id: stageObj.id, name: stageObj.name, color: stageObj.color }, stage_entered_at: today }
        : p
    ))
    setDragId(null)
  }

  const isAdmin = userRole === 'admin'

  const filteredInquiries = inquiries.filter(inq => {
    if (!inquiryQuery) return true
    const label = [inq.first_name, inq.last_name].filter(Boolean).join(' ') + (inq.city ? ` ${inq.city}` : '')
    return label.includes(inquiryQuery)
  })

  const [filterFavorite, setFilterFavorite]   = useState(false)
  const [filterUrgentTask, setFilterUrgentTask] = useState(false)
  const [filterActiveTask, setFilterActiveTask] = useState(false)

  const [taskModal, setTaskModal] = useState(null)
  const [taskToast, setTaskToast] = useState(false)

  const openTaskModal = (project) => {
    setTaskModal(project)
    setContextMenu(null)
  }

  const handleTaskSaved = async () => {
    setTaskToast(true)
    setTimeout(() => setTaskToast(false), 2500)
    const { data: tasksData } = await supabase.from('tasks').select('project_id, status').neq('status', 'הושלם')
    if (tasksData) {
      const grouped = {}
      tasksData.forEach(t => {
        if (!t.project_id) return
        if (!grouped[t.project_id]) grouped[t.project_id] = []
        grouped[t.project_id].push(t.status)
      })
      setTasksByProject(grouped)
    }
  }

  const isVisible = (project) => {
    if (filterResponsible && project.responsible_id !== filterResponsible) return false
    if (filterFavorite && !project.is_favorite) return false
    if (filterUrgentTask && !tasksByProject[project.id]?.some(s => s === 'דחוף')) return false
    if (filterActiveTask && !tasksByProject[project.id]?.some(s => s === 'פעיל')) return false
    return true
  }

  const filteredArchived = archivedProjects.filter(p =>
    !archiveSearch.trim() || p.name.toLowerCase().includes(archiveSearch.trim().toLowerCase())
  )

  // ── Archive view ──
  if (archiveView) {
    return (
      <div className="page" dir="rtl">
        <div className="kanban-container">
          <div className="kanban-topbar">
            <h1 className="kanban-archive-title">ארכיון פרויקטים</h1>
            <button className="kanban-archive-back-btn" onClick={closeArchiveView}>
              חזור לפרויקטים
            </button>
          </div>

          <div className="kanban-archive-toolbar">
            <input
              className="kanban-archive-search"
              placeholder="חיפוש לפי שם פרויקט..."
              value={archiveSearch}
              onChange={e => setArchiveSearch(e.target.value)}
              dir="rtl"
            />
          </div>

          <div className="kanban-archive-table-wrap">
            {archiveLoading ? (
              <p style={{ textAlign: 'center', color: '#888', padding: 40 }}>טוען...</p>
            ) : (
              <table className="kanban-archive-table" dir="rtl">
                <thead>
                  <tr>
                    <th>שם פרויקט</th>
                    <th>יישוב</th>
                    <th>תאריך העברה</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArchived.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: '#888', padding: 40 }}>אין פרויקטים בארכיון</td></tr>
                  ) : filteredArchived.map(p => (
                    <tr key={p.id}>
                      <td
                        style={{ cursor: 'pointer' }}
                        onDoubleClick={() => navigate(`/projects/${p.id}`, { state: { fromArchive: true } })}
                      >{p.name}</td>
                      <td>{p.client_info?.city || ''}</td>
                      <td>{formatDate(p.archived_at)}</td>
                      <td>
                        <button className="kanban-restore-btn" onClick={() => handleRestoreProject(p.id)}>
                          שחזר
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        {archiveToast && <div className="ktm-toast">{archiveToast}</div>}
      </div>
    )
  }

  return (
    <div className="page" dir="rtl">
      <div className="kanban-container">

        {/* Topbar */}
        <div className="kanban-topbar">
          <span className="kanban-total">סה״כ פרויקטים: {projects.length}</span>
          <div className="kanban-filters">
            <button
              className={'kanban-filter-icon' + (filterFavorite ? ' kanban-filter-icon--active' : '')}
              onClick={() => setFilterFavorite(v => !v)}
              title="מועדפים בלבד"
            >
              <svg width="16" height="16" viewBox="0 0 24 24"
                fill={filterFavorite ? '#F6BF26' : 'none'}
                stroke={filterFavorite ? '#F6BF26' : '#9ca3af'}
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>

            <button
              className={'kanban-filter-icon' + (filterUrgentTask ? ' kanban-filter-icon--active' : '')}
              onClick={() => setFilterUrgentTask(v => !v)}
              title="יש משימות דחופות"
            >
              <svg width="14" height="14" viewBox="0 0 24 24"
                fill={filterUrgentTask ? '#E24B4A' : 'none'}
                stroke="#E24B4A"
                strokeWidth="2.2">
                <circle cx="12" cy="12" r="10"/>
              </svg>
            </button>

            <button
              className={'kanban-filter-icon' + (filterActiveTask ? ' kanban-filter-icon--active' : '')}
              onClick={() => setFilterActiveTask(v => !v)}
              title="יש משימות פעילות"
            >
              <svg width="14" height="14" viewBox="0 0 24 24"
                fill={filterActiveTask ? '#2D3748' : 'none'}
                stroke="#2D3748"
                strokeWidth="2.2">
                <circle cx="12" cy="12" r="10"/>
              </svg>
            </button>

            <select className="kanban-filter-select" value={filterResponsible} onChange={e => setFilterResponsible(e.target.value)}>
              <option value="">אחראית: הכל</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.first_name}</option>
              ))}
            </select>
            <button
              className="kanban-filter-reset"
              onClick={() => {
                setFilterResponsible('')
                setFilterFavorite(false)
                setFilterUrgentTask(false)
                setFilterActiveTask(false)
              }}
            >
              בטל סינון
            </button>
          </div>

          {/* Archive button + separator + add button */}
          <button className="kanban-archive-btn" onClick={openArchiveView}>
            <IconArchive size={14} />
            ארכיון
          </button>
          {isAdmin && <div className="kanban-topbar-sep" />}
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
          <div className="kanban-columns-wrap">
          {stages.map(stage => {
            const bg   = stage.color || '#f0f0f0'
            const text = getTextColor(bg)
            const cards = projects.filter(p => p.stage_id === stage.id)
            return (
              <div
                key={stage.id}
                className={`kanban-column${stage.name === 'השהייה' ? ' kanban-column--narrow' : ''}`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                <div className="kanban-col-header" style={{ background: bg, color: text }}>
                  {stage.name}
                  <span className="kanban-col-count">{cards.length}</span>
                </div>

                <div className="kanban-cards">
                  {cards.map(project => (
                    <div
                      key={project.id}
                      className="kanban-card"
                      draggable={isAdmin}
                      onDragStart={(e) => handleDragStart(e, project.id)}
                      onDoubleClick={() => navigate(`/projects/${project.id}`)}
                      onContextMenu={(e) => handleCardRightClick(e, project)}
                      style={{
                        ...(project.is_favorite ? { border: '2.5px solid #2D3748' } : {}),
                        ...(!isVisible(project) ? { opacity: 0.25, filter: 'grayscale(1)' } : {}),
                      }}
                    >
                      <div className="kanban-card-top-row">
                        <div className="kanban-card-name">{project.name}</div>
                        <div className="kanban-card-days">{daysInStage(project.stage_entered_at)}</div>
                      </div>
                      <div className="kanban-card-meta">
                        {project.profiles?.first_name && (
                          <span className="kanban-card-responsible">
                            {project.profiles.first_name}
                          </span>
                        )}
                      </div>
                      {tasksByProject[project.id]?.length > 0 && (() => {
                        const statuses = tasksByProject[project.id]
                        const dots = statuses.slice(0, 5)
                        const overflow = statuses.length > 5
                        return (
                          <div className="kanban-card-tasks">
                            {dots.map((s, i) => (
                              <span
                                key={i}
                                className="kanban-task-dot"
                                style={{ background: s === 'דחוף' ? '#E24B4A' : '#2D3748' }}
                              />
                            ))}
                            {overflow && <span className="kanban-task-overflow">5+</span>}
                          </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          </div>
        </div>

      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button className="context-menu-favorite-btn" onClick={() => openTaskModal(contextMenu.project)}>
            ＋ פתח משימה חדשה
          </button>
          <div className="context-menu-divider" />
          <button className="context-menu-favorite-btn" onClick={handleToggleFavorite}>
            {contextMenu.project.is_favorite ? '☆ הסר ממועדפים' : '★ הוסף למועדפים'}
          </button>
          <div className="context-menu-divider" />
          <div className="context-menu-row">
            <span className="context-menu-label">אחראית</span>
            <select
              className="context-menu-input"
              value={ctxResponsible}
              onChange={e => handleResponsibleChange(e.target.value)}
            >
              <option value="">ללא</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.first_name}</option>
              ))}
            </select>
          </div>
          {isAdmin && (
            <>
              <div className="context-menu-divider" />
              <button
                className="context-menu-archive-btn"
                onClick={() => startArchiveFlow(contextMenu.project)}
              >
                העבר לארכיון
              </button>
            </>
          )}
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
                <option key={u.id} value={u.id}>{u.first_name}</option>
              ))}
            </select>

            <div style={{ marginTop: 10, position: 'relative' }}>
              {selectedInquiry ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: '#F3F4F6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, color: '#1a1a2e', fontFamily: 'inherit', minHeight: 38, boxSizing: 'border-box' }}>
                  <span style={{ flex: 1 }}>
                    {[selectedInquiry.first_name, selectedInquiry.last_name].filter(Boolean).join(' ')}
                    {selectedInquiry.city ? ` — ${selectedInquiry.city}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedInquiry(null); setShowInquirySearch(false); setInquiryQuery('') }}
                    style={{ background: 'none', border: 'none', fontSize: 16, color: '#9ca3af', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 }}
                  >×</button>
                </div>
              ) : showInquirySearch ? (
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
                          <button key={inq.id} type="button" onClick={() => selectInquiry(inq)}
                            style={{ display: 'block', width: '100%', textAlign: 'right', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid #f0f0f0', fontSize: 13, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseOver={e => e.currentTarget.style.background = '#f3f4f6'}
                            onMouseOut={e => e.currentTarget.style.background = 'none'}
                          >{label}</button>
                        )
                      })}
                    </div>
                  )}
                  {inquiries.length === 0 && (
                    <p style={{ fontSize: 12, color: '#888', margin: '5px 0 0', textAlign: 'right' }}>אין פניות פתוחות</p>
                  )}
                </>
              ) : (
                <button type="button" onClick={() => { setShowInquirySearch(true); loadInquiries() }}
                  style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 7, padding: '6px 14px', fontSize: 13, color: '#888', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
                >+ טען פניה</button>
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

      {/* ── Archive step 1 dialog ── */}
      {archiveStep === 1 && (
        <div className="modal-overlay" onClick={handleArchiveCancel}>
          <div className="kanban-confirm-dialog" onClick={e => e.stopPropagation()} dir="rtl">
            <p className="kanban-confirm-text">כל המשימות של הפרויקט "{archiveTarget?.name}" ימחקו לצמיתות. להמשיך?</p>
            <div className="kanban-confirm-actions">
              <button className="kanban-confirm-yes" onClick={handleArchiveStep1Confirm}>אשר</button>
              <button className="kanban-confirm-no" onClick={handleArchiveCancel}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Archive step 2 dialog ── */}
      {archiveStep === 2 && (
        <div className="modal-overlay" onClick={handleArchiveCancel}>
          <div className="kanban-confirm-dialog" onClick={e => e.stopPropagation()} dir="rtl">
            <p className="kanban-confirm-text">הפרויקט "{archiveTarget?.name}" יועבר לארכיון ולא יהיה ניתן לעריכה. להמשיך?</p>
            <div className="kanban-confirm-actions">
              <button className="kanban-confirm-yes" onClick={handleArchiveStep2Confirm}>אשר</button>
              <button className="kanban-confirm-no" onClick={handleArchiveCancel}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Task Modal ── */}
      {taskModal && (
        <NewTaskModal
          project={taskModal}
          users={users}
          onClose={() => setTaskModal(null)}
          onSaved={handleTaskSaved}
        />
      )}

      {taskToast && (
        <div className="ktm-toast">המשימה נשמרה ✓</div>
      )}

      {archiveToast && (
        <div className="ktm-toast">{archiveToast}</div>
      )}
    </div>
  )
}

export default ProjectsKanban
