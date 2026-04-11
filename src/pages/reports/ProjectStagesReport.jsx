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
  const [stagesData, setStagesData] = useState([])
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

      const [{ data: projs }, { data: emps }, { data: stg }] = await Promise.all([
        supabase.from('projects').select('id, name').eq('archived', false).order('name'),
        supabase.from('profiles').select('id, first_name, last_name').eq('role', 'employee').order('first_name'),
        supabase.from('stages').select('id, name, color').order('order_index'),
      ])
      if (projs) setProjects(projs)
      if (emps)  setEmployees(emps)
      if (stg)   setStagesData(stg)
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
        supabase.from('project_stage_history').select('stage, days_in_stage, entered_at, stages!stage_id(id, name, color)').eq('project_id', selectedId),
        supabase.from('projects').select('current_stage, stage_entered_at').eq('id', selectedId).single(),
        supabase.from('hour_reports').select('stage, stage_id, user_id, hours, minutes, stages!stage_id(id, name)').eq('project_id', selectedId),
        // All history across all projects for computing averages
        supabase.from('project_stage_history').select('stage, days_in_stage, stages!stage_id(id, name)'),
        // All active projects for current-stage averages
        supabase.from('projects').select('current_stage, stage_entered_at').eq('archived', false),
      ])

      // ── Build table rows keyed by stage_id ───────────────────────────────
      const stageMap = {}   // stageId → { days, isCurrent }
      ;(history || []).forEach(h => {
        const sid = h.stages?.id
        if (!sid) return
        if (!stageMap[sid]) stageMap[sid] = { days: h.days_in_stage, isCurrent: false }
      })
      if (project?.current_stage) {
        const currentS = stagesData.find(s => s.name === project.current_stage)
        if (currentS) {
          stageMap[currentS.id] = {
            ...(stageMap[currentS.id] || {}),
            days:      daysFromDate(project.stage_entered_at),
            isCurrent: true,
          }
        }
      }

      const minsByStageUser = {}   // `${stageId}||${userId}` → mins
      ;(hourReports || []).forEach(r => {
        const sid = r.stage_id
        if (!sid) return
        const key = `${sid}||${r.user_id}`
        if (!minsByStageUser[key]) minsByStageUser[key] = 0
        minsByStageUser[key] += (r.hours || 0) * 60 + (r.minutes || 0)
      })

      // Build rows by iterating stagesData (ordered by order_index)
      const built = stagesData.map(s => {
        const info      = stageMap[s.id] || {}
        const days      = info.days ?? 0
        const isCurrent = info.isCurrent ?? false
        const empMins   = employees.map(emp => minsByStageUser[`${s.id}||${emp.id}`] || 0)
        const totalMins = empMins.reduce((a, b) => a + b, 0)
        return { stageId: s.id, stage: s.name, color: s.color || null, days, isCurrent, empMins, totalMins }
      })
      setRows(built)

      // ── Build avg days per stage across ALL projects ───────────────────────
      const stageSums = {}   // stageId → { sum, count }
      ;(allHistory || []).forEach(h => {
        const sid = h.stages?.id
        if (!sid) return
        if (!stageSums[sid]) stageSums[sid] = { sum: 0, count: 0 }
        stageSums[sid].sum   += h.days_in_stage || 0
        stageSums[sid].count += 1
      })
      ;(allProjects || []).forEach(p => {
        if (!p.current_stage) return
        const s = stagesData.find(s => s.name === p.current_stage)
        if (!s) return
        const days = daysFromDate(p.stage_entered_at)
        if (!stageSums[s.id]) stageSums[s.id] = { sum: 0, count: 0 }
        stageSums[s.id].sum   += days
        stageSums[s.id].count += 1
      })

      // Chart data ordered by stagesData, reversed for RTL feel
      const chart = stagesData.map(s => ({
        stage:   s.name,
        project: stageMap[s.id]?.days ?? 0,
        avg:     stageSums[s.id]
          ? Math.round(stageSums[s.id].sum / stageSums[s.id].count)
          : 0,
      }))
      setChartData(chart.slice().reverse())

      setLoading(false)
    }

    fetchReport()
  }, [selectedId, employees, stagesData])

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
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {row.color && (
                          <span style={{ width: 10, height: 10, borderRadius: '50%', background: row.color, flexShrink: 0, display: 'inline-block' }} />
                        )}
                        {row.stage}
                      </span>
                    </td>
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
