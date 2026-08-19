// src/pages/reports/ClientUsabilityReport.jsx
//
// Admin-only report under "דוחות": "דוח שימושיות לקוחות".
// Reads client_activity_log (screen_view / action / error rows, written
// by src/lib/clientActivityLog.js from the real client portal — admin
// preview traffic never lands here). Two view modes:
//   'project' — one project's client(s), scoped by project + date range.
//   'all'     — every project/client, scoped by date range only. Default.
// Both render the same table: screen / views / avg duration / errors /
// exits, sorted by views descending.

import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { MENU_ITEMS } from '../ClientPortal'
import '../ReportTable.css'

const SCREEN_LABELS = Object.fromEntries(MENU_ITEMS.map(m => [m.key, m.label]))
const screenLabel = (key) => SCREEN_LABELS[key] || key

/* Most recent N events shown when a row is drilled into. The fetch asks
   for one MORE than this so a full page can be told apart from an
   exactly-full one — see fetchScreenDetails. */
const DETAIL_LIMIT = 100

const EVENT_TYPE_LABELS = {
  screen_view: 'צפייה במסך',
  action:      'פעולה',
  error:       'שגיאה',
}
const eventTypeLabel = (t) => EVENT_TYPE_LABELS[t] || t

/* dd/MM/yyyy HH:mm in the viewer's local zone — created_at is timestamptz,
   so the Date parse is unambiguous. */
