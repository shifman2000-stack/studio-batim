import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import './NewTaskModal.css'

// Props:
//   project   — kanban project object → insert mode, read-only project
//   editTask  — existing task object  → edit mode, read-only project
//   (neither) — Tasks page new task  → insert mode, autocomplete project
export default function NewTaskModal({ project: initialProject, editTask, onClose, onSaved }) {
  const isEdit     = !!editTask
  const isReadOnly = !!initialProject || isEdit

  // Autocomplete state (only when not read-only)
  const [projectQuery,    setProjectQuery]    = useState('')
  const [projectResults,  setProjectResults]  = useState([])
  const [selectedProject, setSelectedProject] = useState(null)
  const [searchOpen,      setSearchOpen]      = useState(false)
  const searchRef = useRef(null)

  // LUT data
  const [stages,   setStages]   = useState([])
  const [statuses, setStatuses] = useState([])

  // Employees — fetched on mount
  const [employees, setEmployees] = useState([])

  // Task fields
  const [taskStageId,       setTaskStageId]       = useState(editTask?.stage_id        ?? null)
  const [taskResponsibleId, setTaskResponsibleId] = useState(editTask?.responsible_id  ?? null)
  const [taskStatusId,      setTaskStatusId]      = useState(editTask?.status_id       ?? null)
  const [taskDueDate,       setTaskDueDate]        = useState(editTask?.due_date        || '')
  const [taskDescription,   setTaskDescription]   = useState(editTask?.description     || '')
  const [taskNotes,         setTaskNotes]          = useState(editTask?.notes           || '')
  const [saving,            setSaving]             = useState(false)

  // Fetch LUTs + employees on mount
  useEffect(() => {
    const load = async () => {
      const [{ data: stg }, { data: sts }, { data: emp }] = await Promise.all([
        supabase.from('stages').select('id, name, color').order('order_index'),
        supabase.from('task_statuses').select('id, name, color').order('id'),
        supabase.from('profiles').select('id, first_name, last_name').in('role', ['admin', 'employee']).order('first_name'),
      ])
      // Exclude קליטת פרויקט (id=1) and השהייה (id=9)
      setStages((stg || []).filter(s => s.id !== 1 && s.id !== 9))
      setStatuses(sts || [])
      setEmployees(emp || [])

      // Set default status to 'פעיל' if not in edit mode
      if (!isEdit && !taskStatusId) {
        const activeStatus = (sts || []).find(s => s.name === 'פעיל')
        if (activeStatus) setTaskStatusId(activeStatus.id)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autocomplete search with debounce
  useEffect(() => {
    if (isReadOnly) return
    if (!projectQuery.trim()) { setProjectResults([]); setSearchOpen(false); return }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, current_stage')
        .ilike('name', `%${projectQuery}%`)
        .eq('archived', false)
        .limit(8)
      setProjectResults(data || [])
      setSearchOpen((data || []).length > 0)
    }, 180)
    return () => clearTimeout(t)
  }, [projectQuery, isReadOnly])

  // Close dropdown on outside click
  useEffect(() => {
    if (!searchOpen) return
    function handler(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [searchOpen])

  function selectProject(p) {
    setSelectedProject(p)
    setProjectQuery(p.name)
    setProjectResults([])
    setSearchOpen(false)
  }

  function clear() {
    if (isEdit) {
      setTaskStageId(editTask.stage_id ?? null)
      setTaskResponsibleId(editTask.responsible_id ?? null)
      setTaskStatusId(editTask.status_id ?? null)
      setTaskDueDate(editTask.due_date || '')
      setTaskDescription(editTask.description || '')
      setTaskNotes(editTask.notes || '')
    } else {
      if (!isReadOnly) {
        setProjectQuery('')
        setSelectedProject(null)
        setProjectResults([])
      }
      setTaskStageId(null)
      setTaskResponsibleId(null)
      const activeStatus = statuses.find(s => s.name === 'פעיל')
      setTaskStatusId(activeStatus?.id ?? null)
      setTaskDueDate('')
      setTaskDescription('')
      setTaskNotes('')
    }
  }

  async function handleSave() {
    setSaving(true)

    if (isEdit) {
      const { error } = await supabase.from('tasks').update({
        stage_id:       taskStageId        ?? null,
        responsible_id: taskResponsibleId  ?? null,
        status_id:      taskStatusId       ?? null,
        due_date:       taskDueDate        || null,
        description:    taskDescription    || null,
        notes:          taskNotes          || null,
      }).eq('id', editTask.id)
      setSaving(false)
      if (error) { alert(`שגיאה בשמירה: ${error.message}`); return }
    } else {
      const proj = isReadOnly ? initialProject : selectedProject
      if (!proj) { setSaving(false); return }
      const payload = {
        project_id:     proj.id,
        project_name:   proj.name,
        stage_id:       taskStageId        ?? null,
        responsible_id: taskResponsibleId  ?? null,
        status_id:      taskStatusId       ?? null,
        due_date:       taskDueDate        || null,
        description:    taskDescription    || null,
        notes:          taskNotes          || null,
        hours:          null,
      }
      const { error } = await supabase.from('tasks').insert([payload]).select()
      setSaving(false)
      if (error) { alert(`שגיאה בשמירה: ${error.message}`); return }
    }

    onClose()
    if (onSaved) onSaved()
  }

  const projectName = isEdit
    ? (editTask.project_name || '')
    : (initialProject?.name || '')

  const proj = isReadOnly ? (initialProject || editTask) : selectedProject

  const completedStatusId = statuses.find(s => s.name === 'הושלם')?.id

  return (
    <div className="ktm-overlay" onClick={onClose}>
      <div className="ktm-modal" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="ktm-header">
          <span className="ktm-title">{isEdit ? 'עריכת משימה' : 'משימה חדשה'}</span>
          <button className="ktm-close" onClick={onClose}>✕</button>
        </div>

        {/* Row 1 — project */}
        <div className="ktm-row">
          <label className="ktm-label">פרויקט</label>
          {isReadOnly ? (
            <div className="ktm-project-name">{projectName}</div>
          ) : (
            <div className="ktm-project-search" ref={searchRef}>
              <input
                className="ktm-project-input"
                placeholder="חפש שם פרויקט..."
                value={projectQuery}
                onChange={e => { setProjectQuery(e.target.value); setSelectedProject(null) }}
                autoFocus
              />
              {searchOpen && (
                <div className="ktm-project-dropdown">
                  {projectResults.map(p => (
                    <button key={p.id} className="ktm-project-option" onClick={() => selectProject(p)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Row 2 — stage pills */}
        <div className="ktm-row">
          <label className="ktm-label">שלב</label>
          <div className="ktm-pills ktm-pills--nowrap">
            {stages.map(s => {
              const sel = taskStageId === s.id
              return (
                <button
                  key={s.id}
                  className={'ktm-pill ktm-pill--stage' + (sel ? ' ktm-pill--selected' : '')}
                  style={{ background: s.color || '#e0e0e0', color: '#000', borderColor: sel ? '#000' : 'transparent' }}
                  onClick={() => setTaskStageId(s.id)}
                >{s.name}</button>
              )
            })}
          </div>
        </div>

        {/* Row 3 — assignee / status / date */}
        <div className="ktm-row ktm-row--inline">
          <div className="ktm-inline-group">
            <label className="ktm-label">אחראית</label>
            <div className="ktm-pills">
              {employees.map(emp => {
                const sel = taskResponsibleId === emp.id
                return (
                  <button
                    key={emp.id}
                    className={'ktm-pill' + (sel ? ' ktm-pill--selected' : '')}
                    onClick={() => setTaskResponsibleId(emp.id)}
                  >{emp.first_name}</button>
                )
              })}
            </div>
          </div>
          <div className="ktm-inline-group">
            <label className="ktm-label">סטטוס</label>
            <div className="ktm-pills">
              {statuses.map(s => {
                const isCompleted = s.id === completedStatusId
                const disabled = isCompleted && !isEdit
                return (
                  <button
                    key={s.id}
                    className={'ktm-pill' + (taskStatusId === s.id ? ' ktm-pill--selected' : '') + (disabled ? ' ktm-pill--disabled' : '')}
                    onClick={() => { if (!disabled) setTaskStatusId(s.id) }}
                    disabled={disabled}
                  >{s.name}</button>
                )
              })}
            </div>
          </div>
          <div className="ktm-inline-group">
            <label className="ktm-label">תאריך יעד</label>
            <input
              type="date"
              className="ktm-date"
              value={taskDueDate}
              onChange={e => setTaskDueDate(e.target.value)}
            />
          </div>
        </div>

        {/* Row 4 — description */}
        <div className="ktm-row">
          <label className="ktm-label">תיאור משימה</label>
          <textarea
            className="ktm-textarea"
            value={taskDescription}
            onChange={e => setTaskDescription(e.target.value)}
            placeholder="תיאור..."
            rows={3}
          />
        </div>

        {/* Row 5 — notes */}
        <div className="ktm-row">
          <label className="ktm-label">הערות</label>
          <textarea
            className="ktm-textarea"
            value={taskNotes}
            onChange={e => setTaskNotes(e.target.value)}
            placeholder="הערות..."
            rows={2}
          />
        </div>

        {/* Footer */}
        <div className="ktm-footer">
          <button className="ktm-btn-save" onClick={handleSave} disabled={saving || (!isEdit && !proj)}>
            {saving ? '...' : 'שמירה'}
          </button>
          <button className="ktm-btn-cancel" onClick={onClose}>ביטול</button>
          <button className="ktm-btn-clear" onClick={clear}>נקה</button>
        </div>
      </div>
    </div>
  )
}
