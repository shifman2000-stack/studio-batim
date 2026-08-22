// src/components/meetings/MeetingSummariesTab.jsx
//
// Manager tab — "סיכומי פגישות". Vertical list of meeting cards per
// project; each card flips between a view mode (rendered markdown +
// metadata + edit/delete affordances) and an edit mode (date input,
// participants input, markdown textarea with a tiny Bold + bullet-list
// toolbar, live preview). Read/write hits the `meeting_summaries`
// table; RLS limits all of this to staff.
//
// The summary editor is a small TipTap-backed WYSIWYG (Bold + ordered
// list only). It stores HTML, which we save verbatim into the existing
// `summary_md` text column (no DB change) and render with
// dangerouslySetInnerHTML in view mode — content is staff-authored in
// our own sandbox editor, not external input.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import RichTextEditor, { hasRichText } from './RichTextEditor'
import { resolveUserNames } from '../../lib/resolveUserNames'
import { clientDoneHint, DONE_STATUS } from './meetingTasksStatus'
import TaskStatusControl from '../tasks/TaskStatusControl'
import ClientProgrammingQuestionnaire from '../../pages/client/ClientProgrammingQuestionnaire'
import './MeetingSummariesTab.css'

/* ── Inline icons (Feather-style, stroke="currentColor") ────────── */
const IconPencil = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
  </svg>
)
const IconTrash = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)
const IconPlus = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)
const IconChevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

/* ── Helpers ────────────────────────────────────────────────────── */
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
/* Tab id of "סיכומי פגישות" inside the project file. Exported so the
   deep link and ProjectDetail's TABS list agree on one number rather
   than repeating a literal 11 in two files. */
export const MEETINGS_TAB_ID = 11

/* App-relative deep link that opens a project file on the meetings tab
   with one summary already expanded. DERIVED at render time from the
   task's project_id + meeting_summary_id — never stored in a column, so
   there is nothing to go stale if the route ever changes. */
export function buildMeetingDeepLink(projectId, summaryId) {
  return `/projects/${projectId}?tab=${MEETINGS_TAB_ID}&summary=${summaryId}`
}

/* Stages the studio itself drives — a task born from a meeting on one
   of these goes to the admin (Einav). Every other stage belongs to
   whoever runs the project. Matched BY NAME against the stages table,
   never by id: the numbers differ between Dev and Prod.

   The name compared here comes from the LUT (see the stages fetch in
   assignMeetingTask below), so it always carries the stage's CURRENT
   name — which is why the old 'סקיצות' spelling is gone rather than
   kept as a fallback. */
const ADMIN_STAGE_NAMES = new Set([
  'קליטת פרויקט',
  'סקיצות והדמיות',
  'בניה',
  'גמר',
])

/* The stage a summary opened via "סיכום פגישת פרוגרמה" starts on. Set
   at creation, so nothing later has to guess from the topic text. */
const PROGRAM_DEFAULT_STAGE_NAME = 'קליטת פרויקט'

/* ── Focused editor screen ────────────────────────────────────────
   The tab-takeover chrome: a title at the visual RIGHT, "סגור" at the
   visual LEFT, and the panes below. Both editors use it — the
   programming split-screen (two panes) and a regular summary (one
   full-width pane) — so there is ONE such layout, not two that can
   drift apart.

   Deliberately keeps the .ms-program-* class names it was extracted
   from: they already carry the exact spacing and pane chrome, and
   renaming them would churn CSS that is working. */
function FocusedEditorScreen({ title, onClose, closeDisabled, error, children }) {
  return (
    <div className="ms-root" dir="rtl">
      <div className="ms-program-toolbar">
        <h2 className="ms-program-title">{title}</h2>
        <button
          type="button"
          className="ms-btn-secondary"
          onClick={onClose}
          disabled={closeDisabled}
        >
          סגור
        </button>
      </div>

      {error && (
        <div className="ms-error" role="alert">{error}</div>
      )}

      <div className="ms-program-split">{children}</div>
    </div>
  )
}

/* ── Edit form (used both for brand-new and existing summaries) ────
   The summary editor is now a TipTap-backed WYSIWYG (see
   RichTextEditor); the underlying `summary_md` text column stores HTML
   instead of markdown — no schema change. */
