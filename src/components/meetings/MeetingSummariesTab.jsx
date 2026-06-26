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

import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import RichTextEditor from './RichTextEditor'
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

/* ── Edit form (used both for brand-new and existing summaries) ────
   The summary editor is now a TipTap-backed WYSIWYG (see
   RichTextEditor); the underlying `summary_md` text column stores HTML
   instead of markdown — no schema change. */
function MeetingEditForm({
  initial,
  onSave,
  onCancel,
  saving,
}) {
  const [meetingDate,  setMeetingDate]  = useState(initial.meeting_date ?? todayISO())
  const [participants, setParticipants] = useState(initial.participants ?? '')
  const [summaryHtml,  setSummaryHtml]  = useState(initial.summary_md   ?? '')

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      meeting_date: meetingDate || todayISO(),
      participants: participants.trim() || null,
      summary_md:   summaryHtml,
    })
  }

  return (
    <form className="ms-edit-form" onSubmit={handleSubmit} dir="rtl">
      <div className="ms-edit-row">
        <label className="ms-edit-label">תאריך הפגישה</label>
        <input
          type="date"
          className="ms-edit-input"
          value={meetingDate}
          onChange={e => setMeetingDate(e.target.value)}
          required
        />
      </div>

      <div className="ms-edit-row">
        <label className="ms-edit-label">משתתפים</label>
        <input
          type="text"
          className="ms-edit-input"
          value={participants}
          onChange={e => setParticipants(e.target.value)}
          placeholder="משתתפים"
          dir="rtl"
        />
      </div>

      <div className="ms-edit-row ms-edit-row--md">
        <label className="ms-edit-label">סיכום</label>
        <RichTextEditor
          value={summaryHtml}
          onChange={setSummaryHtml}
          placeholder="סיכום הפגישה"
        />
      </div>

      <div className="ms-edit-actions">
        <button type="submit" className="ms-btn-primary" disabled={saving}>
          {saving ? 'שומר...' : 'שמור'}
        </button>
        <button type="button" className="ms-btn-secondary" onClick={onCancel} disabled={saving}>
          ביטול
        </button>
      </div>
    </form>
  )
}

/* ── Main tab ────────────────────────────────────────────────────── */
export default function MeetingSummariesTab({ projectId }) {
  const [summaries,      setSummaries]      = useState([])
  const [loading,        setLoading]        = useState(true)
  const [draftNew,       setDraftNew]       = useState(false)    /* "+ new" pending card */
  const [editingId,      setEditingId]      = useState(null)     /* row id currently in edit mode */
  const [confirmingId,   setConfirmingId]   = useState(null)     /* row id pending delete confirmation */
  const [savingRow,      setSavingRow]      = useState(false)
  const [errorMsg,       setErrorMsg]       = useState('')
  /* Accordion state — Set of currently-open summary ids. Default: all
     collapsed; clicking a card header toggles only that card. */
  const [openSet,        setOpenSet]        = useState(new Set())

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
      .select('*')
      .eq('project_id', projectId)
      .order('meeting_date', { ascending: false })
      .order('created_at',   { ascending: false })
    if (error) {
      console.error('MeetingSummariesTab — load error:', error)
      setErrorMsg('שגיאה בטעינת סיכומים')
      setSummaries([])
    } else {
      setSummaries(Array.isArray(data) ? data : [])
      setErrorMsg('')
    }
    setLoading(false)
  }

  useEffect(() => { loadSummaries() }, [projectId])

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
          meeting_date: payload.meeting_date,
          participants: payload.participants,
          summary_md:   payload.summary_md,
          source:       'manual',
          created_by:   userId,
        })
        .select()
        .single()
      if (error) throw error
      setSummaries(prev => [data, ...prev])
      setDraftNew(false)
    } catch (e) {
      console.error('MeetingSummariesTab — create error:', e)
      setErrorMsg('שגיאה בשמירת הסיכום')
    }
    setSavingRow(false)
  }

  /* ── Update an existing summary ─────────────────────────────── */
  const handleUpdate = async (id, payload) => {
    setSavingRow(true)
    setErrorMsg('')
    try {
      const patch = {
        meeting_date: payload.meeting_date,
        participants: payload.participants,
        summary_md:   payload.summary_md,
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
      </div>

      {errorMsg && (
        <div className="ms-error" role="alert">{errorMsg}</div>
      )}

      {/* New-summary draft card (only when "+" was clicked) */}
      {draftNew && (
        <section className="ms-card ms-card--draft">
          <MeetingEditForm
            initial={{ meeting_date: todayISO(), participants: '', summary_md: '' }}
            onSave={handleCreate}
            onCancel={() => setDraftNew(false)}
            saving={savingRow}
          />
        </section>
      )}

      {loading ? (
        <p className="ms-loading">טוען סיכומים...</p>
      ) : summaries.length === 0 && !draftNew ? (
        <p className="ms-empty">עדיין אין סיכומי פגישות</p>
      ) : (
        summaries.map(s => {
          const isEditing    = editingId === s.id
          const isConfirming = confirmingId === s.id
          const isOpen       = openSet.has(s.id)
          return (
            <section key={s.id} className={'ms-card' + (isEditing ? ' ms-card--editing' : '')}>
              {isEditing ? (
                <MeetingEditForm
                  initial={s}
                  onSave={(payload) => handleUpdate(s.id, payload)}
                  onCancel={() => setEditingId(null)}
                  saving={savingRow}
                />
              ) : (
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
                    <div className="ms-card-meta">
                      <span className="ms-card-date">{formatDate(s.meeting_date)}</span>
                      {s.participants && (
                        <>
                          <span className="ms-card-sep">·</span>
                          <span className="ms-card-participants">{s.participants}</span>
                        </>
                      )}
                    </div>
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
                                openCard(s.id)        /* defensive: stays open after save/cancel */
                                setEditingId(s.id)
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

                  {isOpen && (
                    <div className="ms-card-body">
                      {s.summary_md && s.summary_md.trim() ? (
                        /* Trusted, staff-authored HTML from our own
                           TipTap editor. Rendered as-is. */
                        <div
                          className="ms-md-body"
                          dangerouslySetInnerHTML={{ __html: s.summary_md }}
                        />
                      ) : (
                        <p className="ms-card-empty">—</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
