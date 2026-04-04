import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import '../ReportTable.css'

function toHHMM(mins) {
  if (!mins || mins <= 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

const FIXED_STAGES = ['סקיצות', 'הדמיה', 'גרמושקה', 'רישוי', 'תכניות עבודה', 'בניה', 'גמר']

function daysFromDate(dateStr) {
  if (!dateStr) return 0
  const entered = new Date(dateStr)
  const today = new Date()
  entered.setHours(0,0,0,0); today.setHours(0,0,0,0)
  return Math.max(0, Math.round((today - entered) / 86400000))
}

export default function ProjectStagesReport() {
  const [role, setRole]             = useState(null)
  const [projects, setProjects]     = useState([])
  const [employees, setEmployees]   = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [rows, setRows]             = useState([])
  const [chartData, setChartData]   = useState([])
  const [loading, setLoading]       = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')

      const [{ data: projs }, { data: emps }] = await Promise.all([
        supabase.from('projects').select('id, name').eq('archived', false).order('name'),
        supabase.from('profiles').select('id, first_name, last_name').eq('role', 'employee').order('first_name'),
      ])
      if (projs) setProjects(projs)
      if (emps)  setEmployees(emps)
    }
    init()
  }, [])

  useEffect(() => {
    if (!selectedId) { setRows([]); setChartData([]); return }

    const fetchReport = async () => {
      setLoading(true)

      const [
        { data: history },
        { data: project },
        { data: hourReports },
        { data: allHistory },
        { data: allProjects },
      ] = await Promise.all([
        supabase.from('project_stage_history').select('stage, days_in_stage, entered_at').eq('project_id', selectedId),
        supabase.from('projects').select('current_stage, stage_entered_at').eq('id', selectedId).single(),
        supabase.from('hour_reports').select('stage, user_id, hours, minutes').eq('project_id', selectedId),
        // All history across all projects for computing averages
        supabase.from('project_stage_history').select('stage, days_in_stage'),
        // All active projects for current-stage averages
        supabase.from('projects').select('current_stage, stage_entered_at').eq('archived', false),
      ])

      // ── Build table rows ──────────────────────────────────────────────────
      const stageMap = {}
      ;(history || []).forEach(h => {
        if (!stageMap[h.stage]) stageMap[h.stage] = { stage: h.stage, days: h.days_in_stage, isCurrent: false }
      })
      if (project?.current_stage) {
        stageMap[project.current_stage] = {
          stage:     project.current_stage,
          days:      daysFromDate(project.stage_entered_at),
          isCurrent: true,
        }
      }

      const minsByStageUser = {}
      ;(hourReports || []).forEach(r => {
        const key = `${r.stage}||${r.user_id}`
        if (!minsByStageUser[key]) minsByStageUser[key] = 0
        minsByStageUser[key] += (r.hours || 0) * 60 + (r.minutes || 0)
      })

      // Build rows in fixed stage order, filling zeros for missing stages
      const built = FIXED_STAGES.map(stage => {
        const info      = stageMap[stage]
        const days      = info?.days ?? 0
        const isCurrent = info?.isCurrent ?? false
        const empMins   = employees.map(emp => minsByStageUser[`${stage}||${emp.id}`] || 0)
        const totalMins = empMins.reduce((a, b) => a + b, 0)
        return { stage, days, isCurrent, empMins, totalMins }
      })
      setRows(built)

      // ── Build avg days per stage across ALL projects ───────────────────────
      const stageSums = {}   // stage → { sum, count }
      ;(allHistory || []).forEach(h => {
        if (!stageSums[h.stage]) stageSums[h.stage] = { sum: 0, count: 0 }
        stageSums[h.stage].sum   += h.days_in_stage || 0
        stageSums[h.stage].count += 1
      })
      ;(allProjects || []).forEach(p => {
        if (!p.current_stage) return
        const days = daysFromDate(p.stage_entered_at)
        if (!stageSums[p.current_stage]) stageSums[p.current_stage] = { sum: 0, count: 0 }
        stageSums[p.current_stage].sum   += days
        stageSums[p.current_stage].count += 1
      })

      // Chart data in fixed stage order, reversed for RTL feel
      const chart = FIXED_STAGES.map(stage => ({
        stage,
        project: stageMap[stage]?.days ?? 0,
        avg:     stageSums[stage]
          ? Math.round(stageSums[stage].sum / stageSums[stage].count)
          : 0,
      }))
      setChartData(chart.slice().reverse())

      setLoading(false)
    }

    fetchReport()
  }, [selectedId, employees])

  if (role !== 'admin') return null

  const totalDays      = rows.reduce((a, r) => a + (r.days || 0), 0)
  const totalEmpMins   = employees.map((_, i) => rows.reduce((a, r) => a + r.empMins[i], 0))
  const grandTotalMins = totalEmpMins.reduce((a, b) => a + b, 0)

  return (
    <div className="report-table-page" dir="rtl">
      <div className="report-header-row">
        <h1 className="report-page-title">דוח שלבי פרויקט</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>← חזרה לדוחות</button>
      </div>

      <div className="report-controls">
        <label className="report-select-label">בחר פרויקט:</label>
        <select
          className="report-project-select"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          <option value="">בחרי פרויקט...</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {!selectedId && (
        <p className="report-empty">בחרי פרויקט להצגת הדוח</p>
      )}

      {selectedId && loading && <p className="report-loading">טוען...</p>}

      {selectedId && !loading && rows.length > 0 && (
        <div className="report-content-row">
          {/* Chart — LEFT side */}
          <div className="report-chart-wrap report-card">
            <div className="report-chart-title">ימים בכל שלב</div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="stage"
                  tick={{ fontSize: 11, fill: '#555', dy: 10 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11, fill: '#555' }} allowDecimals={false} width={45} />
                <Tooltip formatter={(val, name) => [val + ' ימים', name]} />
                <Legend
                  verticalAlign="top"
                  formatter={val => ' ' + (val === 'project' ? 'פרויקט נבחר' : 'ממוצע כלל הפרויקטים')}
                />
                <Bar dataKey="project" name="project" fill="#4F86C6" radius={[4,4,0,0]} maxBarSize={32} />
                <Bar dataKey="avg"     name="avg"     fill="#A8D5A2" radius={[4,4,0,0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Table — RIGHT side */}
          <div className="report-table-wrap report-card">
            <table className="report-stage-table">
              <thead>
                <tr>
                  <th>שלב</th>
                  <th>ימים בשלב</th>
                  {employees.map(emp => (
                    <th key={emp.id}>{emp.first_name}</th>
                  ))}
                  <th>סה״כ שעות</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.stage} className={row.isCurrent ? 'report-row-current' : ''}>
                    <td>{row.stage}</td>
                    <td>{row.days}</td>
                    {row.empMins.map((mins, i) => <td key={i}>{toHHMM(mins)}</td>)}
                    <td>{toHHMM(row.totalMins)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="report-totals-row">
                  <td>סה״כ</td>
                  <td>{totalDays}</td>
                  {totalEmpMins.map((mins, i) => <td key={i}>{toHHMM(mins)}</td>)}
                  <td>{toHHMM(grandTotalMins)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {selectedId && !loading && rows.length === 0 && (
        <p className="report-empty">אין נתונים לפרויקט זה</p>
      )}
    </div>
  )
}