function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgoIso(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/* Exclusive upper bound (start of the day AFTER dateStr) so the whole
   `toDate` calendar day is included regardless of time-of-day. */
function nextDayIso(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + 1)
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}T00:00:00`
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—'
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/* The per-screen rollup that used to live here (views / avg duration /
   errors / exits) now runs in Postgres — see the `client_usability_report`
   function. It moved server-side so the row cap on the raw-row fetch
   couldn't silently truncate the input and skew the totals; the exit rule
   in particular (per session, the screen of the chronologically last
   screen_view) needs every row of a session to be correct.

   The one deliberate difference from the old client-side version: ties on
   created_at within a session now break on id, so the exit screen is
   deterministic rather than dependent on row arrival order. */

export default function ClientUsabilityReport() {
  const navigate = useNavigate()
  const [role, setRole] = useState(null)

  const [viewMode, setViewMode] = useState('all') // 'all' | 'project' — 'all' is the default landing view
  const [projects, setProjects] = useState([])

  const [projectQuery, setProjectQuery] = useState('')
  const [projectOpen, setProjectOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState(null)

  const [fromDate, setFromDate] = useState(() => daysAgoIso(30))
  const [toDate, setToDate] = useState(() => todayIso())

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  /* Per-screen drill-down state, keyed by screen_key. Same three-part
     shape HoursReport uses for its per-employee drill, so the two
     reports behave identically:
       drillExpanded — Set of expanded screen_keys. A SET, not a single
                       id: HoursReport lets several rows stay open at
                       once and comparing two screens side by side is
                       exactly what this drill is for.
       drillCache    — { [screen_key]: { events, truncated } }, filled on
                       FIRST expand only, so re-expanding costs nothing.
       drillLoading  — Set of screen_keys with a fetch in flight.
     Cleared on every new report fetch (see fetchReport) so a cached
     list can never outlive the filters it was fetched under. */
  const [drillExpanded, setDrillExpanded] = useState(() => new Set())
  const [drillCache,    setDrillCache]    = useState({})
  const [drillLoading,  setDrillLoading]  = useState(() => new Set())

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')

      const { data: projs } = await supabase
        .from('projects').select('id, name').eq('archived', false).order('name')
      if (projs) setProjects(projs)
    }
    init()
  }, [])

  /* Only filter the combobox list while actively typing a NEW search
     (mirrors ProjectHoursReport's fix — reopening after a project is
     already selected shows the full list again, not just itself). */
  const filteredProjects = (!selectedProject && projectQuery.trim())
    ? projects.filter(p => p.name.toLowerCase().includes(projectQuery.trim().toLowerCase()))
    : projects

  const canSearch = !!fromDate && !!toDate && (viewMode === 'all' || !!selectedProject)

  const fetchReport = async () => {
    if (!canSearch) return
    setLoading(true)
    setSearched(true)

    /* Aggregated SERVER-SIDE. The previous version pulled every raw row
       in the range down to the browser and rolled it up here, which
       meant PostgREST's row cap would eventually truncate the input and
       the report would show quietly wrong totals with nothing to
       indicate it. The RPC returns one row per screen — a handful —
       so no cap can ever come near it. */
    const { data, error } = await supabase.rpc('client_usability_report', {
      p_from:       `${fromDate}T00:00:00`,
      p_to:         nextDayIso(toDate),          /* exclusive upper bound */
      p_project_id: viewMode === 'project' ? selectedProject.id : null,
    })
    if (error) {
      console.error('ClientUsabilityReport fetch error:', error)
      setRows([])
      setLoading(false)
      return
    }
    /* snake_case from Postgres → the camelCase shape the table renders. */
    setRows((data || []).map(r => ({
      screen_key:    r.screen_key,
      views:         r.views,
      avgDurationMs: r.avg_duration_ms,
      errors:        r.errors,
      exits:         r.exits,
    })))
    /* Drop every cached drill — those lists were fetched under the
       PREVIOUS filters and would otherwise silently contradict the
       aggregates they sit under. */
    setDrillExpanded(new Set())
    setDrillCache({})
    setLoading(false)
  }

  /* ── Drill-down: the individual events behind one aggregate row ──
     Scoped exactly like the aggregate above it — same date range, and
     the same project filter in "פרויקט ספציפי" mode — so the detail can
     never describe a wider population than the numbers it explains.

     Client and project names come back embedded off the two foreign
     keys client_activity_log already declares (client_user_id →
     client_users, project_id → projects), so this stays ONE round trip
     rather than a second lookup per distinct id. */
  const fetchScreenDetails = async (screenKey) => {
    let query = supabase
      .from('client_activity_log')
      .select(`
        id, created_at, event_type, action_name, duration_ms,
        project_id, client_user_id,
        projects ( name ),
        client_users ( first_name, email )
      `)
      .eq('screen_key', screenKey)
      .gte('created_at', `${fromDate}T00:00:00`)
      .lt('created_at', nextDayIso(toDate))
      .order('created_at', { ascending: false })
      /* One MORE than we'll show: if the extra row comes back we know
         there are further events beyond the cap, without paying for a
         separate count query. */
      .limit(DETAIL_LIMIT + 1)
    if (viewMode === 'project') query = query.eq('project_id', selectedProject.id)

    const { data, error } = await query
    if (error) {
      console.error('ClientUsabilityReport detail fetch error:', error)
      return { events: [], truncated: false, failed: true }
    }

    const all       = data || []
    const truncated = all.length > DETAIL_LIMIT
    const events    = truncated ? all.slice(0, DETAIL_LIMIT) : all

    /* Live client names, resolved the SAME way the client portal
       resolves its own greeting: the client's auth email matched
       against project_contacts.email for their project, trimmed and
       case-insensitive. client_users.first_name is only a snapshot
       taken at first login and goes stale once a contact is renamed,
       so it serves as the fallback rather than the source. */
    const projectIds = [...new Set(events.map(e => e.project_id).filter(Boolean))]
    let contactsByKey = new Map()
    if (projectIds.length > 0) {
      const { data: contacts } = await supabase
        .from('project_contacts')
        .select('project_id, first_name, last_name, email')
        .in('project_id', projectIds)
        .order('id')                    /* deterministic when several match */
      for (const c of (contacts || [])) {
        const email = (c.email || '').trim().toLowerCase()
        if (!email) continue
        const key = `${c.project_id}|${email}`
        const list = contactsByKey.get(key) || []
        list.push(c)
        contactsByKey.set(key, list)
      }
    }

    const nameFor = (row) => {
      const email = (row.client_users?.email || '').trim().toLowerCase()
      const matches = email ? contactsByKey.get(`${row.project_id}|${email}`) : null
      if (matches && matches.length > 0) {
        const first = (matches[0].first_name || '').trim()
        /* Family case (partners sharing one login): take the first
           non-empty surname across the matching contacts, same rule the
           portal uses. */
        let last = ''
        for (const m of matches) {
          const ln = (m.last_name ?? '').trim()
          if (ln !== '') { last = ln; break }
        }
        const full = `${first} ${last}`.trim()
        if (full) return full
      }
      return (row.client_users?.first_name || '').trim() || '—'
    }

    return {
      truncated,
      failed: false,
      events: events.map(e => ({
        id:          e.id,
        createdAt:   e.created_at,
        eventType:   e.event_type,
        actionName:  e.action_name,
        durationMs:  e.duration_ms,
        clientName:  nameFor(e),
        projectName: e.projects?.name || '—',
      })),
    }
  }

  const toggleDrill = async (screenKey) => {
    if (drillExpanded.has(screenKey)) {
      setDrillExpanded(prev => { const n = new Set(prev); n.delete(screenKey); return n })
      return
    }
    setDrillExpanded(prev => new Set(prev).add(screenKey))
    if (drillCache[screenKey]) return          /* already fetched — no refetch */
    setDrillLoading(prev => new Set(prev).add(screenKey))
    const detail = await fetchScreenDetails(screenKey)
    setDrillCache(prev => ({ ...prev, [screenKey]: detail }))
    setDrillLoading(prev => { const n = new Set(prev); n.delete(screenKey); return n })
  }

  /* One event = one line, mirroring HoursReport's drill body. The
     project is dropped in "פרויקט ספציפי" mode, where every row belongs
     to the one project already named in the filter above. */
  const formatEventLine = (e) => {
    const parts = [formatDateTime(e.createdAt), e.clientName]
    if (viewMode === 'all') parts.push(e.projectName)
    parts.push(eventTypeLabel(e.eventType))
    if (e.actionName) parts.push(e.actionName)
    if (e.durationMs !== null && e.durationMs !== undefined) parts.push(formatDuration(e.durationMs))
    return parts.join(' · ')
  }

  const renderDrillBody = (screenKey) => {
    if (drillLoading.has(screenKey)) return <div className="hours-drill-loading">טוען...</div>
    const detail = drillCache[screenKey]
    if (!detail) return null
    if (detail.failed) return <div className="hours-drill-empty">שגיאה בטעינת פירוט האירועים</div>
    if (detail.events.length === 0) return <div className="hours-drill-empty">אין אירועים להצגה</div>
    return (
      <>
        {detail.events.map(e => (
          <div key={e.id} className="hours-drill-line">{formatEventLine(e)}</div>
        ))}
        {detail.truncated && (
          <div className="hours-drill-empty">
            מוצגים {DETAIL_LIMIT} האירועים האחרונים בלבד — יש אירועים נוספים בטווח שנבחר.
            צמצמי את טווח התאריכים כדי לראות את כולם.
          </div>
        )}
      </>
    )
  }

  /* Auto-load once on mount — "כלל הלקוחות" (the default) already has
     everything it needs (a default date range, no project required). */
  useEffect(() => {
    if (role !== 'admin') return
    fetchReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role])

  if (role !== 'admin') return null

  return (
    <div className="report-table-page" dir="rtl">
      <div className="report-header-row">
        <h1 className="report-page-title">דוח שימושיות לקוחות</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>← חזרה לדוחות</button>
      </div>

      {/* View-mode toggle */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 16 }}>
        {[
          { key: 'all',     label: 'כלל הלקוחות' },
          { key: 'project', label: 'פרויקט ספציפי' },
        ].map((opt, i) => {
          const selected = viewMode === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => { setViewMode(opt.key); setSearched(false); setRows([]) }}
              style={{
                background: selected ? '#2D3748' : '#fff',
                color:      selected ? '#fff' : '#2D3748',
                border: '1px solid #2D3748',
                borderInlineStartWidth: i === 0 ? 1 : 0,
                padding: '8px 20px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      <div className="report-controls" style={{ flexWrap: 'wrap' }}>
        {viewMode === 'project' && (
          <div style={{ position: 'relative', width: 320, maxWidth: '100%' }}>
            <input
              type="text"
              className="report-project-select"
              style={{ width: '100%', boxSizing: 'border-box' }}
              placeholder="חפשי פרויקט לפי שם..."
              value={projectQuery}
              onChange={e => { setProjectQuery(e.target.value); setSelectedProject(null); setProjectOpen(true) }}
              onFocus={() => setProjectOpen(true)}
              onBlur={() => setTimeout(() => setProjectOpen(false), 150)}
            />
            {projectOpen && filteredProjects.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, left: 0, zIndex: 20,
                background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
                boxShadow: '0 4px 12px rgba(0,0,0,0.12)', marginTop: 4,
                maxHeight: 240, overflowY: 'auto',
              }}>
                {filteredProjects.map(p => (
                  <div
                    key={p.id}
                    onMouseDown={() => { setSelectedProject(p); setProjectQuery(p.name); setProjectOpen(false) }}
                    style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 14, color: '#2D3748' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                  >
                    {p.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="report-select-label">מתאריך:</label>
        <input
          type="date"
          className="report-project-select"
          style={{ width: 160, fontFamily: 'inherit' }}
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
        />

        <label className="report-select-label">עד תאריך:</label>
        <input
          type="date"
          className="report-project-select"
          style={{ width: 160, fontFamily: 'inherit' }}
          value={toDate}
          onChange={e => setToDate(e.target.value)}
        />

        <button
          className="hours-report-fetch-btn"
          onClick={fetchReport}
          disabled={!canSearch}
          style={!canSearch ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
        >
          הצג
        </button>
      </div>

      {viewMode === 'project' && !selectedProject && (
        <p className="report-empty">בחרי פרויקט וטווח תאריכים להצגת הדוח</p>
      )}

      {(viewMode === 'all' || selectedProject) && searched && loading && (
        <p className="report-loading">טוען...</p>
      )}

      {(viewMode === 'all' || selectedProject) && searched && !loading && rows.length === 0 && (
        <p className="report-empty">אין נתוני שימושיות בטווח התאריכים שנבחר</p>
      )}

      {(viewMode === 'all' || selectedProject) && searched && !loading && rows.length > 0 && (
        <div className="report-card" style={{ overflow: 'hidden', width: '100%' }}>
          <table className="report-stage-table">
            <thead>
              <tr>
                <th>מסך</th>
                <th>צפיות</th>
                <th>משך צפייה ממוצע</th>
                <th>שגיאות</th>
                <th>יציאות</th>
                <th className="hours-drill-toggle-header" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isOpen = drillExpanded.has(row.screen_key)
                return (
                  <Fragment key={row.screen_key}>
                    {/* The whole row is the expand target, with the +/−
                        button as the visible affordance — clicking either
                        does the same thing. */}
                    <tr
                      onClick={() => toggleDrill(row.screen_key)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>{screenLabel(row.screen_key)}</td>
                      <td>{row.views}</td>
                      <td>{formatDuration(row.avgDurationMs)}</td>
                      <td>{row.errors}</td>
                      <td>{row.exits}</td>
                      <td className="hours-drill-toggle-cell">
                        <button
                          type="button"
                          className="hours-drill-toggle"
                          /* The row already handles the click; stop it
                             here so the button doesn't toggle twice. */
                          onClick={(e) => { e.stopPropagation(); toggleDrill(row.screen_key) }}
                          aria-expanded={isOpen}
                          title={isOpen ? 'סגור' : 'הצג אירועים'}
                        >
                          {isOpen ? '−' : '+'}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="hours-drill-row">
                        <td colSpan={6}>
                          <div className="hours-drill-list">{renderDrillBody(row.screen_key)}</div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
