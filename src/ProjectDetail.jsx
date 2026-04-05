import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase } from './supabaseClient'
import ProfessionalModal from './components/professionals/ProfessionalModal'
import DocumentsTab from './components/documents/DocumentsTab'
import TasksTab from './components/tasks/TasksTab'
import NewTaskModal from './NewTaskModal'
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

// ── Tasks tab constants ──
const PD_STAGES = [
  'קליטת פרויקט', 'סקיצות', 'הדמיה', 'גרמושקה', 'רישוי',
  'תכניות עבודה', 'בניה', 'גמר',
]
const PD_STATUSES = ['דחוף', 'פעיל', 'הושלם']
const PD_STATUS_META = {
  'דחוף':  { color: '#E24B4A' },
  'פעיל':  { color: '#F6BF26' },
  'הושלם': { color: '#1D9E75' },
}

const PdIconClock = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
)
const PdIconCheckCircle = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
)
const PdIconTrash2 = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
)

function pdStatusIcon(status, size = 18) {
  if (status === 'הושלם') return <PdIconCheckCircle size={size} />
  return <PdIconClock size={size} />
}

function PdStatusPopover({ status, onSelect }) {
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

  const cur = PD_STATUS_META[status] ? status : 'פעיל'

  return (
    <div className="tasks-status-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="tasks-status-trigger"
        style={{ color: PD_STATUS_META[cur].color }}
        onClick={handleOpen}
        title={cur}
      >
        {pdStatusIcon(cur)}
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          className="tasks-status-popover"
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
        >
          {PD_STATUSES.map(opt => (
            <button
              key={opt}
              type="button"
              className={'tasks-status-option' + (opt === cur ? ' tasks-status-option--active' : '')}
              onClick={() => { setOpen(false); onSelect(opt) }}
            >
              <span style={{ color: PD_STATUS_META[opt].color, display: 'flex', alignItems: 'center' }}>
                {pdStatusIcon(opt, 15)}
              </span>
              <span>{opt}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

const TABS = [
  { id: 5, label: 'משימות' },
  { id: 1, label: 'פרטי תיק' },
  { id: 3, label: 'מעקב שלבי התקדמות' },
  { id: 2, label: 'מעקב מסמכים' },
  { id: 6, label: 'כתב כמויות', disabled: true },
  { id: 7, label: 'חומרי גמר', disabled: true },
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
function InlineField({ value, onSave, placeholder = '', type = 'text', multiline = false, readOnly = false }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(value ?? '')

  useEffect(() => { setVal(value ?? '') }, [value])

  if (editing && !readOnly) {
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
      onClick={() => { if (!readOnly) setEditing(true) }}
      style={readOnly ? { cursor: 'default' } : {}}
    >
      {val || placeholder}
    </span>
  )
}

/* ── Main component ── */
function ProjectDetail() {
  const { id }      = useParams()
  const navigate    = useNavigate()
  const location    = useLocation()
  const fromTasks   = location.state?.from === 'tasks'
  const fromArchive = location.state?.fromArchive === true

  const [project, setProject]       = useState(null)
  const [activeTab, setActiveTab]   = useState(1)
  const [contacts, setContacts]     = useState([])
  const [clientInfo, setClientInfo] = useState(null)

  /* professionals list */
  const [profList, setProfList] = useState([])

  /* shared professional modal */
  const [profModalOpen, setProfModalOpen]       = useState(false)
  const [profModalEditRow, setProfModalEditRow] = useState(null)

  /* selection popover */
  const [selectionPopover, setSelectionPopover] = useState(null)

  // ── Tasks tab state ──
  const [pdTasks,    setPdTasks]    = useState([])
  const [pdUsers,    setPdUsers]    = useState([])
  const [pdLoading,  setPdLoading]  = useState(false)
  const [pdFilterAssignee, setPdFilterAssignee] = useState('')
  const [pdFilterStage,    setPdFilterStage]    = useState('')
  const [pdFilterStatus,   setPdFilterStatus]   = useState('')
  const [pdEditingCell, setPdEditingCell] = useState(null)
  const [pdEditValue,   setPdEditValue]   = useState('')
  const [pdConfirmDeleteId,  setPdConfirmDeleteId]  = useState(null)
  const [pdDeletePopoverPos, setPdDeletePopoverPos] = useState({ top: 0, left: 0 })
  const pdDeletePopoverRef = useRef(null)
  const [pdShowNewTask, setPdShowNewTask] = useState(false)
  const [pdTaskToast,   setPdTaskToast]   = useState(false)

  /* ── fetch project ── */
  useEffect(() => {
    const fetchProject = async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, current_stage, is_favorite')
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

  /* ── delete popover click-outside ── */
  useEffect(() => {
    if (!pdConfirmDeleteId) return
    function handler(e) {
      if (pdDeletePopoverRef.current && !pdDeletePopoverRef.current.contains(e.target)) {
        setPdConfirmDeleteId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pdConfirmDeleteId])

  /* ── tasks tab fetch ── */
  useEffect(() => {
    if (activeTab !== 5) return
    const load = async () => {
      setPdLoading(true)
      const [{ data: t }, { data: u }] = await Promise.all([
        supabase
          .from('tasks')
          .select('*, profiles!responsible_id(first_name)')
          .eq('project_id', id)
          .or('archived.eq.false,archived.is.null')
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, first_name')
          .in('role', ['admin', 'employee'])
          .order('first_name'),
      ])
      setPdTasks(t || [])
      setPdUsers(u || [])
      setPdLoading(false)
    }
    load()
  }, [activeTab, id])

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
      const role = PROF_ROLES.find(r => r.profession === row.profession)
      if (role && !clientInfo?.[role.idField]) {
        await saveClientInfo(role.idField, row.id)
      }
    } else {
      setProfList(prev => prev.map(p => p.id === row.id ? slim : p))
    }
    closeProfModal()
  }

  const handleProfDeleted = async (profId) => {
    setProfList(prev => prev.filter(p => p.id !== profId))
    const clearedFields = {}
    PROF_ROLES.forEach(role => {
      if (clientInfo?.[role.idField] === profId) clearedFields[role.idField] = null
    })
    if (Object.keys(clearedFields).length > 0 && clientInfo?.id) {
      await supabase.from('client_info').update(clearedFields).eq('id', clientInfo.id)
      setClientInfo(prev => ({ ...prev, ...clearedFields }))
    }
    closeProfModal()
  }

  /* ── Tasks tab handlers ── */
  async function handlePdStatusChange(taskId, newStatus) {
    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId)
    if (!error) setPdTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
  }

  function pdStartEdit(taskId, field, current) {
    setPdEditingCell({ taskId, field })
    setPdEditValue(current ?? '')
  }

  async function pdSaveEdit() {
    if (!pdEditingCell) return
    const { taskId, field } = pdEditingCell
    const value = pdEditValue === '' ? null : pdEditValue
    const { error } = await supabase.from('tasks').update({ [field]: value }).eq('id', taskId)
    if (!error) {
      if (field === 'responsible_id') {
        const user = pdUsers.find(u => u.id === value)
        setPdTasks(prev => prev.map(t => t.id === taskId
          ? { ...t, responsible_id: value, profiles: user ? { first_name: user.first_name } : null }
          : t
        ))
      } else {
        setPdTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t))
      }
    }
    setPdEditingCell(null)
    setPdEditValue('')
  }

  function pdHandleEditKey(e) {
    if (e.key === 'Enter')  pdSaveEdit()
    if (e.key === 'Escape') { setPdEditingCell(null); setPdEditValue('') }
  }

  async function pdDoDelete(taskId) {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (!error) setPdTasks(prev => prev.filter(t => t.id !== taskId))
    setPdConfirmDeleteId(null)
  }

  function pdHandleTaskSaved() {
    setPdTaskToast(true)
    setTimeout(() => setPdTaskToast(false), 2500)
    supabase
      .from('tasks')
      .select('*, profiles!responsible_id(first_name)')
      .eq('project_id', id)
      .or('archived.eq.false,archived.is.null')
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setPdTasks(data) })
  }

  function pdFormatDate(d) {
    if (!d) return ''
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  /* ── Favorite toggle ── */
  const toggleFavorite = async () => {
    const next = !project?.is_favorite
    setProject(prev => ({ ...prev, is_favorite: next }))
    await supabase.from('projects').update({ is_favorite: next }).eq('id', id)
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

  // ── Tasks tab computed values ──
  const pdDistinctResponsibles = Object.values(
    pdTasks.reduce((acc, t) => {
      if (t.responsible_id && t.profiles?.first_name && !acc[t.responsible_id]) {
        acc[t.responsible_id] = { id: t.responsible_id, firstName: t.profiles.first_name }
      }
      return acc
    }, {})
  ).sort((a, b) => a.firstName.localeCompare(b.firstName))

  const pdFiltered = pdTasks.filter(t => {
    if (pdFilterAssignee && t.responsible_id !== pdFilterAssignee) return false
    if (pdFilterStage    && t.stage !== pdFilterStage) return false
    if (pdFilterStatus   && t.status !== pdFilterStatus) return false
    return true
  })

  const pdAnyFilter = !!(pdFilterAssignee || pdFilterStage || pdFilterStatus)

  // ── Tasks tab inline edit cell ──
  function PdEditCell({ task, field, className, children }) {
    const isEditing = pdEditingCell?.taskId === task.id && pdEditingCell?.field === field
    if (isEditing) {
      if (field === 'stage') {
        return (
          <td className={className}>
            <select className="tasks-cell-input" value={pdEditValue}
              onChange={e => setPdEditValue(e.target.value)}
              onBlur={pdSaveEdit} onKeyDown={pdHandleEditKey} autoFocus>
              <option value="">—</option>
              {PD_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </td>
        )
      }
      if (field === 'responsible_id') {
        return (
          <td className={className}>
            <select className="tasks-cell-input" value={pdEditValue}
              onChange={e => setPdEditValue(e.target.value)}
              onBlur={pdSaveEdit} onKeyDown={pdHandleEditKey} autoFocus>
              <option value="">—</option>
              {pdUsers.map(u => (
                <option key={u.id} value={u.id}>{u.first_name}</option>
              ))}
            </select>
          </td>
        )
      }
      if (field === 'due_date') {
        return (
          <td className={className}>
            <input type="date" className="tasks-cell-input" value={pdEditValue || ''}
              onChange={e => setPdEditValue(e.target.value)}
              onBlur={pdSaveEdit} onKeyDown={pdHandleEditKey} autoFocus />
          </td>
        )
      }
      return (
        <td className={className}>
          <input className="tasks-cell-input" value={pdEditValue}
            onChange={e => setPdEditValue(e.target.value)}
            onBlur={pdSaveEdit} onKeyDown={pdHandleEditKey} autoFocus />
        </td>
      )
    }
    return (
      <td className={className} onClick={() => pdStartEdit(task.id, field, task[field])}>
        {children}
      </td>
    )
  }

  return (
    <div className="pd-page" dir="rtl">

      {/* ── Header ── */}
      <div className="pd-header">
        <div className="pd-header-left">
          <h1 className="pd-title">{project ? project.name : '…'}</h1>
          {project && !fromArchive && (
            <button className="pd-star-btn" onClick={toggleFavorite} title={project.is_favorite ? 'הסר מהמועדפים' : 'הוסף למועדפים'}>
              {project.is_favorite ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#F6BF26" stroke="#F6BF26" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              )}
            </button>
          )}
          {fromArchive ? (
            <span className="pd-stage-badge" style={{ background: '#E24B4A', color: '#fff' }}>
              ארכיון
            </span>
          ) : (
            project?.current_stage && stageColor && (
              <span className="pd-stage-badge" style={{ background: stageColor.bg, color: stageColor.text }}>
                {project.current_stage}
              </span>
            )
          )}
        </div>
        {fromArchive ? (
          <button className="pd-back-btn" onClick={() => navigate('/פרויקטים', { state: { showArchive: true } })}>
            ← חזור לארכיון
          </button>
        ) : fromTasks ? (
          <button className="pd-back-btn" onClick={() => navigate('/tasks')}>
            ← חזור לניהול משימות
          </button>
        ) : (
          <button className="pd-back-btn" onClick={() => navigate('/פרויקטים')}>
            ← חזרה לפרויקטים
          </button>
        )}
      </div>

      {/* ── Archive read-only banner ── */}
      {fromArchive && (
        <div className="pd-archive-banner">
          פרויקט בארכיון — מצב קריאה בלבד
        </div>
      )}

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

      {/* ── Tab content ── */}
      <div className={`pd-tab-content${activeTab === 5 ? ' pd-tab-content--tasks' : ''}`}>

        {/* ── Tab 5 — משימות ── */}
        {activeTab === 5 && (
          <div className="pd-tasks-tab">
            <div className="tasks-filter-bar">
              <div className="tasks-filter-selects">
                <div className="tasks-filter-group">
                  <span className="tasks-filter-label">אחראית</span>
                  <select className="tasks-filter-select" value={pdFilterAssignee} onChange={e => setPdFilterAssignee(e.target.value)}>
                    <option value="">הכל</option>
                    {pdDistinctResponsibles.map(r => <option key={r.id} value={r.id}>{r.firstName}</option>)}
                  </select>
                </div>
                <div className="tasks-filter-group">
                  <span className="tasks-filter-label">שלב</span>
                  <select className="tasks-filter-select" value={pdFilterStage} onChange={e => setPdFilterStage(e.target.value)}>
                    <option value="">הכל</option>
                    {PD_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="tasks-filter-group">
                  <span className="tasks-filter-label">סטטוס</span>
                  <select className="tasks-filter-select" value={pdFilterStatus} onChange={e => setPdFilterStatus(e.target.value)}>
                    <option value="">הכל</option>
                    {PD_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="tasks-filter-group tasks-filter-group--reset">
                  <button
                    className="tasks-filter-reset"
                    onClick={() => { setPdFilterAssignee(''); setPdFilterStage(''); setPdFilterStatus('') }}
                    disabled={!pdAnyFilter}
                  >
                    בטל סינונים
                  </button>
                </div>
              </div>
              <div className="tasks-filter-actions">
                <button className="tasks-new-btn" onClick={() => setPdShowNewTask(true)}>
                  <span className="tasks-new-btn-icon">+</span>
                  משימה חדשה
                </button>
              </div>
            </div>

            <div className="tasks-table-card">
              <div className="tasks-table-scroll">
                <table className="tasks-table">
                  <thead>
                    <tr>
                      <th className="tasks-col-status"></th>
                      <th className="tasks-col-stage">שלב</th>
                      <th className="tasks-col-desc">תיאור</th>
                      <th className="tasks-col-assignee">אחראית</th>
                      <th className="tasks-col-date">תאריך יעד</th>
                      <th className="tasks-col-notes">הערות</th>
                      <th className="tasks-col-delete"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pdLoading ? (
                      <tr><td colSpan={7} style={{ display: 'block' }}><p className="tasks-empty">טוען...</p></td></tr>
                    ) : pdFiltered.length === 0 ? (
                      <tr><td colSpan={7} style={{ display: 'block' }}><p className="tasks-empty">אין משימות להצגה</p></td></tr>
                    ) : pdFiltered.map(task => {
                      const isUrgent = task.status === 'דחוף'
                      return (
                        <tr key={task.id} className={`tasks-row${isUrgent ? ' tasks-row--urgent' : ''}`}>
                          <td className="tasks-col-status" onClick={e => e.stopPropagation()}>
                            <PdStatusPopover
                              status={task.status}
                              onSelect={val => handlePdStatusChange(task.id, val)}
                            />
                          </td>
                          <PdEditCell task={task} field="stage" className="tasks-col-stage">
                            <span className="tasks-cell-value">{task.stage || ''}</span>
                          </PdEditCell>
                          <PdEditCell task={task} field="description" className="tasks-col-desc">
                            <span className="tasks-cell-value">{task.description || ''}</span>
                          </PdEditCell>
                          <PdEditCell task={task} field="responsible_id" className="tasks-col-assignee">
                            <span className="tasks-cell-value">{task.profiles?.first_name || ''}</span>
                          </PdEditCell>
                          <PdEditCell task={task} field="due_date" className="tasks-col-date">
                            <span className="tasks-cell-value">{pdFormatDate(task.due_date)}</span>
                          </PdEditCell>
                          <PdEditCell task={task} field="notes" className="tasks-col-notes">
                            <span className="tasks-cell-value">{task.notes || ''}</span>
                          </PdEditCell>
                          <td className="tasks-col-delete" onClick={e => e.stopPropagation()}>
                            <button
                              className="tasks-delete-btn"
                              onClick={e => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                setPdDeletePopoverPos({ top: rect.bottom + 4, left: rect.left })
                                setPdConfirmDeleteId(task.id)
                              }}
                            >
                              <PdIconTrash2 />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 1 — פרטי תיק ── */}
        {activeTab === 1 && (
          <div className="pd-tab1-grid">

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
                    <InlineField value={contact.first_name} placeholder="שם פרטי" onSave={val => saveContact(contact.id, 'first_name', val)} readOnly={fromArchive} />
                    <InlineField value={contact.last_name} placeholder="שם משפחה" onSave={val => saveContact(contact.id, 'last_name', val)} readOnly={fromArchive} />
                    <InlineField value={contact.id_number} placeholder="ת.ז" onSave={val => saveContact(contact.id, 'id_number', val)} readOnly={fromArchive} />
                    <InlineField value={contact.phone} placeholder="טלפון" type="tel" onSave={val => saveContact(contact.id, 'phone', val)} readOnly={fromArchive} />
                    <InlineField value={contact.email} placeholder="מייל" type="email" onSave={val => saveContact(contact.id, 'email', val)} readOnly={fromArchive} />
                    {!fromArchive && (
                      <button className="pd-delete-btn" onClick={() => deleteContact(contact.id)} title="מחק איש קשר">×</button>
                    )}
                  </div>
                ))}

                {!fromArchive && (
                  <button className="pd-add-btn" onClick={addContact}>+ הוסף איש קשר</button>
                )}
              </div>

              {/* Middle 25%: פרטי מגרש */}
              <div className="pd-info-card">
                <div className="pd-card-title">פרטי מגרש</div>
                {[
                  { label: 'ישוב',               field: 'city' },
                  { label: 'גוש',                field: 'gush' },
                  { label: 'חלקה',               field: 'helka' },
                  { label: 'מגרש',               field: 'migrash' },
                  { label: 'שטח המגרש',          field: 'area' },
                  { label: 'תוכניות חלות במקום', field: 'active_plans', multiline: true },
                ].map(({ label, field, multiline }) => (
                  <div key={field} className="pd-field-row">
                    <span className="pd-field-label">{label}</span>
                    <div className="pd-field-cell">
                      <InlineField value={clientInfo?.[field]} placeholder="—" multiline={multiline} onSave={val => saveClientInfo(field, val)} readOnly={fromArchive} />
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
                        {selectedId && fullName ? (
                          <button type="button" className="pd-prof-name-btn" onClick={() => openProfEdit(selectedId)} title="ערוך פרטי בעל מקצוע">
                            {fullName}
                          </button>
                        ) : (
                          <span className="pd-prof-empty">—</span>
                        )}
                        {selectedId && !fromArchive && (
                          <button type="button" className="pd-prof-clear-btn" onClick={() => saveClientInfo(idField, '')} title="הסר בחירה">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              <line x1="10" y1="11" x2="10" y2="17"/>
                              <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                          </button>
                        )}
                        {!fromArchive && <div className="pd-prof-popover-wrap">
                          <button type="button" className="pd-prof-pick-btn" onClick={() => setSelectionPopover(selectionPopover === idField ? null : idField)} title="בחר בעל מקצוע">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                                  <button key={p.id} type="button" className="pd-prof-popover-item"
                                    onClick={() => { saveClientInfo(idField, p.id); setSelectionPopover(null) }}>
                                    {`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—'}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>}
                      </div>
                    </div>
                  )
                })}
                {!fromArchive && (
                  <button type="button" className="pd-add-btn" onClick={openProfNew}>+ הוסף בעל מקצוע חדש</button>
                )}
              </div>

            </div>{/* end pd-info-cards-row */}

            {/* Bottom row: פרטי רישוי full width */}
            <div className="pd-info-card pd-info-card--wide">
              <div className="pd-card-title">פרטי רישוי</div>
              <div className="pd-committee-grid">
                <div className="pd-committee-col">
                  {committeeFields.slice(0, 4).map(({ label, field, multiline }) => (
                    <div key={field} className="pd-field-row">
                      <span className="pd-field-label">{label}</span>
                      <div className="pd-field-cell">
                        <InlineField value={clientInfo?.[field]} placeholder="—" multiline={multiline} onSave={val => saveClientInfo(field, val)} readOnly={fromArchive} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pd-committee-col">
                  {committeeFields.slice(4).map(({ label, field, multiline }) => (
                    <div key={field} className="pd-field-row">
                      <span className="pd-field-label">{label}</span>
                      <div className="pd-field-cell">
                        <InlineField value={clientInfo?.[field]} placeholder="—" multiline={multiline} onSave={val => saveClientInfo(field, val)} readOnly={fromArchive} />
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

      {/* ── Professional modal ── */}
      {profModalOpen && (
        <ProfessionalModal
          key={profModalEditRow?.id ?? 'new'}
          editRow={profModalEditRow}
          onClose={closeProfModal}
          onSaved={handleProfSaved}
          onDeleted={handleProfDeleted}
        />
      )}

      {/* ── Tasks tab: delete confirm popover ── */}
      {pdConfirmDeleteId && createPortal(
        <div
          ref={pdDeletePopoverRef}
          className="tasks-delete-popover"
          style={{ position: 'fixed', top: pdDeletePopoverPos.top, left: pdDeletePopoverPos.left, zIndex: 9999 }}
          dir="rtl"
        >
          <span className="tasks-delete-popover-text">מחק משימה?</span>
          <button className="tasks-delete-yes" onClick={() => pdDoDelete(pdConfirmDeleteId)}>מחק</button>
          <button className="tasks-delete-no" onClick={() => setPdConfirmDeleteId(null)}>ביטול</button>
        </div>,
        document.body
      )}

      {/* ── Tasks tab: new task modal ── */}
      {pdShowNewTask && project && (
        <NewTaskModal
          project={project}
          onClose={() => setPdShowNewTask(false)}
          onSaved={pdHandleTaskSaved}
        />
      )}

      {pdTaskToast && (
        <div className="ktm-toast">המשימה נשמרה ✓</div>
      )}

    </div>
  )
}

export default ProjectDetail
