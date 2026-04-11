import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import NewTaskModal from './NewTaskModal'
import './Tasks.css'

// ── Constants (kept for display fallbacks) ──
const STATUS_META = {
  'דחוף':  { color: '#E24B4A' },
  'פעיל':  { color: '#F6BF26' },
  'הושלם': { color: '#1D9E75' },
}

function statusColorByName(name) {
  return STATUS_META[name]?.color || STATUS_META['פעיל'].color
}

// ── Icons ──
const IconXCircle = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
)

const IconClock = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
)

const IconCheckCircle = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
)

const IconUser = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

const IconArchive = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8"/>
    <rect x="1" y="3" width="22" height="5"/>
    <line x1="10" y1="12" x2="14" y2="12"/>
  </svg>
)

const IconTrash2 = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
)

function statusIcon(status, size = 18) {
  if (status === 'הושלם') return <IconCheckCircle size={size} />
  return <IconClock size={size} />
}

// ── Status popover (icon-only trigger → fixed popover) ──
function StatusPopover({ statusId, statusName, taskStatuses, onSelect }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, right: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleOpen() {
    if (open) { setOpen(false); return }
    const rect  = triggerRef.current.getBoundingClientRect()
    const popH  = 116
    const below = rect.bottom + 4
    const above = rect.top - popH - 4
    const top   = below + popH > window.innerHeight ? above : below
    setPos({ top, right: window.innerWidth - rect.right })
    setOpen(true)
  }

  const curName = statusName || 'פעיל'

  return (
    <div className="tasks-status-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="tasks-status-trigger"
        style={{ color: statusColorByName(curName) }}
        onClick={handleOpen}
        title={curName}
      >
        {statusIcon(curName)}
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="tasks-status-popover"
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
        >
          {(taskStatuses || []).map(opt => (
            <button
              key={opt.id}
              type="button"
              className={'tasks-status-option' + (opt.id === statusId ? ' tasks-status-option--active' : '')}
              onClick={() => { setOpen(false); onSelect(opt.id, opt.name) }}
            >
              <span style={{ color: statusColorByName(opt.name), display: 'flex', alignItems: 'center' }}>
                {statusIcon(opt.name, 15)}
              </span>
              <span>{opt.name}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Main component ──
export default function Tasks() {
  const [tasks,        setTasks]        = useState([])
  const [projects,     setProjects]     = useState([])
  const [users,        setUsers]        = useState([])
  const [taskStages,   setTaskStages]   = useState([])
  const [taskStatuses, setTaskStatuses] = useState([])
  const [descTooltip,  setDescTooltip]  = useState({ visible: false, text: '', x: 0, y: 0 })
  const [loading,      setLoading]      = useState(true)

  // Archive view
  const [archiveView, setArchiveView] = useState(false)
  const [archiveConfirm,   setArchiveConfirm]   = useState(false)

  // Filters
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterProject,  setFilterProject]  = useState('')
  const [filterStage,    setFilterStage]    = useState('')
  const [filterStatus,   setFilterStatus]   = useState('')

  // Inline editing
  const [editingCell, setEditingCell] = useState(null)
  const [editValue,   setEditValue]   = useState('')

  // Delete confirm popover
  const [confirmDeleteId,  setConfirmDeleteId]  = useState(null)
  const [deletePopoverPos, setDeletePopoverPos] = useState({ top: 0, left: 0 })
  const deletePopoverRef = useRef(null)

  useEffect(() => {
    if (!confirmDeleteId) return
    function handler(e) {
      if (deletePopoverRef.current && !deletePopoverRef.current.contains(e.target)) {
        setConfirmDeleteId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [confirmDeleteId])

  // Restore confirm popover
  const [restoreConfirmId,  setRestoreConfirmId]  = useState(null)
  const [restorePopoverPos, setRestorePopoverPos] = useState({ top: 0, left: 0 })
  const restorePopoverRef = useRef(null)

  useEffect(() => {
    if (!restoreConfirmId) return
    function handler(e) {
      if (restorePopoverRef.current && !restorePopoverRef.current.contains(e.target)) {
        setRestoreConfirmId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [restoreConfirmId])

  const navigate = useNavigate()

  // Current user profile (for auto-filter)
  const [currentUser, setCurrentUser] = useState(null)

  useEffect(() => {
    async function loadUser(session) {
      if (!session?.user) { setCurrentUser(null); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', session.user.id)
        .single()
      if (profile) setCurrentUser({ id: profile.id, role: profile.role })
    }

    supabase.auth.getSession().then(({ data: { session } }) => loadUser(session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      loadUser(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!currentUser) return
    if (currentUser.role === 'employee') {
      setFilterAssignee(currentUser.id)
    } else {
      setFilterAssignee('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role])

  // New task modal
  const [showNewTask,   setShowNewTask]   = useState(false)
  const [taskToast,     setTaskToast]     = useState(false)
  const [accordionOpen, setAccordionOpen] = useState(false) // kept for HMR compatibility

  // ── Fetch ──
  const fetchTasks = useCallback(async (isArchive) => {
    setLoading(true)
    const query = supabase
      .from('tasks')
      .select('*, projects(name), profiles!responsible_id(first_name, last_name), stages!stage_id(id, name), task_statuses!status_id(id, name, color)')
      .order('created_at', { ascending: false })

    const { data: t } = isArchive
      ? await query.eq('archived', true).order('archived_at', { ascending: false })
      : await query.or('archived.eq.false,archived.is.null')

    const result = t || []
    setTasks(isArchive
      ? result.sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at))
      : result
    )
    setLoading(false)
  }, [])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [{ data: p }, { data: u }, { data: stg }, { data: sts }] = await Promise.all([
      supabase.from('projects').select('id, name').order('name'),
      supabase.from('profiles').select('id, first_name, last_name').in('role', ['admin', 'employee']).order('first_name'),
      supabase.from('stages').select('id, name').order('order_index'),
      supabase.from('task_statuses').select('id, name, color').order('id'),
    ])
    setProjects(p || [])
    setUsers(u || [])
    setTaskStages((stg || []).filter(s => s.id !== 9))
    setTaskStatuses(sts || [])
    await fetchTasks(archiveView)
  }, [fetchTasks, archiveView])

  useEffect(() => {
    if (!currentUser) return
    fetchAll()
  }, [fetchAll, currentUser])

  // ── Switch archive view ──
  async function toggleArchiveView() {
    const next = !archiveView
    setArchiveView(next)
    setEditingCell(null)
    setEditValue('')
    setConfirmDeleteId(null)
    setRestoreConfirmId(null)
    setLoading(true)
    const query = supabase
      .from('tasks')
      .select('*, projects(name), profiles!responsible_id(first_name, last_name), stages!stage_id(id, name), task_statuses!status_id(id, name, color)')
      .order('created_at', { ascending: false })
    const { data: t } = next
      ? await query.eq('archived', true).order('archived_at', { ascending: false })
      : await query.or('archived.eq.false,archived.is.null')
    const result = t || []
    setTasks(next
      ? result.sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at))
      : result
    )
    setLoading(false)
  }

  // ── Filtered tasks ──
  const distinctResponsibles = Object.values(
    tasks.reduce((acc, t) => {
      if (t.responsible_id && t.profiles?.first_name && !acc[t.responsible_id]) {
        acc[t.responsible_id] = { id: t.responsible_id, firstName: t.profiles.first_name }
      }
      return acc
    }, {})
  ).sort((a, b) => a.firstName.localeCompare(b.firstName))

  const filtered = tasks.filter(t => {
    if (filterAssignee && t.responsible_id !== filterAssignee) return false
    if (filterProject  && String(t.project_id) !== filterProject) return false
    if (filterStage    && String(t.stage_id) !== filterStage) return false
    if (filterStatus   && String(t.status_id) !== filterStatus) return false
    return true
  })

  const anyFilter = !!(filterAssignee || filterProject || filterStage || filterStatus)

  const completedStatusId = taskStatuses.find(s => s.name === 'הושלם')?.id
  const completedCount = tasks.filter(t => t.status_id === completedStatusId && !t.archived).length

  function clearFilters() {
    setFilterAssignee('')
    setFilterProject('')
    setFilterStage('')
    setFilterStatus('')
  }

  // ── Status update from popover ──
  async function handleStatusChange(taskId, newStatusId, newStatusName) {
    const { error } = await supabase.from('tasks').update({ status_id: newStatusId }).eq('id', taskId)
    if (!error) setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, status_id: newStatusId, task_statuses: { id: newStatusId, name: newStatusName } }
        : t
    ))
  }

  // ── Inline edit ──
  function startEdit(taskId, field, current) {
    setEditingCell({ taskId, field })
    setEditValue(current ?? '')
  }

  async function saveEdit() {
    if (!editingCell) return
    const { taskId, field } = editingCell
    const value = editValue === '' ? null : editValue

    if (field === 'stage_id') {
      const stageId = value ? Number(value) : null
      const { error } = await supabase.from('tasks').update({ stage_id: stageId }).eq('id', taskId)
      if (!error) {
        const stageObj = taskStages.find(s => s.id === stageId)
        setTasks(prev => prev.map(t => t.id === taskId
          ? { ...t, stage_id: stageId, stages: stageObj ? { id: stageObj.id, name: stageObj.name } : null }
          : t
        ))
      }
    } else if (field === 'responsible_id') {
      const { error } = await supabase.from('tasks').update({ responsible_id: value }).eq('id', taskId)
      if (!error) {
        const user = users.find(u => u.id === value)
        setTasks(prev => prev.map(t => t.id === taskId
          ? { ...t, responsible_id: value, profiles: user ? { first_name: user.first_name } : null }
          : t
        ))
      }
    } else {
      const { error } = await supabase.from('tasks').update({ [field]: value }).eq('id', taskId)
      if (!error) setTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t))
    }
    setEditingCell(null)
    setEditValue('')
  }

  function handleEditKey(e) {
    if (e.key === 'Enter')  saveEdit()
    if (e.key === 'Escape') { setEditingCell(null); setEditValue('') }
  }

  // ── Delete ──
  async function doDelete(id) {
    const { error } = await supabase.from('tasks').delete().eq('id', id)
    if (!error) setTasks(prev => prev.filter(t => t.id !== id))
    setConfirmDeleteId(null)
  }

  // ── Archive all completed ──
  async function doArchiveCompleted() {
    setArchiveConfirm(false)
    if (!completedStatusId) return
    const { error } = await supabase
      .from('tasks')
      .update({ archived: true, archived_at: new Date().toISOString() })
      .eq('status_id', completedStatusId)
      .or('archived.eq.false,archived.is.null')
    if (!error) {
      setTasks(prev => prev.filter(t => t.status_id !== completedStatusId))
    }
  }

  // ── Restore task ──
  async function doRestore(id) {
    setRestoreConfirmId(null)
    const activeStatusId = taskStatuses.find(s => s.name === 'פעיל')?.id ?? null
    const updatePayload = { archived: false, archived_at: null }
    if (activeStatusId) updatePayload.status_id = activeStatusId
    const { error } = await supabase.from('tasks').update(updatePayload).eq('id', id)
    if (!error) setTasks(prev => prev.filter(t => t.id !== id))
  }

  // ── New task saved ──
  function handleTaskSaved() {
    setTaskToast(true)
    setTimeout(() => setTaskToast(false), 2500)
    fetchTasks(false)
  }

  // ── Helpers ──
  function formatDate(d) {
    if (!d) return ''
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  // ── Editable cell renderer ──
  function EditCell({ task, field, className, children }) {
    if (archiveView) {
      return <td className={className}>{children}</td>
    }
    const isEditing = editingCell?.taskId === task.id && editingCell?.field === field
    if (isEditing) {
      if (field === 'stage_id') {
        return (
          <td className={className}>
            <select className="tasks-cell-input" value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit} onKeyDown={handleEditKey} autoFocus>
              <option value="">—</option>
              {taskStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </td>
        )
      }
      if (field === 'responsible_id') {
        return (
          <td className={className}>
            <select className="tasks-cell-input" value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit} onKeyDown={handleEditKey} autoFocus>
              <option value="">—</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.first_name}</option>
              ))}
            </select>
          </td>
        )
      }
      if (field === 'due_date') {
        return (
          <td className={className}>
            <input type="date" className="tasks-cell-input" value={editValue || ''}
              onChange={e => setEditValue(e.target.value)}
              onBlur={saveEdit} onKeyDown={handleEditKey} autoFocus />
          </td>
        )
      }
      return (
        <td className={className}>
          <input className="tasks-cell-input" value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={saveEdit} onKeyDown={handleEditKey} autoFocus />
        </td>
      )
    }
    const editInitValue = field === 'stage_id' ? (task.stage_id ?? '') : (task[field] ?? '')
    return (
      <td className={className} onClick={() => startEdit(task.id, field, editInitValue)}>
        {children}
      </td>
    )
  }

  return (
    <div className="tasks-page">
      {/* ── Fixed top ── */}
      <div className="tasks-fixed-top">
        <h1 className="tasks-title">{archiveView ? 'ארכיון משימות' : 'ניהול משימות'}</h1>

        {/* ── Filter bar ── */}
        <div className="tasks-filter-bar">
          {!archiveView && (
            <div className="tasks-filter-selects">
              <div className="tasks-filter-group">
                <span className="tasks-filter-label">אחראית</span>
                <select className="tasks-filter-select" value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}>
                  <option value="">הכל</option>
                  {distinctResponsibles.map(r => <option key={r.id} value={r.id}>{r.firstName}</option>)}
                </select>
              </div>
              <div className="tasks-filter-group">
                <span className="tasks-filter-label">שלב</span>
                <select className="tasks-filter-select" value={filterStage} onChange={e => setFilterStage(e.target.value)}>
                  <option value="">הכל</option>
                  {taskStages.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
              </div>
              <div className="tasks-filter-group">
                <span className="tasks-filter-label">סטטוס</span>
                <select className="tasks-filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">הכל</option>
                  {taskStatuses.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
              </div>
              <div className="tasks-filter-group">
                <span className="tasks-filter-label">פרויקט</span>
                <select className="tasks-filter-select" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
                  <option value="">הכל</option>
                  {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                </select>
              </div>
              <div className="tasks-filter-group tasks-filter-group--reset">
                <button className="tasks-filter-reset" onClick={clearFilters} disabled={!anyFilter}>
                  בטל סינונים
                </button>
              </div>
            </div>
          )}
          <div className="tasks-filter-actions">
            {!archiveView && currentUser && (
              <button
                type="button"
                className={'tasks-my-tasks-btn' + (filterAssignee === currentUser.id ? ' tasks-my-tasks-btn--active' : '')}
                onClick={() => setFilterAssignee(filterAssignee === currentUser.id ? '' : currentUser.id)}
                title="משימות שלי"
              >
                <IconUser size={15} />
              </button>
            )}
            {!archiveView && (
              <button
                className="tasks-archive-btn"
                onClick={() => setArchiveConfirm(true)}
                disabled={completedCount === 0}
              >
                <IconArchive size={14} />
                לארכיון
              </button>
            )}
            <button className="tasks-archive-toggle" onClick={toggleArchiveView}>
              {archiveView ? 'חזור למשימות' : 'תצוגת ארכיון'}
            </button>
            {!archiveView && (
              <button className="tasks-new-btn" onClick={() => setShowNewTask(true)}>
                <span className="tasks-new-btn-icon">+</span>
                משימה חדשה
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Table (full width) ── */}
      <div className="tasks-body">
        <div className="tasks-table-card">
          <div className="tasks-table-scroll">
            <table className="tasks-table">
              <thead>
                <tr>
                  <th className="tasks-col-status"></th>
                  <th className="tasks-col-project">פרויקט</th>
                  <th className="tasks-col-stage">שלב</th>
                  <th className="tasks-col-desc">תיאור</th>
                  <th className="tasks-col-assignee">אחראית</th>
                  <th className="tasks-col-date">תאריך יעד</th>
                  <th className="tasks-col-notes">הערות</th>
                  <th className="tasks-col-delete"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ display: 'block' }}><p className="tasks-empty">טוען...</p></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} style={{ display: 'block' }}><p className="tasks-empty">אין משימות להצגה</p></td></tr>
                ) : filtered.map((task) => {
                  const taskStatusName = task.task_statuses?.name || task.status || 'פעיל'
                  const isUrgent = taskStatusName === 'דחוף'
                  return (
                    <tr
                      key={task.id}
                      className={`tasks-row${isUrgent ? ' tasks-row--urgent' : ''}`}
                    >
                      {/* Status icon */}
                      <td className="tasks-col-status" onClick={e => e.stopPropagation()}>
                        {archiveView ? (
                          <div className="tasks-status-wrap">
                            <span style={{ color: statusColorByName(taskStatusName), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {statusIcon(taskStatusName)}
                            </span>
                          </div>
                        ) : (
                          <StatusPopover
                            statusId={task.status_id}
                            statusName={taskStatusName}
                            taskStatuses={taskStatuses}
                            onSelect={(id, name) => handleStatusChange(task.id, id, name)}
                          />
                        )}
                      </td>

                      <td className="tasks-col-project" onDoubleClick={() => navigate(`/projects/${task.project_id}`, { state: { from: 'tasks' } })} style={{ cursor: 'default' }}>
                        <span className="tasks-cell-value">{task.projects?.name || task.project_name || ''}</span>
                      </td>

                      <EditCell task={task} field="stage_id" className="tasks-col-stage">
                        <span className="tasks-cell-value">{task.stages?.name || task.stage || ''}</span>
                      </EditCell>

                      <EditCell task={task} field="description" className="tasks-col-desc">
                        <span
                          className="tasks-cell-value"
                          onMouseEnter={e => task.description && setDescTooltip({ visible: true, text: task.description, x: e.clientX, y: e.clientY })}
                          onMouseMove={e => setDescTooltip(t => ({ ...t, x: e.clientX, y: e.clientY }))}
                          onMouseLeave={() => setDescTooltip(t => ({ ...t, visible: false }))}
                        >{task.description || ''}</span>
                      </EditCell>

                      <EditCell task={task} field="responsible_id" className="tasks-col-assignee">
                        <span className="tasks-cell-value">{task.profiles?.first_name || ''}</span>
                      </EditCell>

                      <EditCell task={task} field="due_date" className="tasks-col-date">
                        <span className="tasks-cell-value">{formatDate(task.due_date)}</span>
                      </EditCell>

                      <EditCell task={task} field="notes" className="tasks-col-notes">
                        <span className="tasks-cell-value">{task.notes || ''}</span>
                      </EditCell>

                      <td className="tasks-col-delete" onClick={e => e.stopPropagation()}>
                        {archiveView ? (
                          <button
                            className="tasks-restore-btn"
                            title="שחזר משימה"
                            onClick={e => {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setRestorePopoverPos({ top: rect.bottom + 4, left: rect.left })
                              setRestoreConfirmId(task.id)
                            }}
                          >
                            ↩
                          </button>
                        ) : (
                          <button
                            className="tasks-delete-btn"
                            onClick={e => {
                              const rect = e.currentTarget.getBoundingClientRect()
                              setDeletePopoverPos({ top: rect.bottom + 4, left: rect.left })
                              setConfirmDeleteId(task.id)
                            }}
                          >
                            <IconTrash2 />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Archive confirm dialog ── */}
      {archiveConfirm && (
        <div className="ktm-overlay" onClick={() => setArchiveConfirm(false)}>
          <div className="tasks-confirm-dialog" onClick={e => e.stopPropagation()} dir="rtl">
            <p className="tasks-confirm-text">האם להעביר {completedCount} משימות שהושלמו לארכיון?</p>
            <div className="tasks-confirm-actions">
              <button className="tasks-delete-yes" style={{ padding: '6px 18px', fontSize: 13 }} onClick={doArchiveCompleted}>העבר לארכיון</button>
              <button className="tasks-delete-no" style={{ padding: '6px 14px', fontSize: 13 }} onClick={() => setArchiveConfirm(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm popover ── */}
      {confirmDeleteId && createPortal(
        <div
          ref={deletePopoverRef}
          className="tasks-delete-popover"
          style={{ position: 'fixed', top: deletePopoverPos.top, left: deletePopoverPos.left, zIndex: 9999 }}
          dir="rtl"
        >
          <span className="tasks-delete-popover-text">מחק משימה?</span>
          <button className="tasks-delete-yes" onClick={() => doDelete(confirmDeleteId)}>מחק</button>
          <button className="tasks-delete-no" onClick={() => setConfirmDeleteId(null)}>ביטול</button>
        </div>,
        document.body
      )}

      {/* ── Restore confirm popover ── */}
      {restoreConfirmId && createPortal(
        <div
          ref={restorePopoverRef}
          className="tasks-delete-popover"
          style={{ position: 'fixed', top: restorePopoverPos.top, left: restorePopoverPos.left, zIndex: 9999 }}
          dir="rtl"
        >
          <span className="tasks-delete-popover-text">לשחזר משימה?</span>
          <button className="tasks-delete-yes" onClick={() => doRestore(restoreConfirmId)}>אשר</button>
          <button className="tasks-delete-no" onClick={() => setRestoreConfirmId(null)}>ביטול</button>
        </div>,
        document.body
      )}

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onSaved={handleTaskSaved}
        />
      )}

      {taskToast && (
        <div className="ktm-toast">המשימה נשמרה ✓</div>
      )}

      {descTooltip.visible && createPortal(
        <div style={{
          position: 'fixed', top: descTooltip.y + 14, left: descTooltip.x + 14,
          background: '#1a1a18', color: '#fff', padding: '5px 10px',
          borderRadius: 4, fontSize: 13, zIndex: 9999, pointerEvents: 'none',
          maxWidth: 360, whiteSpace: 'pre-wrap', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          fontFamily: 'Heebo, sans-serif', lineHeight: 1.4,
        }}>
          {descTooltip.text}
        </div>,
        document.body
      )}
    </div>
  )
}
