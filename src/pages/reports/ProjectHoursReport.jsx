import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { exportRowsToXlsx } from '../../lib/xlsxExport'
import '../ReportTable.css'

function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function formatHours(h) {
  const n = Math.round((h || 0) * 100) / 100
  const s = n % 1 === 0 ? String(n) : String(n).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return `${s} שעות`
}

/* Local-calendar (not UTC) YYYY-MM-DD — matches how the date <input>s
   themselves read/write values, so "today" lines up with the user's
   actual calendar day regardless of timezone offset. */
function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function firstOfMonthIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function ProjectHoursReport() {
  const [role, setRole] = useState(null)
  const [projects, setProjects] = useState([])

  const [projectQuery, setProjectQuery] = useState('')
  const [projectOpen, setProjectOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState(null)

  const [fromDate, setFromDate] = useState(() => firstOfMonthIso())
  const [toDate, setToDate] = useState(() => todayIso())

  const [rows, setRows] = useState([])
  const [totalHours, setTotalHours] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const navigate = useNavigate()

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

  /* Only filter while the user is actively typing a NEW search (no
     project selected yet). Once a project is selected, the input keeps
     showing its name, but reopening the dropdown (e.g. to pick a
     different project after results are shown) must show the FULL
     list again — otherwise it filters down to just the already-selected
     project's own name and looks stuck on it. */
  const filteredProjects = (!selectedProject && projectQuery.trim())
    ? projects.filter(p => p.name.toLowerCase().includes(projectQuery.trim().toLowerCase()))
    : projects

  const canSearch = !!selectedProject && !!fromDate && !!toDate

  const fetchReport = async () => {
    if (!canSearch) return
    setLoading(true)
    setSearched(true)

    const { data: hrRows } = await supabase
      .from('hour_reports')
      .select('date, hours, minutes, user_id')
      .eq('project_id', selectedProject.id)
      .gte('date', fromDate)
      .lte('date', toDate)

    const userIds = [...new Set((hrRows || []).map(r => r.user_id))]
    let namesById = {}
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles').select('id, first_name, last_name').in('id', userIds)
      namesById = Object.fromEntries(
        (profs || []).map(p => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || '-'])
      )
    }

    const map = new Map()
    let total = 0
    for (const r of (hrRows || [])) {
      const hrs = (r.hours || 0) + (r.minutes || 0) / 60
      total += hrs
      const key = `${r.date}||${r.user_id}`
      if (!map.has(key)) {
        map.set(key, {
          date: r.date,
          employeeName: namesById[r.user_id] || '-',
          hours: 0,
        })
      }
      map.get(key).hours += hrs
    }

    const built = Array.from(map.values()).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return a.employeeName.localeCompare(b.employeeName, 'he')
    })

    setRows(built)
    setTotalHours(total)
    setLoading(false)
  }

  if (role !== 'admin') return null

  return (
    <div className="report-table-page" dir="rtl">
      <div className="report-header-row">
        <h1 className="report-page-title">דוח שעות לפי פרויקט</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>← חזרה לדוחות</button>
      </div>

      <div className="report-controls" style={{ flexWrap: 'wrap' }}>
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

      {!searched && (
        <p className="report-empty">בחרי פרויקט וטווח תאריכים להצגת הדוח</p>
      )}

      {searched && loading && <p className="report-loading">טוען...</p>}

      {searched && !loading && rows.length === 0 && (
        <p className="report-empty">לא נמצאו שעות עבודה בטווח התאריכים שנבחר</p>
      )}

      {searched && !loading && rows.length > 0 && (
        <div className="report-card" style={{ overflow: 'hidden', width: '100%' }}>
          <div className="hours-report-export-row">
            <button
              type="button"
              className="hours-report-fetch-btn"
              onClick={() => {
                const header = ['תאריך', 'עובד', 'שעות']
                const dataRows = rows.map(row => [formatDate(row.date), row.employeeName, formatHours(row.hours)])
                const totalRow = ['סה״כ', '', formatHours(totalHours)]
                exportRowsToXlsx(
                  `דוח-שעות-${selectedProject ? selectedProject.name : 'פרויקט'}`,
                  'דוח שעות',
                  [header, ...dataRows, totalRow]
                )
              }}
            >
              ייצוא לאקסל
            </button>
          </div>
          <table className="report-stage-table">
            <thead>
              <tr>
                <th>תאריך</th>
                <th>עובד</th>
                <th>שעות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>{formatDate(row.date)}</td>
                  <td>{row.employeeName}</td>
                  <td>{formatHours(row.hours)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="report-totals-row">
                <td colSpan={2}>סה״כ</td>
                <td>{formatHours(totalHours)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
