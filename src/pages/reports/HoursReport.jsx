import { Fragment, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import EmployeesMultiSelect from '../../components/EmployeesMultiSelect'
/* Shared with Hours.jsx (the "דיווח שעות → דוחות" report) so the two
   drill-downs pull the same data and format each line identically. */
import {
  toMins,
  isoDate,
  fetchEmployeeDailyDetails,
  formatDrillLine,
} from '../../lib/hoursDetail'
import '../ReportTable.css'

const MONTH_NAMES = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר',
]

function toHHMM(mins) {
  if (!mins || mins <= 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

export default function HoursReport() {
  const [role, setRole]             = useState(null)
  const [reportMonth, setReportMonth] = useState(new Date().getMonth())
  const [reportYear, setReportYear]   = useState(new Date().getFullYear())
  const [reportData, setReportData]   = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [allUsers, setAllUsers]       = useState([])
  /* Multi-select state — Set of selected employee IDs. Initialized to all on load. */
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(() => new Set())
  /* Per-employee "+" drill-down state, keyed by user id. Mirrors the
     shape used by Hours.jsx so both reports behave the same:
       drillExpanded — Set of expanded employee ids (screen only)
       drillCache    — { [uid]: [day rows] } cache from fetchEmployeeDailyDetails
       drillLoading  — Set of ids currently fetching
     Cache is cleared on month/year change (see useEffect below) so a
     re-expand fetches fresh data. */
  const [drillExpanded, setDrillExpanded] = useState(() => new Set())
  const [drillCache,    setDrillCache]    = useState({})
  const [drillLoading,  setDrillLoading]  = useState(() => new Set())
  /* Print-request flag — flipped true by the export button after the
     drill cache is prewarmed for every visible employee. The effect
     below waits for React to commit + the browser to paint before
     window.print() so the print-only rows are captured. */
  const [printPending, setPrintPending] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')
      const { data: users } = await supabase
        .from('profiles').select('id, first_name, last_name, role')
        .in('role', ['admin', 'employee']).order('first_name')
      if (users) {
        setAllUsers(users)
        /* Default: ALL employees selected. */
        const empIds = users.filter(u => u.role === 'employee').map(u => u.id)
        setSelectedEmployeeIds(new Set(empIds))
      }
    }
    init()
  }, [])

  /* Toggle "+"/"−" on an employee row. Same lazy-load-then-cache
     pattern as Hours.jsx: expand fires a fetch (once per user per
     month) and stashes the rows in drillCache; collapse just hides. */
  const toggleDrill = async (uId) => {
    if (drillExpanded.has(uId)) {
      setDrillExpanded(prev => { const n = new Set(prev); n.delete(uId); return n })
      return
    }
    setDrillExpanded(prev => new Set(prev).add(uId))
    if (!drillCache[uId]) {
      setDrillLoading(prev => new Set(prev).add(uId))
      const days = await fetchEmployeeDailyDetails(uId, reportYear, reportMonth)
      setDrillCache(prev => ({ ...prev, [uId]: days }))
      setDrillLoading(prev => { const n = new Set(prev); n.delete(uId); return n })
    }
  }

  const renderDrillBody = (uId) => {
    if (drillLoading.has(uId)) return <div className="hours-drill-loading">טוען...</div>
    const days = drillCache[uId]
    if (!days || days.length === 0) return <div className="hours-drill-empty">אין ימים פעילים</div>
    return days.map(day => (
      <div key={day.date} className="hours-drill-line">{formatDrillLine(day)}</div>
    ))
  }

  /* Reset drill state whenever the report month/year changes so the
     next expand fetches fresh data instead of showing a stale month. */
  useEffect(() => {
    setDrillExpanded(new Set())
    setDrillCache({})
  }, [reportMonth, reportYear])

  /* Deferred print — mirrors Hours.jsx. When printPending flips true,
     double-rAF gives React time to commit the prewarmed cache into the
     DOM and the browser time to paint before window.print() snapshots
     the page. The print-only .hours-drill-print-row below reads from
     drillCache, so pre-warming = detail-in-PDF. */
  useEffect(() => {
    if (!printPending) return
    let raf1 = 0, raf2 = 0
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.print()
        setPrintPending(false)
      })
    })
    return () => {
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [printPending])

  const fetchReportData = async () => {
    setReportLoading(true)
    const first   = `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`
    const lastDay = new Date(reportYear, reportMonth + 1, 0).getDate()
    const last    = isoDate(reportYear, reportMonth, lastDay)

    const [{ data: employees }, { data: attData }, { data: repData }] = await Promise.all([
      supabase.from('profiles').select('id, first_name, last_name, role')
        .eq('role', 'employee').order('first_name'),
      supabase.from('attendance').select('user_id, day_type, work_from_home, arrival_time, departure_time')
        .gte('date', first).lte('date', last),
      supabase.from('hour_reports').select('user_id, hours, minutes')
        .gte('date', first).lte('date', last),
    ])
    if (!employees) { setReportLoading(false); return }

    const rows = employees.map(emp => {
      const empAtt = attData ? attData.filter(a => a.user_id === emp.id) : []
      const empRep = repData ? repData.filter(r => r.user_id === emp.id) : []
      const empAttMins = empAtt
        .filter(a => a.day_type === 'work' && a.arrival_time && a.departure_time)
        .reduce((s, a) =>
          s + toMins(a.departure_time.slice(0, 5)) - toMins(a.arrival_time.slice(0, 5)), 0)
      const empRepMins = empRep.reduce((s, r) => s + (r.hours || 0) * 60 + (r.minutes || 0), 0)
      return {
        id:           emp.id,
        name:         `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || '-',
        totalMins:    empAttMins > 0 ? empAttMins : empRepMins,
        officeDays:   empAtt.filter(a => a.day_type === 'work' && !a.work_from_home).length,
        wfhDays:      empAtt.filter(a => a.day_type === 'work' &&  a.work_from_home).length,
        vacationDays: empAtt.filter(a => a.day_type === 'vacation').length,
        sickDays:     empAtt.filter(a => a.day_type === 'sick').length,
      }
    })
    setReportData(rows)
    setReportLoading(false)
  }

  if (role !== 'admin') return null

  return (
    <div className="report-table-page" dir="rtl">
      <div className="report-header-row">
        <h1 className="report-page-title">דוח שעות עבודה</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>← חזרה לדוחות</button>
      </div>

      <div className="report-controls">
        <select
          className="report-project-select"
          value={reportMonth}
          onChange={e => setReportMonth(Number(e.target.value))}
          style={{ width: 160 }}
        >
          {MONTH_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
        </select>
        <select
          className="report-project-select"
          value={reportYear}
          onChange={e => setReportYear(Number(e.target.value))}
          style={{ width: 100 }}
        >
          {[2023, 2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {allUsers.filter(u => u.role === 'employee').length > 0 && (
          <EmployeesMultiSelect
            employees={allUsers.filter(u => u.role === 'employee')}
            selectedIds={selectedEmployeeIds}
            onChange={setSelectedEmployeeIds}
          />
        )}
        <button className="hours-report-fetch-btn" onClick={fetchReportData}>הצג</button>
      </div>

      {reportLoading && <p className="report-loading">טוען...</p>}

      {!reportLoading && reportData.length > 0 && reportData.filter(r => selectedEmployeeIds.has(r.id)).length === 0 && (
        <p className="report-empty">בחרי לפחות עובד אחד</p>
      )}

      {!reportLoading && reportData.length > 0 && reportData.filter(r => selectedEmployeeIds.has(r.id)).length > 0 && (() => {
        const filteredRows = reportData.filter(r => selectedEmployeeIds.has(r.id))
        /* PDF-export handler. Pre-fetches per-day details for EVERY
           visible employee (not just the ones the user happens to have
           expanded on screen), then flips printPending so the deferred
           effect above runs window.print() once the DOM is committed.
           The on-screen expand/collapse state is not consulted here —
           the print-only .hours-drill-print-row reads directly from
           drillCache. */
        const exportReport = async () => {
          const missing = filteredRows.filter(r => !drillCache[r.id])
          if (missing.length > 0) {
            const additions = {}
            for (const r of missing) {
              additions[r.id] = await fetchEmployeeDailyDetails(r.id, reportYear, reportMonth)
            }
            setDrillCache(prev => ({ ...prev, ...additions }))
          }
          setPrintPending(true)
        }
        return (
        <div className="report-card" style={{ overflow: 'hidden', width: '100%' }}>
          <div className="report-print-header-standalone">
            סטודיו בתים — דיווח שעות עובדים | {MONTH_NAMES[reportMonth]} {reportYear}
          </div>
          <table className="report-stage-table">
            <thead>
              <tr>
                <th>שם עובד</th>
                <th>סה״כ שעות</th>
                <th>ימי עבודה במשרד</th>
                <th>ימי עבודה מהבית</th>
                <th>ימי חופשה</th>
                <th>ימי מחלה</th>
                <th className="hours-drill-toggle-header" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => (
                <Fragment key={row.id}>
                  <tr>
                    <td>{row.name}</td>
                    <td>{toHHMM(row.totalMins)}</td>
                    <td>{row.officeDays}</td>
                    <td>{row.wfhDays}</td>
                    <td>{row.vacationDays}</td>
                    <td>{row.sickDays}</td>
                    <td className="hours-drill-toggle-cell">
                      <button
                        type="button"
                        className="hours-drill-toggle"
                        onClick={() => toggleDrill(row.id)}
                        title={drillExpanded.has(row.id) ? 'סגור' : 'הצג ימים פעילים'}
                      >
                        {drillExpanded.has(row.id) ? '−' : '+'}
                      </button>
                    </td>
                  </tr>
                  {drillExpanded.has(row.id) && (
                    <tr className="hours-drill-row">
                      <td colSpan={7}>
                        <div className="hours-drill-list">{renderDrillBody(row.id)}</div>
                      </td>
                    </tr>
                  )}
                  {/* Print-only per-day detail — ALWAYS rendered, but
                      display:none on screen. Becomes visible only inside
                      @media print. Reads directly from drillCache; the
                      export handler above pre-warms the cache for every
                      filtered row so this block has content regardless
                      of the on-screen expand state. */}
                  <tr className="hours-drill-print-row" aria-hidden="true">
                    <td colSpan={7}>
                      <div className="hours-drill-print-list">
                        {(drillCache[row.id] || []).map(day => (
                          <div key={day.date} className="hours-drill-print-line">
                            {formatDrillLine(day)}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          <div className="hours-report-export-row">
            <button className="hours-report-export-btn" title="ייצוא ל-PDF" onClick={exportReport}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
          </div>
        </div>
        )
      })()}

      {!reportLoading && reportData.length === 0 && (
        <p className="report-empty">בחר חודש ולחץ הצג</p>
      )}
    </div>
  )
}