function MeetingEditForm({
  initial,
  onSave,
  onCancel,
  saving,
  /* The stages list for the dropdown, in the table's own order, and the
     stage a BRAND-NEW summary should open on. An existing summary
     ignores defaultStageId and uses its own saved initial.stage_id. */
  stages = [],
  defaultStageId = null,
}) {
  const [topicValue,   setTopicValue]   = useState(initial.topic        ?? '')
  const [meetingDate,  setMeetingDate]  = useState(initial.meeting_date ?? todayISO())
  const [participants, setParticipants] = useState(initial.participants ?? '')
  const [summaryHtml,  setSummaryHtml]  = useState(initial.summary_md   ?? '')
  const [clientTasks,  setClientTasks]  = useState(initial.client_tasks ?? '')
  const [studioTasks,  setStudioTasks]  = useState(initial.studio_tasks ?? '')
  const [stageId,      setStageId]      = useState(initial.stage_id ?? defaultStageId ?? '')

  /* The project's stage is fetched by the tab, so on a fast "+" click it
     can land after this form mounts. Adopt it then — but ONLY while the
     field is still untouched, so a stage the user picked is never
     overwritten by a late arrival. */
  useEffect(() => {
    if (stageId === '' && defaultStageId != null) setStageId(defaultStageId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultStageId])

  /* Task sections start OPEN when the field already holds content, so
     editing an existing summary never hides what's there. Emptiness is
     decided by the shared helper — same rule as the save flags and the
     read views. */
  const [clientOpen, setClientOpen] = useState(() => hasRichText(initial.client_tasks))
  const [studioOpen, setStudioOpen] = useState(() => hasRichText(initial.studio_tasks))

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      topic:            topicValue.trim() || null,
      meeting_date:     meetingDate || todayISO(),
      participants:     participants.trim() || null,
      /* Select values are strings; the column is an integer FK. */
      stage_id:         stageId === '' ? null : Number(stageId),
      summary_md:       summaryHtml,
      client_tasks:     clientTasks,
      studio_tasks:     studioTasks,
      /* Flags derived from the very values being written, in the same
         payload — they can never drift from the text. An editor that
         was opened but left untouched serialises to "<p></p>", which
         the helper reads as empty, so the flag stays false. */
      has_client_tasks: hasRichText(clientTasks),
      has_studio_tasks: hasRichText(studioTasks),
    })
  }

  return (
    <form className="ms-edit-form" onSubmit={handleSubmit} dir="rtl">
      {/* Topic + date share one row. RTL: topic is the FIRST child so
          it paints on the visual RIGHT and flexes to fill; the date
          is last (visual LEFT) and sized to its content. Visible
          labels are gone — the placeholders carry the meaning, and
          aria-label keeps each input announced. */}
      <div className="ms-edit-row ms-edit-row--inline">
        <input
          type="text"
          className="ms-edit-input ms-edit-input--grow"
          value={topicValue}
          onChange={e => setTopicValue(e.target.value)}
          placeholder="נושא הפגישה"
          aria-label="נושא הפגישה"
          dir="rtl"
        />
        <input
          type="date"
          className="ms-edit-input ms-edit-input--date"
          value={meetingDate}
          onChange={e => setMeetingDate(e.target.value)}
          aria-label="תאריך הפגישה"
          required
        />
      </div>

      {/* Participants + stage share one row, same pattern as topic+date
          above. RTL: participants is the FIRST child so it stays on the
          visual RIGHT and flexes to fill; the stage select is last
          (visual LEFT) and sized to its content. No labels — consistent
          with the rest of this form. */}
      <div className="ms-edit-row ms-edit-row--inline">
        <input
          type="text"
          className="ms-edit-input ms-edit-input--grow"
          value={participants}
          onChange={e => setParticipants(e.target.value)}
          placeholder="משתתפים"
          aria-label="משתתפים"
          dir="rtl"
        />
        <select
          className="ms-edit-input ms-edit-input--stage"
          value={stageId}
          onChange={e => setStageId(e.target.value)}
          aria-label="שלב"
          dir="rtl"
        >
          <option value="">שלב</option>
          {stages.map(st => (
            <option key={st.id} value={st.id}>{st.name}</option>
          ))}
        </select>
      </div>

      <div className="ms-edit-row ms-edit-row--md">
        <RichTextEditor
          value={summaryHtml}
          onChange={setSummaryHtml}
          placeholder="כתבו כאן את סיכום הפגישה"
          ariaLabel="סיכום"
        />
      </div>

      {/* Task sections — same RichTextEditor as the summary, so the
          toolbar and RTL list styling are identical by construction. */}
      {clientOpen && (
        <div className="ms-edit-row ms-edit-row--md">
          <RichTextEditor
            value={clientTasks}
            onChange={setClientTasks}
            placeholder="משימות לקוח"
            ariaLabel="משימות לקוח"
          />
        </div>
      )}
      {studioOpen && (
        <div className="ms-edit-row ms-edit-row--md">
          <RichTextEditor
            value={studioTasks}
            onChange={setStudioTasks}
            placeholder="משימות סטודיו"
            ariaLabel="משימות סטודיו"
          />
        </div>
      )}

      {/* RTL: the two task toggles come FIRST so they sit on the
          visual RIGHT; marginInlineStart:auto on the save/cancel pair
          pushes it to the visual LEFT end of the same row. */}
      <div className="ms-edit-actions">
        <button
          type="button"
          className={'ms-btn-secondary' + (clientOpen ? ' ms-btn-toggle--open' : '')}
          onClick={() => setClientOpen(v => !v)}
          aria-expanded={clientOpen}
          disabled={saving}
        >
          משימות לקוח
          {/* Quiet has-content dot — reuses the existing sage accent. */}
          {hasRichText(clientTasks) && <span className="ms-has-content-dot" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={'ms-btn-secondary' + (studioOpen ? ' ms-btn-toggle--open' : '')}
          onClick={() => setStudioOpen(v => !v)}
          aria-expanded={studioOpen}
          disabled={saving}
        >
          משימות סטודיו
          {hasRichText(studioTasks) && <span className="ms-has-content-dot" aria-hidden="true" />}
        </button>

        <div className="ms-edit-actions-end">
          <button type="submit" className="ms-btn-primary" disabled={saving}>
            {saving ? 'שומר...' : 'שמור'}
          </button>
          <button type="button" className="ms-btn-secondary" onClick={onCancel} disabled={saving}>
            ביטול
          </button>
        </div>
      </div>
    </form>
  )
}

