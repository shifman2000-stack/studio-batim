import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import '../../TasksTab.css'

/* ── Stage definitions (order + kanban colors) ── */
const STAGES = [
  { name: 'קליטת פרויקט', bg: '#f0f0f0', text: '#000' },
  { name: 'סקיצות',        bg: '#e8e197', text: '#000' },
  { name: 'הדמיה',         bg: '#cbc9a2', text: '#000' },
  { name: 'גרמושקה',       bg: '#73946e', text: '#fff' },
  { name: 'רישוי',         bg: '#7bc1b5', text: '#000' },
  { name: 'תכניות עבודה',  bg: '#676977', text: '#fff' },
  { name: 'בניה',          bg: '#89748b', text: '#fff' },
  { name: 'גמר',           bg: '#87526d', text: '#fff' },
]

const STAGE_MAP = Object.fromEntries(STAGES.map(s => [s.name, s]))

const STATUS_OPTIONS = ['לא התחיל', 'בתהליך', 'הושלם']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/* ── Inline SVGs ── */
const IconStarFilled = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
    fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
)

const IconStarEmpty = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
)

const IconTrash2 = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

/* XCircle — לא התחיל (18px for row display) */
const IconXCircle = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
)

/* Clock — בתהליך */
const IconClock = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
)

/* CheckCircle — הושלם */
const IconCheckCircle = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
)

const STATUS_ICON = {
  'לא התחיל': { color: '#E24B4A' },
  'בתהליך':   { color: '#F6BF26' },
  'הושלם':    { color: '#1D9E75' },
}

function statusIcon(status, size = 18) {
  if (status === 'הושלם')  return <IconCheckCircle size={size} />
  if (status === 'בתהליך') return <IconClock size={size} />
  return <IconXCircle size={size} />
}

/* ── Status popover component ── */
function StatusPopover({ status, taskId, onPatch }) {
  const [open,    setOpen]   = useState(false)
  const [pos,     setPos]    = useState({ top: 0, left: 0 })
  const triggerRef           = useRef(null)
  const popoverRef           = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (open) { setOpen(false); return }
    const rect          = triggerRef.current.getBoundingClientRect()
    const popoverHeight = 120 // approximate height of 3-option popover
    const below         = rect.bottom + 4
    const above         = rect.top - popoverHeight
    const top           = below + popoverHeight > window.innerHeight ? above : below
    setPos({ top, left: rect.left })
    setOpen(true)
  }

  const select = (val) => {
    setOpen(false)
    onPatch(taskId, { status: val, date: todayISO() })
  }

  const current = STATUS_ICON[status] ? status : 'לא התחיל'

  return (
    <div className="tt-status-popover-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="tt-status-trigger"
        style={{ color: STATUS_ICON[current].color }}
        onClick={handleOpen}
        title={current}
      >
        {statusIcon(current)}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="tt-status-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
        >
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt}
              type="button"
              className={'tt-status-option' + (opt === current ? ' tt-status-option--active' : '')}
              onClick={() => select(opt)}
            >
              <span style={{ color: STATUS_ICON[opt].color, display: 'flex', alignItems: 'center' }}>
                {statusIcon(opt, 15)}
              </span>
              <span>{opt}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const IconChevronDown = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

const IconChevronUp = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
)

/* ── Single task row ── */
function TaskRow({ task, index, stageBg, onPatch, onDelete }) {
  const [confirming, setConfirming] = useState(false)

  return (
    <div className={
      'tt-task-row' +
      (index % 2 === 1 ? ' tt-task-row--even' : '') +
      (task.is_milestone ? ' tt-task-row--milestone' : '')
    }
      style={task.is_milestone ? { borderRight: `3px solid ${stageBg}` } : {}}
    >

      {/* אבן דרך (star toggle) */}
      <div className="tt-col-milestone">
        <button
          type="button"
          className={'tt-star-btn' + (task.is_milestone ? ' tt-star-btn--active' : '')}
          onClick={() => onPatch(task.id, { is_milestone: !task.is_milestone })}
          title={task.is_milestone ? 'בטל אבן דרך' : 'סמן כאבן דרך'}
          style={task.is_milestone ? { color: stageBg } : {}}
        >
          {task.is_milestone ? <IconStarFilled /> : <IconStarEmpty />}
        </button>
      </div>

      {/* שם המשימה */}
      <div className="tt-col-name">
        <span className={'tt-task-name' + (task.is_milestone ? ' tt-task-name--milestone' : '')}>
          {task.name || '—'}
        </span>
      </div>

      {/* סטטוס */}
      <div className="tt-col-status">
        <StatusPopover status={task.status} taskId={task.id} onPatch={onPatch} />
      </div>

      {/* תאריך */}
      <div className="tt-col-date">
        <input
          type="date"
          value={task.date || ''}
          onChange={e => onPatch(task.id, { date: e.target.value || null })}
          className="tt-date-input"
        />
      </div>

      {/* הערות */}
      <div className="tt-col-notes">
        <input
          type="text"
          defaultValue={task.notes || ''}
          onBlur={e => { if (e.target.value !== (task.notes || '')) onPatch(task.id, { notes: e.target.value }) }}
          className="tt-notes-input"
          placeholder="הערה..."
          dir="rtl"
        />
      </div>

      {/* מחק */}
      <div className="tt-col-delete">
        {confirming ? (
          <div className="tt-delete-confirm">
            <span className="tt-delete-confirm-text">למחוק?</span>
            <button type="button" className="tt-delete-confirm-yes" onClick={() => onDelete(task.id)}>כן</button>
            <button type="button" className="tt-delete-confirm-no" onClick={() => setConfirming(false)}>לא</button>
          </div>
        ) : (
          <button type="button" className="tt-row-delete-btn" onClick={() => setConfirming(true)} title="מחק משימה">
            <IconTrash2 />
          </button>
        )}
      </div>

    </div>
  )
}

