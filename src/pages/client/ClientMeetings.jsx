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

import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'

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
  const { project_id } = useClient()
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  /* All blocks collapsed on mount. Independent toggle per card. */
  const [openSet, setOpenSet] = useState(new Set())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!project_id) { setLoading(false); return }
      const { data, error } = await supabase
        .from('meeting_summaries')
        .select('id, meeting_date, participants, summary_md')
        .eq('project_id', project_id)
        .order('meeting_date', { ascending: false })
        .order('created_at',   { ascending: false })
      if (cancelled) return
      if (error) {
        console.error('ClientMeetings — fetch error:', error)
        setItems([])
      } else {
        setItems(Array.isArray(data) ? data : [])
      }
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [project_id])

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
              const isOpen      = openSet.has(s.id)
              const dateLabel   = formatDate(s.meeting_date)
              const hasContent  = s.summary_md && s.summary_md.trim() !== ''
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
                    <span className="cp-progress-header-name">{dateLabel}</span>
                    {participants && (
                      <span className="cp-progress-header-caption">{participants}</span>
                    )}
                    <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                      <IconChevron size={16} />
                    </span>
                  </div>
                  {isOpen && (
                    <div className="cp-acc-body">
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
