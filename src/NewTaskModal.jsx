import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import './NewTaskModal.css'

const TASK_STAGES = ['סקיצות', 'הדמיה', 'הכנת גרמושקה', 'רישוי', 'תוכניות עבודה', 'בניה', 'גמר']
const TASK_STAGE_COLORS = {
  'סקיצות':          { bg: '#e8e197', text: '#000' },
  'הדמיה':           { bg: '#cbc9a2', text: '#000' },
  'הכנת גרמושקה':    { bg: '#73946e', text: '#fff' },
  'רישוי':           { bg: '#7bc1b5', text: '#000' },
  'תוכניות עבודה':   { bg: '#676977', text: '#fff' },
  'בניה':            { bg: '#89748b', text: '#fff' },
  'גמר':             { bg: '#87526d', text: '#fff' },
}

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

  // Employees — fetched on mount
  const [employees, setEmployees] = useState([])

  // Task fields — responsible stored as UUID (responsible_id)
  const [taskStage,          setTaskStage]          = useState(editTask?.stage        || initialProject?.current_stage || '')
  const [taskResponsibleId,  setTaskResponsibleId]  = useState(editTask?.responsible_id || null)
  const [taskStatus,         setTaskStatus]         = useState(editTask?.status       || 'פעיל')
  const [taskDueDate,        setTaskDueDate]        = useState(editTask?.due_date     || '')
  const [taskDescription,    setTaskDescription]    = useState(editTask?.description  || '')
  const [taskNotes,          setTaskNotes]          = useState(editTask?.notes        || '')
  const [saving,             setSaving]             = useState(false)

  // Fetch employees on mount
  useEffect(() => {
    supabase
      .from('profiles')
      .select('id, first_name, last_name')
      .in('role', ['admin', 'employee'])
      .order('first_name')
      .then(({ data }) => setEmployees(data || []))
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
    setTaskStage(p.current_stage || '')
  }

  function clear() {
    if (isEdit) {
      setTaskStage(editTask.stage || '')
      setTaskResponsibleId(editTask.responsible_id || null)
      setTaskStatus(editTask.status || 'פעיל')
      setTaskDueDate(editTask.due_date || '')
      setTaskDescription(editTask.description || '')
      setTaskNotes(editTask.notes || '')
    } else {
      if (!isReadOnly) {
        setProjectQuery('')
        setSelectedProject(null)
        setProjectResults([])
      }
      setTaskStage(initialProject?.current_stage || '')
      setTaskResponsibleId(null)
      setTaskStatus('פעיל')
      setTaskDueDate('')
      setTaskDescription('')
      setTaskNotes('')
    }
  }

  async function handleSave() {
    setSaving(true)

    if (isEdit) {
      const { error } = await supabase.from('tasks').update({
        stage:          taskStage          || null,
        responsible_id: taskResponsibleId  || null,
        status:         taskStatus,
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
        stage:          taskStage          || null,
        responsible_id: taskResponsibleId  || null,
        status:         taskStatus,
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
  const statusOptions = ['פעיל', 'דחוף', 'הושלם']

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
            {TASK_STAGES.map(s => {
              const { bg, text } = TASK_STAGE_COLORS[s]
              const sel = taskStage === s
              return (
                <button
                  key={s}
                  className={'ktm-pill ktm-pill--stage' + (sel ? ' ktm-pill--selected' : '')}
                  style={{ background: bg, color: text, borderColor: sel ? '#000' : 'transparent' }}
                  onClick={() => setTaskStage(s)}
                >{s}</button>
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
              {statusOptions.map(s => {
                const isHoshlam = s === 'הושלם'
                const disabled = isHoshlam && !isEdit
                return (
                  <button
                    key={s}
                    className={'ktm-pill' + (taskStatus === s ? ' ktm-pill--selected' : '') + (disabled ? ' ktm-pill--disabled' : '')}
                    onClick={() => { if (!disabled) setTaskStatus(s) }}
                    disabled={disabled}
                  >{s}</button>
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