/* ── Add custom task inline form ── */
function AddTaskRow({ stage, onAdd }) {
  const [adding, setAdding] = useState(false)
  const [name,   setName]   = useState('')
  const inputRef            = useRef(null)

  const confirm = async () => {
    if (!name.trim()) return
    await onAdd(stage, name.trim())
    setName(''); setAdding(false)
  }

  if (!adding) {
    return (
      <button type="button" className="tt-add-row-link"
        onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 0) }}>
        + הוסף משימה
      </button>
    )
  }

  return (
    <div className="tt-add-row-inline">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { setAdding(false); setName('') } }}
        className="tt-add-row-input"
        placeholder="שם המשימה..."
        dir="rtl"
      />
      <button type="button" className="tt-add-row-confirm" onClick={confirm}>אישור</button>
      <button type="button" className="tt-add-row-cancel" onClick={() => { setAdding(false); setName('') }}>ביטול</button>
    </div>
  )
}

/* ── Milestone Timeline ── */
function MilestoneTimeline({ milestones }) {
  if (!milestones || milestones.length === 0) return null

  const total = milestones.length

  // Find the highest index that is 'הושלם' — that's how far the fill goes (RTL: right→left)
  let fillToIdx = -1
  for (let i = 0; i < total; i++) {
    const s = milestones[i].status || 'לא התחיל'
    if (s === 'הושלם' || s === 'בתהליך') fillToIdx = i
  }

  const fillPct = total > 1 && fillToIdx >= 0
    ? (fillToIdx / (total - 1)) * 100
    : 0

  return (
    <div className="tt-timeline-card">
      <div className="tt-timeline-inner">

        {/* Track behind the nodes */}
        <div className="tt-timeline-track">
          <div className="tt-timeline-fill" style={{ width: `${fillPct}%` }} />
        </div>

        {/* Nodes */}
        <div className="tt-timeline-nodes">
          {milestones.map((m) => {
            const status = m.status || 'לא התחיל'

            const circleStyle =
              status === 'הושלם'    ? { background: '#2D3748', borderColor: '#2D3748' } :
              status === 'בתהליך'   ? { background: '#fff',    borderColor: '#2D3748' } :
                                      { background: '#fff',    borderColor: '#9E9E9E' }

            return (
              <div key={m.id} className="tt-timeline-node-wrap">
                {/* Circle node */}
                <div className="tt-timeline-circle" style={circleStyle} />

                {/* Label below */}
                <div className="tt-timeline-label">{m.name}</div>
              </div>
            )
          })}
        </div>

      </div>
    </div>
  )
}

