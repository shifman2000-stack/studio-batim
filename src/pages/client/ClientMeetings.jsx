// src/pages/client/ClientMeetings.jsx
//
// Read-only client mirror of the manager's MeetingSummariesTab. Shows
// meeting_summaries rows for the current client's project as an
// accordion — one collapsible block per meeting. Defaults to all
// collapsed; tapping the header expands a single block to reveal the
// rendered HTML summary.
//
// The body is rendered via dangerouslySetInnerHTML — the content is
// trusted staff-authored HTML produced by our own TipTap editor, never
// external input. Client RLS limits this fetch to summaries whose
// project_id matches the client_users.project_id for auth.uid().

import { useEffect, useMemo, useState } from 'react'
import { supabase, isPreviewBlockedError } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'
/* Shared emptiness rule — the SAME helper the manager tab uses to set
   the has_* flags and to decide what to render, so both screens agree. */
import { hasRichText } from '../../components/meetings/RichTextEditor'
/* Same wording the manager card renders, from the same row. */
import {
  clientDoneHint, DONE_STATUS, CLIENT_DONE_LABEL,
} from '../../components/meetings/meetingTasksStatus'
import { resolveUserNames } from '../../lib/resolveUserNames'
import { logAction, logError } from '../../lib/clientActivityLog'
/* The SAME status widget the משימות tab uses — not a portal copy. */
import TaskStatusControl from '../../components/tasks/TaskStatusControl'
/* "דרוש טיפול" — one module decides, this screen only draws. */
import { computeMeetingActionRequired, doneStatusIdFrom } from '../../lib/actionRequired'
import { ActionRequiredDot } from '../../components/ActionRequiredBadge'

const IconChevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export default function ClientMeetings() {
  const { id: clientUserId, project_id, previewMode } = useClient()
  const logCtx = { projectId: project_id, clientUserId, previewMode }
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  /* All blocks collapsed on mount. Independent toggle per card. */
  const [openSet, setOpenSet] = useState(new Set())
  /* uuid → display name for client_tasks_done_by, resolved in ONE batch
     across every summary. The marker can be set by the client OR by
     staff, so it goes through the shared resolver. */
  const [doneByNames, setDoneByNames] = useState({})
  /* The status rows, used to map client_tasks_status_id ↔ name. The
     portal only ever offers two of them — see clientOptions below. */
  const [taskStatuses, setTaskStatuses] = useState([])
  /* Summary id mid-flight, and per-summary message for a rejected
     write. */
  const [doneBusyId,  setDoneBusyId]  = useState(null)
  const [doneErrors,  setDoneErrors]  = useState({})

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!project_id) { setLoading(false); return }
      const { data, error } = await supabase
        .from('meeting_summaries')
        .select('id, meeting_date, topic, participants, summary_md, client_tasks, studio_tasks, has_client_tasks, client_tasks_status_id, client_tasks_done_at, client_tasks_done_by')
        .eq('project_id', project_id)
        .order('meeting_date', { ascending: false })
        .order('created_at',   { ascending: false })
      if (cancelled) return
      if (error) {
        console.error('ClientMeetings — fetch error:', error)
        setItems([])
        setDoneByNames({})
        setLoading(false)
        return
      }
      const rows = Array.isArray(data) ? data : []
      setItems(rows)
      setLoading(false)

      /* The status lookup. task_statuses is a 3-row reference table with
         no RLS, readable by the client — unlike `tasks`, which the
         portal must never touch and doesn't: the studio status is
         deliberately MANAGER-SIDE ONLY. This screen reads
         meeting_summaries / task_statuses / profiles / client_users /
         project_contacts, and nothing else. */
      const { data: statusRows } = await supabase
        .from('task_statuses')
        .select('id, name')
        .order('id')
      if (cancelled) return
      setTaskStatuses(Array.isArray(statusRows) ? statusRows : [])

      const doneByIds = rows.map(r => r.client_tasks_done_by).filter(Boolean)
      const map = doneByIds.length > 0 ? await resolveUserNames(doneByIds) : {}
      if (cancelled) return
      setDoneByNames(map)
    }
    load()
    return () => { cancelled = true }
  }, [project_id])

  const statusNameById = (id) => taskStatuses.find(t => t.id === id)?.name || ''
  const activeStatus   = taskStatuses.find(t => t.name === 'פעיל')
  const doneStatus     = taskStatuses.find(t => t.name === DONE_STATUS)

  /* "דרוש טיפול" dots. Derived from the SAME module the home tiles
     count with — this screen never decides for itself what counts as
     open, so the tile's number and the dots on this page cannot
     disagree. Recomputed from local state, so marking a summary בוצע
     clears its dot immediately without a round-trip. */
  const openMeetingIds = useMemo(() => {
    try {
      return new Set(
        computeMeetingActionRequired(items, doneStatusIdFrom(taskStatuses)).openIds
      )
    } catch (e) {
      /* Same defensive posture as the documents path: a failure yields
         NO dots rather than a broken screen. */
      console.warn('computeMeetingActionRequired failed:', e)
      return new Set()
    }
  }, [items, taskStatuses])

  /* The portal speaks a TWO-state language. דחוף is a studio-internal
     distinction — to the client it must look exactly like פעיל, so it
     is never offered and never displayed. */
  const clientOptions = [
    activeStatus && { id: activeStatus.id, name: activeStatus.name },
    doneStatus   && { id: doneStatus.id,   name: doneStatus.name, label: CLIENT_DONE_LABEL },
  ].filter(Boolean)

  /* Collapse דחוף onto פעיל for display. */
  const effectiveStatusId = (row) =>
    statusNameById(row.client_tasks_status_id) === DONE_STATUS
      ? doneStatus?.id
      : activeStatus?.id

  /* ── Set the whole client-tasks block's status ──
     Always through the RPC: client_tasks_status_id is not directly
     writable by the client, so a plain update would fail under RLS. The
     RPC also rejects דחוף from a client — the UI simply never offers
     it, so that rejection should never be reachable from here.

     Optimistic, then reconciled against the server's own done_at/done_by
     stamps; reverted on failure so the control never shows a status the
     DB rejected. Going back to פעיל is allowed and clears the marker. */
  const setClientTasksStatus = async (summaryId, statusId) => {
    const before = items.find(s => s.id === summaryId)
    if (!before || doneBusyId === summaryId) return
    if (before.client_tasks_status_id === statusId) return

    setDoneBusyId(summaryId)
    setDoneErrors(prev => {
      if (!(summaryId in prev)) return prev
      const next = { ...prev }
      delete next[summaryId]
      return next
    })
    setItems(prev => prev.map(s =>
      s.id === summaryId ? { ...s, client_tasks_status_id: statusId } : s
    ))

    const { error } = await supabase.rpc('set_meeting_client_tasks_status', {
      p_summary_id: summaryId,
      p_status_id:  statusId,
    })

    if (error) {
      /* Roll the optimistic flip back either way — nothing persisted.
         But a write the client-preview guard blocked ON PURPOSE is not
         a failure, so it gets no red message and no error event. */
      setItems(prev => prev.map(s => s.id === summaryId ? {
        ...s,
        client_tasks_status_id: before.client_tasks_status_id,
        client_tasks_done_at:   before.client_tasks_done_at,
        client_tasks_done_by:   before.client_tasks_done_by,
      } : s))
      if (!isPreviewBlockedError(error)) {
        console.error('ClientMeetings — status error:', error)
        setDoneErrors(prev => ({ ...prev, [summaryId]: 'לא הצלחנו לעדכן את הסטטוס' }))
        logError('meetings', 'mark_task_status_failed', logCtx, { summary_id: summaryId })
      }
      setDoneBusyId(null)
      return
    }

    /* "marking a meeting client-task done" — only the transition INTO
       the done status counts as this action; switching back to פעיל
       isn't. */
    if (statusId === doneStatus?.id) {
      logAction('meetings', 'mark_task_done', logCtx, { summary_id: summaryId })
    }

    const { data: fresh } = await supabase
      .from('meeting_summaries')
      .select('id, client_tasks_status_id, client_tasks_done_at, client_tasks_done_by')
      .eq('id', summaryId)
      .single()
    if (fresh) {
      setItems(prev => prev.map(s => s.id === summaryId ? { ...s, ...fresh } : s))
      if (fresh.client_tasks_done_by && !doneByNames[fresh.client_tasks_done_by]) {
        const map = await resolveUserNames([fresh.client_tasks_done_by])
        setDoneByNames(prev => ({ ...prev, ...map }))
      }
    }
    setDoneBusyId(null)
  }

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

  if (loading) {
    return (
      <div className="cp-page">
        <div className="cp-container">
          <h1 className="cp-screen-title">סיכומי פגישות</h1>
          <div className="cp-loading"><p>טוען...</p></div>
        </div>
      </div>
    )
  }

  return (
    <div className="cp-page">
      <div className="cp-container">
        <h1 className="cp-screen-title">סיכומי פגישות</h1>

        {items.length === 0 ? (
          <section className="cp-card">
            <p className="cp-empty-card">עדיין אין סיכומי פגישות</p>
          </section>
        ) : (
          <div className="cp-progress-accordion">
            {items.map(s => {
              const isOpen       = openSet.has(s.id)
              const dateLabel    = formatDate(s.meeting_date)
              const hasContent   = s.summary_md && s.summary_md.trim() !== ''
              const topic        = (s.topic ?? '').trim()
              const participants = (s.participants ?? '').trim()
              return (
                <section key={s.id} className="cp-progress-block">
                  <div
                    className="cp-progress-header"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleOpen(s.id)}
                    onKeyDown={(e) => handleHeaderKeyDown(e, s.id)}
                  >
                    {/* Title on top, the "דרוש טיפול" line under it. A
                        column so the notice sits BELOW the meeting name
                        instead of competing with it on the title row; the
                        chevron stays a sibling and keeps its own
                        margin-inline-start:auto anchoring. */}
                    <div className="cp-meetings-header-text">
                      <span
                        className={
                          'cp-progress-header-name'
                          + (topic ? ' cp-meeting-title-line' : '')
                        }
                      >
                        {topic ? (
                          <>
                            <span className="cp-meetings-header-date">{dateLabel}</span>
                            <span className="cp-meetings-header-sep"> · </span>
                            <span className="cp-meetings-header-topic cp-meeting-topic">{topic}</span>
                          </>
                        ) : (
                          dateLabel
                        )}
                      </span>
                      {/* Only when that summary has open client tasks —
                          same condition as before, so nothing is rendered
                          (and no space reserved) otherwise.
                          RTL: dot is FIRST in the DOM, so it lands at the
                          visual right with the text to its left. */}
                      {openMeetingIds.has(s.id) && (
                        <span className="cp-meetings-todo">
                          <ActionRequiredDot />
                          <span className="cp-meetings-todo-text">יש לך משימות להשלים</span>
                        </span>
                      )}
                    </div>
                    <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                      <IconChevron size={16} />
                    </span>
                  </div>
                  {isOpen && (
                    <div className="cp-acc-body">
                      {participants && (
                        <p className="cp-meeting-participants">
                          משתתפים: {participants}
                        </p>
                      )}
                      {hasContent ? (
                        /* Staff-authored HTML from our own TipTap editor,
                           safe to render verbatim. */
                        <div
                          className="cp-meetings-body"
                          dangerouslySetInnerHTML={{ __html: s.summary_md }}
                        />
                      ) : (
                        <p className="cp-empty-card">—</p>
                      )}
                      {/* Task sections — same shared emptiness helper the
                          manager card and the save path use, so the two
                          screens can never disagree about what shows. */}
                      {hasRichText(s.client_tasks) && (
                        <>
                          {/* No "בוצע" suffix here — the completion and
                              its attribution live on the status line
                              below, same as the manager card. */}
                          <h4 className="cp-meetings-tasks-heading">משימות לקוח</h4>
                          {/* Between the heading and the list, matching
                              the manager card: the status applies to the
                              whole block, so it reads before the items.
                              RTL, right to left: label, control, trailing
                              text. Same widget and wording as the manager
                              card; only the option list is narrower. */}
                          {clientOptions.length === 2 && (
                            <div className="cp-meetings-status-row">
                              <span className="cp-meetings-status-label">סטטוס משימה:</span>
                              <TaskStatusControl
                                statusId={effectiveStatusId(s)}
                                statusName={statusNameById(effectiveStatusId(s))}
                                options={clientOptions}
                                onSelect={(id) => setClientTasksStatus(s.id, id)}
                              />
                              {/* Once done, the attribution replaces the
                                  hint in the SAME slot and styling. Keyed
                                  on the REAL status, not the two-state
                                  display one, so דחוף still reads as
                                  "(לחץ לעידכון)" like פעיל. */}
                              <span className="cp-meetings-status-hint">
                                {clientDoneHint(s, doneByNames, statusNameById(s.client_tasks_status_id))
                                  || '(לחץ לעידכון)'}
                              </span>
                            </div>
                          )}
                          {/* Stays with the control it reports on. */}
                          {doneErrors[s.id] && (
                            <p className="cp-meetings-done-error">{doneErrors[s.id]}</p>
                          )}
                          <div
                            className="cp-meetings-body"
                            dangerouslySetInnerHTML={{ __html: s.client_tasks }}
                          />
                        </>
                      )}
                      {hasRichText(s.studio_tasks) && (
                        <>
                          <h4 className="cp-meetings-tasks-heading">משימות סטודיו</h4>
                          <div
                            className="cp-meetings-body"
                            dangerouslySetInnerHTML={{ __html: s.studio_tasks }}
                          />
                        </>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