/* ── Main tab ────────────────────────────────────────────────────── */
export default function MeetingSummariesTab({
  projectId,
  initialOpenSummaryId = null,
  /* A token that changes once per navigation (ProjectDetail passes
     location.key). See the seeding effect below for why the summary id
     alone is not enough. */
  navToken = null,
  /* Switches the project file over to its משימות tab. Supplied by
     ProjectDetail; when absent the studio block simply shows no link. */
  onOpenTasksTab = null,
}) {
  const [summaries,      setSummaries]      = useState([])
  const [loading,        setLoading]        = useState(true)
  /* uuid → display name, for client_tasks_done_by. Resolved in ONE
     batch across every summary (see loadSummaries). */
  const [doneByNames,    setDoneByNames]    = useState({})
  /* summary id → the auto-created task row that mirrors its studio
     tasks. That row's status is the ONLY source of truth for the
     studio "בוצע" suffix — nothing here ever writes to it. */
  const [studioTaskBySummary, setStudioTaskBySummary] = useState({})
  /* The פעיל / דחוף / הושלם rows, used both to render the status
     controls and to resolve a status_id back to its name. */
  const [taskStatuses,   setTaskStatuses]   = useState([])
  /* Stages for the form's dropdown, in the table's own order, plus the
     stage a new summary should default to (the project's current one). */
  const [stages,         setStages]         = useState([])
  const [projectStageId, setProjectStageId] = useState(null)
  /* Summary id whose status write is mid-flight, and the id → message
     map for a write the DB rejected. */
  const [doneBusyId,     setDoneBusyId]     = useState(null)
  const [doneErrors,     setDoneErrors]     = useState({})
  /* Non-blocking notice for the auto-task side effect. Kept separate
     from errorMsg so a failed task never reads as a failed save. */
  const [taskNoticeMsg,  setTaskNoticeMsg]  = useState('')
  const [draftNew,       setDraftNew]       = useState(false)    /* "+ new" pending card */
  const [editingId,      setEditingId]      = useState(null)     /* row id currently in edit mode */
  const [confirmingId,   setConfirmingId]   = useState(null)     /* row id pending delete confirmation */
  const [savingRow,      setSavingRow]      = useState(false)
  const [errorMsg,       setErrorMsg]       = useState('')
  /* Accordion state — Set of currently-open summary ids. Default: all
     collapsed; clicking a card header toggles only that card. */
  const [openSet,        setOpenSet]        = useState(new Set())
  /* Split-screen mode for "סיכום פגישת פרוגרמה".
       null                → not in split mode (regular list showing).
       { row: null }       → CREATE a new programming summary.
       { row: existingRow} → EDIT an existing programming summary
                             (same row object we render in the list).
     Rendered as a two-pane layout (meeting editor + embedded
     questionnaire) that replaces the summaries list. Local UI state,
     no persistence. The row that gets INSERTed/UPDATEd here is still
     a normal meeting_summaries row (source='manual') — it flows
     through every existing path (client view, list, edit, delete)
     unchanged, no schema/type column added. */
  const [programMode,    setProgramMode]    = useState(null)

  const toggleOpen = (id) => {
    setOpenSet(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const handleHeaderKeyDown = (e, id) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleOpen(id)
    }
  }
  const openCard = (id) => {
    setOpenSet(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  /* ── Load summaries ─────────────────────────────────────────── */
  const loadSummaries = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('meeting_summaries')
      .select('id, project_id, meeting_date, topic, participants, stage_id, summary_md, client_tasks, studio_tasks, has_client_tasks, has_studio_tasks, client_tasks_status_id, client_tasks_done_at, client_tasks_done_by, source, created_by, created_at, updated_at')
      .eq('project_id', projectId)
      .order('meeting_date', { ascending: false })
      .order('created_at',   { ascending: false })
    if (error) {
      console.error('MeetingSummariesTab — load error:', error)
      setErrorMsg('שגיאה בטעינת סיכומים')
      setSummaries([])
      setDoneByNames({})
      setStudioTaskBySummary({})
      setLoading(false)
      return
    }

    const rows = Array.isArray(data) ? data : []
    setSummaries(rows)
    setErrorMsg('')
    setLoading(false)

    /* The three status rows — needed to render every status control and
       to turn a status_id back into a name. Tiny lookup table, fetched
       once per load rather than per card. */
    const { data: statusRows } = await supabase
      .from('task_statuses')
      .select('id, name')
      .order('id')
    setTaskStatuses(Array.isArray(statusRows) ? statusRows : [])

    /* Stages for the form's dropdown (existing table order) and the
       project's current stage, which is what a new summary opens on. */
    const [{ data: stageRows }, { data: projRow }] = await Promise.all([
      supabase.from('stages').select('id, name').eq('is_active', true).order('order_index'),
      supabase.from('projects').select('stage_id').eq('id', projectId).maybeSingle(),
    ])
    setStages(Array.isArray(stageRows) ? stageRows : [])
    setProjectStageId(projRow?.stage_id ?? null)

    /* ── Batch lookups over the WHOLE list ──
       None of them is per-card: one `in` query for the linked tasks,
       one batched name resolve. Both run after the list is on screen,
       so a slow lookup delays the status line, never the summaries. */
    const summaryIds = rows.map(r => r.id)
    if (summaryIds.length > 0) {
      /* Linked auto-created tasks. A summary with no row here (one
         written before this feature existed) just gets no suffix. */
      const { data: taskRows, error: taskErr } = await supabase
        .from('tasks')
        .select('id, meeting_summary_id, status_id, task_statuses!status_id(id, name)')
        .in('meeting_summary_id', summaryIds)
      if (taskErr) {
        /* Non-fatal: the summaries themselves are already rendered. */
        console.error('MeetingSummariesTab — linked task load error:', taskErr)
        setStudioTaskBySummary({})
      } else {
        const bySummary = {}
        for (const t of taskRows || []) {
          if (t.meeting_summary_id) bySummary[t.meeting_summary_id] = t
        }
        setStudioTaskBySummary(bySummary)
      }
    } else {
      setStudioTaskBySummary({})
    }

    /* Whoever marked "בוצע" may be staff OR the client, so this goes
       through the shared resolver rather than a profiles-only read. */
    const doneByIds = rows.map(r => r.client_tasks_done_by).filter(Boolean)
    setDoneByNames(doneByIds.length > 0 ? await resolveUserNames(doneByIds) : {})
  }

  useEffect(() => { loadSummaries() }, [projectId])

  /* ── Deep-link seeding ──
     Opens the summary named by ?summary=<id> once the list has loaded,
     then scrolls it into view. An id that matches nothing is silently
     ignored.

     Guarded on the NAVIGATION token, not on the summary id. Keying on
     the id meant "seed each summary at most once per mount", which
     silently dropped the commonest repeat: collapse the summary by hand,
     click the very same link again, and the id is unchanged so nothing
     reopens. A fresh token means a fresh click, which is exactly when we
     should re-seed.

     Re-renders don't mint a new token, so the user's own expand/collapse
     is still never disturbed. */
  const seededRef = useRef(null)
  useEffect(() => {
    if (!initialOpenSummaryId) return
    if (seededRef.current === navToken) return
    if (loading) return
    if (!summaries.some(s => s.id === initialOpenSummaryId)) return
    seededRef.current = navToken
    setOpenSet(prev => {
      const next = new Set(prev)
      next.add(initialOpenSummaryId)
      return next
    })
    /* Let the expanded body render before scrolling to it. */
    requestAnimationFrame(() => {
      const el = document.getElementById(`ms-card-${initialOpenSummaryId}`)
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }, [initialOpenSummaryId, navToken, loading, summaries])

  /* Resolved by NAME from the stages table — never a hard-coded id. */
  const programDefaultStageId =
    stages.find(st => (st.name || '').trim() === PROGRAM_DEFAULT_STAGE_NAME)?.id ?? null

  /* Turn a status_id into its name — the only place that mapping is
     made, so every suffix / control label agrees. */
  const statusNameById = (id) =>
    taskStatuses.find(t => t.id === id)?.name || ''

  const clearDoneError = (summaryId) => setDoneErrors(prev => {
    if (!(summaryId in prev)) return prev
    const next = { ...prev }
    delete next[summaryId]
    return next
  })

  /* ── CLIENT tasks status ──
     One status for the whole block, never per line. Always through the
     RPC: client_tasks_status_id is not writable directly by the client,
     and a plain update would fail (silently, under RLS). Einav gets the
     same control here so she can set it when the client tells her by
     phone — same function, same audit columns.

     Optimistic, then reconciled: the RPC stamps done_at/done_by
     server-side, so on success we read those columns back rather than
     guessing them. On failure the row is restored exactly as it was —
     the control never shows a status the DB rejected. */
  const setClientTasksStatus = async (summaryId, statusId) => {
    const before = summaries.find(s => s.id === summaryId)
    if (!before || doneBusyId === summaryId) return
    if (before.client_tasks_status_id === statusId) return

    setDoneBusyId(summaryId)
    clearDoneError(summaryId)
    setSummaries(prev => prev.map(s =>
      s.id === summaryId ? { ...s, client_tasks_status_id: statusId } : s
    ))

    const { error } = await supabase.rpc('set_meeting_client_tasks_status', {
      p_summary_id: summaryId,
      p_status_id:  statusId,
    })

    if (error) {
      console.error('MeetingSummariesTab — client status error:', error)
      setSummaries(prev => prev.map(s => s.id === summaryId ? {
        ...s,
        client_tasks_status_id: before.client_tasks_status_id,
        client_tasks_done_at:   before.client_tasks_done_at,
        client_tasks_done_by:   before.client_tasks_done_by,
      } : s))
      setDoneErrors(prev => ({ ...prev, [summaryId]: 'לא הצלחנו לעדכן את הסטטוס' }))
      setDoneBusyId(null)
      return
    }

    const { data: fresh } = await supabase
      .from('meeting_summaries')
      .select('id, client_tasks_status_id, client_tasks_done_at, client_tasks_done_by')
      .eq('id', summaryId)
      .single()
    if (fresh) {
      setSummaries(prev => prev.map(s => s.id === summaryId ? { ...s, ...fresh } : s))
      /* Whoever just set it may not be in the batch resolved on load —
         resolve that one id, once. */
      if (fresh.client_tasks_done_by && !doneByNames[fresh.client_tasks_done_by]) {
        const map = await resolveUserNames([fresh.client_tasks_done_by])
        setDoneByNames(prev => ({ ...prev, ...map }))
      }
    }
    setDoneBusyId(null)
  }

  /* ── STUDIO tasks status ──
     Writes tasks.status_id on the linked row. That row is the single
     source of truth — there is deliberately NO mirrored column on the
     summary — so this and the משימות tab edit the very same value and
     each shows the other's change on the next load. No realtime sync,
     none wanted. */
  const setStudioTaskStatus = async (summaryId, statusId) => {
    const linked = studioTaskBySummary[summaryId]
    if (!linked || doneBusyId === summaryId) return
    if (linked.status_id === statusId) return

    const before = linked
    setDoneBusyId(summaryId)
    clearDoneError(summaryId)
    setStudioTaskBySummary(prev => ({
      ...prev,
      [summaryId]: { ...prev[summaryId], status_id: statusId },
    }))

    const { error } = await supabase
      .from('tasks')
      .update({ status_id: statusId })
      .eq('id', linked.id)

    if (error) {
      console.error('MeetingSummariesTab — studio status error:', error)
      setStudioTaskBySummary(prev => ({ ...prev, [summaryId]: before }))
      setDoneErrors(prev => ({ ...prev, [summaryId]: 'לא הצלחנו לעדכן את הסטטוס' }))
    }
    setDoneBusyId(null)
  }

  /* ── Save a brand-new summary ───────────────────────────────── */
  const handleCreate = async (payload) => {
    setSavingRow(true)
    setErrorMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id || null
      const { data, error } = await supabase
        .from('meeting_summaries')
        .insert({
          project_id:   projectId,
          topic:        payload.topic,
          meeting_date: payload.meeting_date,
          participants: payload.participants,
          stage_id:     payload.stage_id,
          summary_md:   payload.summary_md,
          /* Text + flags in ONE write — the flags are computed by the
             shared helper from these exact values (see handleSubmit). */
          client_tasks:     payload.client_tasks,
          studio_tasks:     payload.studio_tasks,
          has_client_tasks: payload.has_client_tasks,
          has_studio_tasks: payload.has_studio_tasks,
          source:       'manual',
          created_by:   userId,
        })
        .select()
        .single()
      if (error) throw error
      setSummaries(prev => [data, ...prev])
      setDraftNew(false)
      /* AFTER a confirmed save — isolated, never blocks the above. */
      await runStudioTaskSideEffect(data)
    } catch (e) {
      console.error('MeetingSummariesTab — create error:', e)
      setErrorMsg('שגיאה בשמירת הסיכום')
    }
    setSavingRow(false)
  }

  /* ── Auto-create ONE task from a summary's studio tasks ────────
     Runs after a successful save, only when the studio-tasks field
     has content per the shared hasRichText helper.

     IDEMPOTENT BY QUERY: we first look for a task already carrying
     this summary's id. If one exists we stop. The task is therefore
     created exactly once — on the first save that has studio tasks —
     and later edits of the same summary never insert a second one.

     Deliberately NOT implemented (by request): syncing the task when
     the summary's topic/date change later, and deleting the task if
     the studio tasks are removed. Einav may have already edited or
     worked on that row, so we never touch it again.

     FAILURE ISOLATION: every step is inside the caller's try/catch
     and reported via a non-blocking notice. Saving the summary is
     the primary action and must never be lost because of this. */
  const maybeCreateStudioTask = async (row) => {
    if (!row || !row.id) return
    if (!hasRichText(row.studio_tasks)) return

    /* 1. Already linked? Then this summary has had its task. */
    const { data: existing, error: exErr } = await supabase
      .from('tasks')
      .select('id')
      .eq('meeting_summary_id', row.id)
      .limit(1)
    if (exErr) throw exErr
    if (existing && existing.length > 0) return

    /* 2. Look up the pieces the row needs. The meetings tab doesn't
       hold projects/profiles/task_statuses, and this runs at most
       ONCE per summary, so a small read here is cheaper than keeping
       three lists loaded on a tab that never otherwise needs them. */
    const [{ data: proj }, { data: admins }, { data: statuses }, { data: stageRows }] = await Promise.all([
      supabase.from('projects').select('id, name, stage_id, responsible_id').eq('id', projectId).maybeSingle(),
      /* Earliest admin wins; the 'עינב' fallback below covers a DB
         with no admin row. Never hard-code a uuid — ids differ
         between Dev and Prod. */
      supabase.from('profiles').select('id, first_name, role, created_at')
        .in('role', ['admin', 'employee'])
        .order('created_at', { ascending: true }),
      supabase.from('task_statuses').select('id, name'),
      supabase.from('stages').select('id, name'),
    ])

    const adminRow =
      (admins || []).find(p => p.role === 'admin') ||
      (admins || []).find(p => (p.first_name || '').trim() === 'עינב') ||
      null

    const activeStatus = (statuses || []).find(s => (s.name || '').trim() === 'פעיל') || null

    /* Assignee follows the SUMMARY's stage, matched BY NAME against the
       stages table — ids differ between Dev and Prod, so never compare
       numbers here. The studio-owned stages go to Einav; everything
       else belongs to whoever runs the project, falling back to Einav
       rather than leaving the task unassigned. */
    const summaryStageName = (stageRows || [])
      .find(st => st.id === row.stage_id)?.name?.trim() || ''
    const responsibleId = ADMIN_STAGE_NAMES.has(summaryStageName)
      ? (adminRow?.id ?? null)
      : (proj?.responsible_id ?? adminRow?.id ?? null)

    /* 3. Description — no empty colon / stray dash when untitled. */
    const dateLabel = formatDate(row.meeting_date)
    const topic     = (row.topic ?? '').trim()
    const description = topic
      ? `משימות מתוך פגישה: ${topic} (${dateLabel})`
      : `משימות מתוך פגישה (${dateLabel})`

    /* 4. Mirror NewTaskModal's payload so the row is
       indistinguishable from a hand-created task. stage_id comes from
       the SUMMARY (integer FK) — the meeting is about that stage, which
       is not necessarily the project's current one. */
    const payload = {
      project_id:         projectId,
      project_name:       proj?.name ?? null,
      meeting_summary_id: row.id,
      stage_id:           row.stage_id ?? null,
      responsible_id:     responsibleId,
      status_id:          activeStatus?.id ?? null,
      due_date:           null,
      description,
      /* NOT a link. meeting_summary_id above already says which summary
         this came from, so the tasks tab DERIVES the link from the FK
         (see ProjectDetail). Storing a URL here would duplicate that
         and burn the notes field, which is Einav's to write in. */
      notes:              null,
      hours:              null,
    }
    const { error: insErr } = await supabase.from('tasks').insert([payload])
    if (insErr) throw insErr
  }

  /* Wrapper: never lets a task-creation failure surface as a save
     failure. The summary is already persisted by the time this runs. */
  const runStudioTaskSideEffect = async (row) => {
    try {
      await maybeCreateStudioTask(row)
    } catch (e) {
      console.error('MeetingSummariesTab — auto-task error:', e)
      setTaskNoticeMsg('הסיכום נשמר, אך יצירת המשימה האוטומטית נכשלה')
    }
  }

  /* ── Update an existing summary ─────────────────────────────── */
  const handleUpdate = async (id, payload) => {
    setSavingRow(true)
    setErrorMsg('')
    try {
      const patch = {
        topic:        payload.topic,
        meeting_date: payload.meeting_date,
        participants: payload.participants,
        stage_id:     payload.stage_id,
        summary_md:   payload.summary_md,
        /* Text + flags in ONE update — never written independently. */
        client_tasks:     payload.client_tasks,
        studio_tasks:     payload.studio_tasks,
        has_client_tasks: payload.has_client_tasks,
        has_studio_tasks: payload.has_studio_tasks,
        updated_at:   new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from('meeting_summaries')
        .update(patch)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      setSummaries(prev => prev.map(s => s.id === id ? data : s))
      setEditingId(null)
      /* Same side effect on edit — the idempotency query means an
         existing linked task short-circuits it, so editing a summary
         that already produced one never creates a duplicate. */
      await runStudioTaskSideEffect(data)
    } catch (e) {
      console.error('MeetingSummariesTab — update error:', e)
      setErrorMsg('שגיאה בעדכון הסיכום')
    }
    setSavingRow(false)
  }

  /* ── Delete (with two-step inline confirmation) ─────────────── */
  const handleDelete = async (id) => {
    setErrorMsg('')
    try {
      const { error } = await supabase
        .from('meeting_summaries')
        .delete()
        .eq('id', id)
      if (error) throw error
      setSummaries(prev => prev.filter(s => s.id !== id))
      setConfirmingId(null)
    } catch (e) {
      console.error('MeetingSummariesTab — delete error:', e)
      setErrorMsg('שגיאה במחיקה')
    }
  }

  /* Called from the split-screen editor pane's onSave. Reuses the
     regular create path so the row is indistinguishable from any
     other summary; on success we drop the split view and land back
     on the (now longer) list. */
  const handleProgramCreate = async (payload) => {
    await handleCreate(payload)
    if (!errorMsg) setProgramMode(null)
  }

  /* Same shape as handleProgramCreate, but for editing an existing
     programming summary. Reuses handleUpdate — same UPDATE path any
     other summary edit goes through — then drops the split view on
     success so the newly-updated row shows in the list. */
  const handleProgramUpdate = async (id, payload) => {
    await handleUpdate(id, payload)
    if (!errorMsg) setProgramMode(null)
  }

  /* Programming-summary detection.
     TODO: fragile subject-based detection — replace with a dedicated
           kind/type column on meeting_summaries later.

     A summary counts as "programming" when its topic (trimmed) either
     equals or CONTAINS the default programming subject. The contains
     branch lets auto-numbered variants like "סיכום פגישת פרוגרמה 2"
     (or "עדכון סיכום פגישת פרוגרמה") match too. Hebrew has no case;
     trim handles leading/trailing whitespace. */
  const PROGRAM_TOPIC_MARKER = 'סיכום פגישת פרוגרמה'
  const isProgrammingSummary = (s) => {
    if (!s || typeof s.topic !== 'string') return false
    const t = s.topic.trim()
    if (!t) return false
    return t.includes(PROGRAM_TOPIC_MARKER)
  }

  /* ── Split-screen render (early return) ─────────────────────────
     When "סיכום פגישת פרוגרמה" is active, we hijack the whole tab:
     one pane holds the meeting-summary editor, the other embeds the
     project's programming questionnaire in admin-editable mode. The
     regular list + toolbar reappear after the admin closes this view. */
  if (programMode) {
    /* One split-screen component, two modes. `programMode.row` is
       null for create, an existing summary object for edit — the
       initial payload + onSave differ; everything else (layout,
       questionnaire pane, header, close button) is identical. */
    const editingRow    = programMode.row || null
    const isEditingProg = !!editingRow
    return (
      <FocusedEditorScreen
        title={isEditingProg ? 'עריכת סיכום פגישת פרוגרמה' : 'סיכום פגישת פרוגרמה'}
        onClose={() => setProgramMode(null)}
        closeDisabled={savingRow}
        error={errorMsg}
      >
        {/* Visual-RIGHT pane (first child in RTL): editor. */}
          <section className="ms-program-pane ms-program-pane--editor">
            <div className="ms-program-pane-header">סיכום הפגישה</div>
            <div className="ms-program-pane-body">
              <MeetingEditForm
                /* Two branches:
                     * CREATE — default topic ("סיכום פגישת פרוגרמה"),
                       today's date, empty participants + body.
                     * EDIT   — pass the saved row verbatim so the four
                       fields (topic, meeting_date, participants,
                       summary_md) hydrate from the DB.
                   The topic is editable in both branches — the create
                   value is just a starting point. */
                initial={editingRow ?? {
                  topic:        'סיכום פגישת פרוגרמה',
                  meeting_date: todayISO(),
                  participants: '',
                  /* Programming meetings open on קליטת פרויקט rather
                     than the project's current stage. Stamped HERE, at
                     creation — nothing downstream infers "this is a
                     programming summary" from the topic text. */
                  stage_id:     programDefaultStageId,
                  summary_md:   '',
                  client_tasks: '',
                  studio_tasks: '',
                }}
                stages={stages}
                defaultStageId={programDefaultStageId}
                /* CREATE → INSERT; EDIT → UPDATE the same row id.
                   Both handlers close the split view on success. */
                onSave={isEditingProg
                  ? (payload) => handleProgramUpdate(editingRow.id, payload)
                  : handleProgramCreate}
                onCancel={() => setProgramMode(null)}
                saving={savingRow}
              />
            </div>
          </section>

          {/* Visual-LEFT pane: the questionnaire in admin-edit mode.
              embeddedProjectId bypasses ClientRoute (we're on the
              admin side); forceAdminEdit skips the role probe and
              disables the client-side lock; embedded drops the
              screen title so this pane's own header carries the
              context. Save path lives INSIDE the questionnaire —
              writes to programming_questionnaires by project_id. */}
          <section className="ms-program-pane ms-program-pane--quest">
            <div className="ms-program-pane-header">שאלון פרוגרמה + בונה הבית</div>
            <div className="ms-program-pane-body ms-program-pane-body--flush">
              <ClientProgrammingQuestionnaire
                embeddedProjectId={projectId}
                forceAdminEdit
                embedded
              />
            </div>
          </section>
      </FocusedEditorScreen>
    )
  }

  /* ── Focused editor for a REGULAR summary (early return) ────────
     Same takeover the programming screen does — the list is not
     rendered at all while the form is open. The only difference is
     that there is no questionnaire beside it, so the single pane
     takes the full width.

     Driven by the SAME state as before (draftNew / editingId), so the
     "+" button, the pencil icon, שמור, ביטול and their handlers all
     keep working unchanged; only where the form renders has moved.

     `editingId` is paired with a lookup rather than trusted on its
     own: if that row vanished (deleted in another tab), we fall
     through to the list instead of showing an edit form with nothing
     behind it. */
  const editingSummary = editingId ? summaries.find(s => s.id === editingId) : null
  if (draftNew || editingSummary) {
    const closeFocus = () => { setDraftNew(false); setEditingId(null) }
    return (
      <FocusedEditorScreen
        title={editingSummary ? 'עריכת סיכום פגישה' : 'סיכום פגישה חדש'}
        onClose={closeFocus}
        /* Same guard the programming screen uses — no leaving mid-save. */
        closeDisabled={savingRow}
        error={errorMsg}
      >
        <section className="ms-program-pane ms-program-pane--editor ms-program-pane--full">
          <div className="ms-program-pane-header">סיכום הפגישה</div>
          <div className="ms-program-pane-body">
            <MeetingEditForm
              initial={editingSummary ?? {
                topic: '', meeting_date: todayISO(), participants: '',
                summary_md: '', client_tasks: '', studio_tasks: '',
              }}
              stages={stages}
              defaultStageId={projectStageId}
              /* handleCreate / handleUpdate already clear draftNew /
                 editingId on success, so a successful save lands back
                 on the list on its own. */
              onSave={editingSummary
                ? (payload) => handleUpdate(editingSummary.id, payload)
                : handleCreate}
              onCancel={closeFocus}
              saving={savingRow}
            />
          </div>
        </section>
      </FocusedEditorScreen>
    )
  }

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="ms-root" dir="rtl">

      <div className="ms-toolbar">
        <button
          type="button"
          className="ms-add-btn"
          onClick={() => setDraftNew(true)}
          disabled={draftNew}
        >
          <IconPlus size={14} />
          סיכום פגישה חדש
        </button>
        {/* Programming-meeting variant — same DB row, split-screen UI.
            Always enabled: independent of questionnaire submitted state.
            Passing { row: null } routes into the split view's CREATE
            branch (default topic). */}
        <button
          type="button"
          className="ms-add-btn"
          onClick={() => setProgramMode({ row: null })}
        >
          <IconPlus size={14} />
          סיכום פגישת פרוגרמה
        </button>
      </div>

      {errorMsg && (
        <div className="ms-error" role="alert">{errorMsg}</div>
      )}
      {/* Non-blocking: the summary DID save; only the side effect
          failed. Dismissible so it doesn't linger over the list. */}
      {taskNoticeMsg && (
        <div className="ms-task-notice" role="status">
          {taskNoticeMsg}
          <button
            type="button"
            className="ms-task-notice-close"
            onClick={() => setTaskNoticeMsg('')}
            aria-label="סגור הודעה"
          >×</button>
        </div>
      )}

      {/* The form no longer renders here — creating and editing both
          take over the tab (see the focused-editor early return above),
          so this list only ever shows collapsed/expanded cards. */}
      {loading ? (
        <p className="ms-loading">טוען סיכומים...</p>
      ) : summaries.length === 0 ? (
        <p className="ms-empty">עדיין אין סיכומי פגישות</p>
      ) : (
        summaries.map(s => {
          const isConfirming = confirmingId === s.id
          const isOpen       = openSet.has(s.id)
          return (
            /* id anchors the deep-link scroll target. */
            <section id={`ms-card-${s.id}`} key={s.id} className="ms-card">
              <>
                  {/* Header — clickable to toggle the card open/closed.
                      In RTL: date+participants pinned right, chevron at
                      the visual left; edit/delete icons only appear when
                      the card is open. */}
                  <div
                    className={'ms-card-header ms-card-header--toggle' + (isOpen ? ' ms-card-header--open' : '')}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleOpen(s.id)}
                    onKeyDown={(e) => handleHeaderKeyDown(e, s.id)}
                  >
                    {(() => {
                      const topic = (s.topic ?? '').trim()
                      return (
                        <div className="ms-card-meta">
                          <div className="ms-card-primary">
                            <span className={'ms-card-date' + (topic ? ' ms-card-date--with-topic' : '')}>
                              {formatDate(s.meeting_date)}
                            </span>
                            {topic && (
                              <>
                                <span className="ms-card-sep">·</span>
                                <span className="ms-card-topic ms-meeting-topic">{topic}</span>
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                    <div className="ms-card-actions">
                      {isOpen && (
                        isConfirming ? (
                          <div
                            className="ms-confirm-inline"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <span className="ms-confirm-text">אישור מחיקה?</span>
                            <button
                              type="button"
                              className="ms-confirm-yes"
                              onClick={(e) => { e.stopPropagation(); handleDelete(s.id) }}
                            >כן</button>
                            <button
                              type="button"
                              className="ms-confirm-no"
                              onClick={(e) => { e.stopPropagation(); setConfirmingId(null) }}
                            >לא</button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="ms-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation()
                                /* Programming summaries open in the
                                   split-screen editor pre-loaded with
                                   this row; regular summaries keep
                                   their inline expanding editor. */
                                if (isProgrammingSummary(s)) {
                                  setProgramMode({ row: s })
                                } else {
                                  openCard(s.id)        /* defensive: stays open after save/cancel */
                                  setEditingId(s.id)
                                }
                              }}
                              title="ערוך"
                              aria-label="ערוך סיכום פגישה"
                            >
                              <IconPencil size={15} />
                            </button>
                            <button
                              type="button"
                              className="ms-icon-btn ms-icon-btn--danger"
                              onClick={(e) => { e.stopPropagation(); setConfirmingId(s.id) }}
                              title="מחק"
                              aria-label="מחק סיכום פגישה"
                            >
                              <IconTrash size={15} />
                            </button>
                          </>
                        )
                      )}
                      <span className={'ms-card-chevron' + (isOpen ? ' ms-card-chevron--open' : '')}>
                        <IconChevron size={16} />
                      </span>
                    </div>
                  </div>

                  {isOpen && (() => {
                    const participants = (s.participants ?? '').trim()
                    const hasSummary   = !!(s.summary_md && s.summary_md.trim())
                    /* Same helper the save path uses, so a section can
                       never appear with an empty body (or vanish when
                       it has one). */
                    const showClient = hasRichText(s.client_tasks)
                    const showStudio = hasRichText(s.studio_tasks)
                    /* The linked task row IS the studio status. No row
                       (a summary written before the auto-task existed)
                       means no status line — not an error. */
                    const linkedTask = studioTaskBySummary[s.id]
                    return (
                      <div className="ms-card-body">
                        {participants && (
                          <p className="ms-meeting-participants">
                            משתתפים: {participants}
                          </p>
                        )}
                        {hasSummary ? (
                          /* Trusted, staff-authored HTML from our own
                             TipTap editor. Rendered as-is. */
                          <div
                            className="ms-md-body"
                            dangerouslySetInnerHTML={{ __html: s.summary_md }}
                          />
                        ) : (
                          <p className="ms-card-empty">—</p>
                        )}
                        {showClient && (
                          <>
                            {/* No "בוצע" suffix here — the completion and
                                its attribution live on the status line
                                below, and stating it twice is the clutter
                                we removed. */}
                            <h4 className="ms-tasks-heading">משימות לקוח</h4>
                            {/* Between the heading and the list: the
                                status applies to the whole block, so it
                                reads before the items rather than as a
                                footnote after them.
                                RTL: label first = visual right, then the
                                control, then the trailing text. Indented
                                like .ms-md-body to line up with the
                                content. */}
                            <div className="ms-status-row">
                              <span className="ms-status-label">סטטוס משימה:</span>
                              <TaskStatusControl
                                statusId={s.client_tasks_status_id}
                                statusName={statusNameById(s.client_tasks_status_id)}
                                options={taskStatuses}
                                onSelect={(id) => setClientTasksStatus(s.id, id)}
                              />
                              {/* Once done, the attribution replaces the
                                  hint in the SAME slot and styling. The
                                  icon stays clickable either way, so a
                                  completed block can still be reopened. */}
                              <span className="ms-status-hint">
                                {clientDoneHint(s, doneByNames, statusNameById(s.client_tasks_status_id))
                                  || '(לחץ לעידכון)'}
                              </span>
                            </div>
                            {/* Stays with the control it reports on. */}
                            {doneErrors[s.id] && (
                              <p className="ms-done-error">{doneErrors[s.id]}</p>
                            )}
                            <div
                              className="ms-md-body"
                              dangerouslySetInnerHTML={{ __html: s.client_tasks }}
                            />
                          </>
                        )}
                        {showStudio && (
                          <>
                            {/* No suffix here: the status line below
                                carries this, and two indicators for one
                                fact is exactly the clutter being removed. */}
                            <h4 className="ms-tasks-heading">משימות סטודיו</h4>
                            {/* Between the heading and the list, matching
                                the client block. Bound BOTH ways to the
                                linked task row — reads its status_id and
                                writes it back, so this line and the
                                משימות tab edit one value, not two copies. */}
                            {linkedTask && (
                              <div className="ms-status-row">
                                <span className="ms-status-label">סטטוס משימה:</span>
                                <TaskStatusControl
                                  statusId={linkedTask.status_id}
                                  statusName={statusNameById(linkedTask.status_id)}
                                  options={taskStatuses}
                                  onSelect={(id) => setStudioTaskStatus(s.id, id)}
                                />
                                {/* Nothing once done: the tasks table
                                    records neither who changed the status
                                    nor when, so there is no truthful
                                    attribution to show, and the green
                                    check already says it. The icon stays
                                    clickable, so it can be reopened. */}
                                {statusNameById(linkedTask.status_id) !== DONE_STATUS && (
                                  <span className="ms-status-hint">(לחץ לעידכון)</span>
                                )}
                              </div>
                            )}
                            <div
                              className="ms-md-body"
                              dangerouslySetInnerHTML={{ __html: s.studio_tasks }}
                            />
                            {/* Stays at the BOTTOM of the block, below the
                                list — only the status line moved up. */}
                            {onOpenTasksTab && (
                              <div className="ms-tasks-link-row">
                                <button
                                  type="button"
                                  className="ms-tasks-link"
                                  onClick={onOpenTasksTab}
                                >
                                  לחץ כאן למעבר לדף משימות הפרוייקט
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })()}
              </>
            </section>
          )
        })
      )}
    </div>
  )
}