/* ── Main component ── */
export default function TasksTab({ projectId }) {
  const [tasks,      setTasks]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [openStages, setOpenStages] = useState({})

  useEffect(() => { loadTasks() }, [projectId])

  const loadTasks = async () => {
    setLoading(true)

    /* ── Step 1: clean up any duplicates (keep MIN id per project+template) ── */
    const { data: allRows } = await supabase
      .from('project_tasks')
      .select('id, project_id, template_id')
      .not('template_id', 'is', null)
      .order('id', { ascending: true })

    if (allRows && allRows.length > 0) {
      const seen     = new Map()
      const toDelete = []
      for (const row of allRows) {
        const key = `${row.project_id}:${row.template_id}`
        if (seen.has(key)) {
          toDelete.push(row.id)
        } else {
          seen.set(key, row.id)
        }
      }
      if (toDelete.length > 0) {
        await supabase.from('project_tasks').delete().in('id', toDelete)
      }
    }

    /* ── Step 2: use a count check before deciding to seed ── */
    const { count } = await supabase
      .from('project_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)

    let data = null

    if (count === 0) {
      /* No rows yet — seed from templates */
      const { data: templates } = await supabase
        .from('task_templates')
        .select('*')
        .order('sort_order')

      if (templates && templates.length > 0) {
        const toInsert = templates.map(t => ({
          project_id:   projectId,
          template_id:  t.id,
          stage:        t.stage,
          name:         t.name,
          status:       'לא התחיל',
          is_milestone: t.is_milestone ?? false,
          sort_order:   t.sort_order ?? 0,
        }))
        const { data: inserted } = await supabase
          .from('project_tasks')
          .insert(toInsert)
          .select('*')
          .order('sort_order')
        if (inserted) data = inserted
      }
    }

    /* ── Step 3: fetch current rows if not already set from insert ── */
    if (!data) {
      const { data: fetched } = await supabase
        .from('project_tasks')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order')
      data = fetched
    }

    setTasks(data || [])
    const state = {}
    STAGES.forEach(s => { state[s.name] = false })
    setOpenStages(state)
    setLoading(false)
  }

  /* ── Patch one or more fields (optimistic) ── */
  const patchTask = async (taskId, patch) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t))
    await supabase.from('project_tasks').update(patch).eq('id', taskId)
  }

  /* ── Delete task ── */
  const deleteTask = async (taskId) => {
    await supabase.from('project_tasks').delete().eq('id', taskId)
    setTasks(prev => prev.filter(t => t.id !== taskId))
  }

  /* ── Add custom task ── */
  const addCustomTask = async (stage, name) => {
    const stageTasks = tasks.filter(t => t.stage === stage)
    const maxOrder   = stageTasks.reduce((m, t) => Math.max(m, t.sort_order ?? 0), 0)
    const { data } = await supabase
      .from('project_tasks')
      .insert([{
        project_id:   projectId,
        template_id:  null,
        stage,
        name,
        status:       'לא התחיל',
        is_milestone: false,
        sort_order:   maxOrder + 1,
      }])
      .select()
      .single()
    if (data) setTasks(prev => [...prev, data])
  }

  /* ── Milestones for timeline — ordered by stage position then sort_order within stage ── */
  const milestones = tasks
    .filter(t => t.is_milestone)
    .sort((a, b) => {
      const stageIdxA = STAGES.findIndex(s => s.name === a.stage)
      const stageIdxB = STAGES.findIndex(s => s.name === b.stage)
      if (stageIdxA !== stageIdxB) return stageIdxA - stageIdxB
      return (a.sort_order ?? 0) - (b.sort_order ?? 0)
    })

  /* ── Progress ── */
  const doneTasks  = tasks.filter(t => t.status === 'הושלם')
  const pct        = tasks.length > 0
    ? Math.round((doneTasks.length / tasks.length) * 100)
    : 0

  /* ── Group by stage ── */
  const byStage = {}
  STAGES.forEach(s => { byStage[s.name] = [] })
  tasks.forEach(t => {
    if (byStage[t.stage]) byStage[t.stage].push(t)
    else byStage[t.stage] = [t]
  })

  const toggleStage = (stage) =>
    setOpenStages(prev => ({ ...prev, [stage]: !prev[stage] }))

  if (loading) return <p className="tt-loading">טוען משימות...</p>

  return (
    <div className="tt-root" dir="rtl">

      {/* ── Milestone timeline ── */}
      <MilestoneTimeline milestones={milestones} />

      {/* ── Progress bar ── */}
      <div className="tt-progress-section">
        <div className="tt-progress-label">
          <strong>{doneTasks.length} מתוך {tasks.length}</strong> שלבים הושלמו
        </div>
        <div className="tt-progress-track">
          <div className="tt-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="tt-progress-pct">{pct}%</span>
      </div>

      {/* ── Accordions ── */}
      <div className="tt-accordions">
        {STAGES.map(({ name: stage, bg, text }) => {
          const stageTasks = byStage[stage] || []
          const stageDone  = stageTasks.filter(t => t.status === 'הושלם')
          const isComplete = stageTasks.length > 0 && stageDone.length === stageTasks.length
          const isOpen     = openStages[stage]

          return (
            <div key={stage} className="tt-accordion">
              <button
                type="button"
                className="tt-accordion-header"
                style={{ background: bg, color: text }}
                onClick={() => toggleStage(stage)}
              >
                <span className="tt-accordion-arrow">{isOpen ? <IconChevronUp /> : <IconChevronDown />}</span>
                <span className="tt-accordion-title">{stage}</span>
                <span className="tt-accordion-count" style={{
                  background: 'rgba(255,255,255,0.3)',
                  color: text,
                }}>
                  {stageDone.length}/{stageTasks.length}
                </span>
              </button>

              {isOpen && (
                <div className="tt-accordion-body">
                  {stageTasks.length > 0 && (
                    <div className="tt-table-header">
                      <div className="tt-col-milestone">אבן דרך</div>
                      <div className="tt-col-name">שם המשימה</div>
                      <div className="tt-col-status">סטטוס</div>
                      <div className="tt-col-date">תאריך</div>
                      <div className="tt-col-notes">הערות</div>
                      <div className="tt-col-delete" />
                    </div>
                  )}

                  {stageTasks.map((task, i) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      index={i}
                      stageBg={bg}
                      onPatch={patchTask}
                      onDelete={deleteTask}
                    />
                  ))}

                  <AddTaskRow stage={stage} onAdd={addCustomTask} />
                </div>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}
