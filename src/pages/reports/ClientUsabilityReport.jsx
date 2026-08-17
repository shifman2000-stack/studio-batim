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

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { MENU_ITEMS } from '../ClientPortal'
import '../ReportTable.css'

const SCREEN_LABELS = Object.fromEntries(MENU_ITEMS.map(m => [m.key, m.label]))
const screenLabel = (key) => SCREEN_LABELS[key] || key

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

/**
 * Roll raw client_activity_log rows up to one row per screen_key:
 * views (screen_view count), avgDurationMs (over screen_view rows that
 * DO have a duration — a null duration means the row was never closed
 * out, e.g. an abrupt tab kill, and is excluded rather than counted as
 * zero), errors (error-event count), exits.
 *
 * "Exit" — for each session_id, the screen_key of the chronologically
 * LAST screen_view row in that session (by created_at) gets +1 exit.
 * That's "the screen the session was on when activity in this session
 * stopped" — the standard analytics notion of an exit screen. Actions/
 * errors that happen ON that final screen don't change which screen it
 * was; they're already counted separately in that screen's own totals.
 */
function aggregateRows(rawRows) {
  const bySick = {}
  const ensure = (key) => bySick[key] || (bySick[key] = {
    screen_key: key, views: 0, durSum: 0, durCount: 0, errors: 0, exits: 0,
  })

  for (const r of rawRows) {
    if (r.event_type === 'screen_view') {
      const b = ensure(r.screen_key)
      b.views += 1
      if (typeof r.duration_ms === 'number' && Number.isFinite(r.duration_ms)) {
        b.durSum += r.duration_ms
        b.durCount += 1
      }
    } else if (r.event_type === 'error') {
      ensure(r.screen_key).errors += 1
    }
  }

  const screenViewsBySession = new Map()
  for (const r of rawRows) {
    if (r.event_type !== 'screen_view' || !r.session_id) continue
    const list = screenViewsBySession.get(r.session_id) || []
    list.push(r)
    screenViewsBySession.set(r.session_id, list)
  }
  for (const list of screenViewsBySession.values()) {
    let last = null
    for (const r of list) {
      if (!last || (r.created_at || '') > (last.created_at || '')) last = r
    }
    if (last) ensure(last.screen_key).exits += 1
  }

  return Object.values(bySick)
    .map(b => ({
      screen_key:     b.screen_key,
      views:          b.views,
      avgDurationMs:  b.durCount > 0 ? Math.round(b.durSum / b.durCount) : null,
      errors:         b.errors,
      exits:          b.exits,
    }))
    .sort((a, b) => b.views - a.views)
}

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

    let query = supabase
      .from('client_activity_log')
      .select('session_id, screen_key, event_type, duration_ms, created_at, project_id')
      .gte('created_at', `${fromDate}T00:00:00`)
      .lt('created_at', nextDayIso(toDate))
    if (viewMode === 'project') query = query.eq('project_id', selectedProject.id)

    const { data, error } = await query
    if (error) {
      console.error('ClientUsabilityReport fetch error:', error)
      setRows([])
      setLoading(false)
      return
    }
    setRows(aggregateRows(data || []))
    setLoading(false)
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
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.screen_key}>
                  <td>{screenLabel(row.screen_key)}</td>
                  <td>{row.views}</td>
                  <td>{formatDuration(row.avgDurationMs)}</td>
                  <td>{row.errors}</td>
                  <td>{row.exits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
