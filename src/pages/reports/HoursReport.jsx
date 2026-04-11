import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
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

function isoDate(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export default function HoursReport() {
  const [role, setRole]             = useState(null)
  const [reportMonth, setReportMonth] = useState(new Date().getMonth())
  const [reportYear, setReportYear]   = useState(new Date().getFullYear())
  const [reportData, setReportData]   = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [allUsers, setAllUsers]       = useState([])
  const [filterUserId, setFilterUserId] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')
      const { data: users } = await supabase
        .from('profiles').select('id, first_name, last_name')
        .in('role', ['admin', 'employee']).order('first_name')
      if (users) setAllUsers(users)
    }
    init()
  }, [])

  const fetchReportData = async () => {
    setReportLoading(true)
    const first   = `${reportYear}-${String(reportMonth + 1).padStart(2, '0')}-01`
    const lastDay = new Date(reportYear, reportMonth + 1, 0).getDate()
    const last    = isoDate(reportYear, reportMonth, lastDay)

    const [{ data: employees }, { data: attData }, { data: repData }] = await Promise.all([
      supabase.from('profiles').select('id, first_name, last_name, role')
        .eq('role', 'employee').order('first_name'),
      supabase.from('attendance').select('user_id, day_type, work_from_home')
        .gte('date', first).lte('date', last),
      supabase.from('hour_reports').select('user_id, hours, minutes')
        .gte('date', first).lte('date', last),
    ])
    if (!employees) { setReportLoading(false); return }

    const rows = employees.map(emp => {
      const empAtt = attData ? attData.filter(a => a.user_id === emp.id) : []
      const empRep = repData ? repData.filter(r => r.user_id === emp.id) : []
      return {
        id:           emp.id,
        name:         `${emp.first_name || ''} ${emp.last_name || ''}`.trim() || '-',
        totalMins:    empRep.reduce((s, r) => s + (r.hours || 0) * 60 + (r.minutes || 0), 0),
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
        {allUsers.length > 0 && (
          <select
            className="report-project-select"
            value={filterUserId}
            onChange={e => setFilterUserId(e.target.value)}
            style={{ width: 160 }}
          >
            <option value="">כל העובדים</option>
            {allUsers.map(u => (
              <option key={u.id} value={u.id}>
                {[u.first_name, u.last_name].filter(Boolean).join(' ')}
              </option>
            ))}
          </select>
        )}
        <button className="hours-report-fetch-btn" onClick={fetchReportData}>הצג</button>
      </div>

      {reportLoading && <p className="report-loading">טוען...</p>}

      {!reportLoading && reportData.length > 0 && (
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
              </tr>
            </thead>
            <tbody>
              {reportData
                .filter(row => !filterUserId || row.id === filterUserId)
                .map(row => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{toHHMM(row.totalMins)}</td>
                    <td>{row.officeDays}</td>
                    <td>{row.wfhDays}</td>
                    <td>{row.vacationDays}</td>
                    <td>{row.sickDays}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="hours-report-export-row">
            <button className="hours-report-export-btn" title="ייצוא ל-PDF" onClick={() => window.print()}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      {!reportLoading && reportData.length === 0 && (
        <p className="report-empty">בחר חודש ולחץ הצג</p>
      )}
    </div>
  )
}
