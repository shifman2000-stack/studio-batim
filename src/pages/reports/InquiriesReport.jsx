import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import '../ReportTable.css'
import './InquiriesReport.css'

const MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]

const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_MONTH = new Date().getMonth() + 1 // 1–12
const YEARS = [2025, 2026]

function buildChartData(rows, year) {
  const maxMonth = year === CURRENT_YEAR ? CURRENT_MONTH : 12
  const buckets = Array.from({ length: maxMonth }, (_, i) => ({
    month: MONTHS[i],
    converted: 0,
    notConverted: 0,
  }))
  rows.forEach(row => {
    if (!row.date) return
    const m = new Date(row.date).getMonth() // 0-based
    if (m >= maxMonth) return
    if (row.converted_to_project) buckets[m].converted++
    else buckets[m].notConverted++
  })
  return buckets
}

export default function InquiriesReport() {
  const navigate = useNavigate()
  const [role, setRole]       = useState(null)
  const [year, setYear]       = useState(CURRENT_YEAR)
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(false)

  /* ── Admin guard ── */
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')
    }
    init()
  }, [])

  /* ── Fetch on year change ── */
  useEffect(() => {
    if (role !== 'admin') return
    const fetch = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('inquiries')
        .select('date, converted_to_project')
        .gte('date', `${year}-01-01`)
        .lt('date',  `${year + 1}-01-01`)
      setRows(data ?? [])
      setLoading(false)
    }
    fetch()
  }, [role, year])

  if (role !== 'admin') return null

  /* ── Derived stats ── */
  const total     = rows.length
  const converted = rows.filter(r => r.converted_to_project).length
  const convPct   = total > 0 ? Math.round((converted / total) * 100) : 0
  const maxMonth  = year === CURRENT_YEAR ? CURRENT_MONTH : 12
  const avgPerMonth = total > 0 ? (total / maxMonth).toFixed(1) : '0'

  const chartData = buildChartData(rows, year)

  return (
    <div className="report-table-page" dir="rtl">

      {/* ── Header ── */}
      <div className="report-header-row">
        <h1 className="report-page-title">דוח פניות</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>
          ← חזרה לדוחות
        </button>
      </div>

      {/* ── Year selector ── */}
      <div className="inqr-year-selector">
        <span className="inqr-year-label">שנה:</span>
        {YEARS.map(y => (
          <button
            key={y}
            className={'inqr-year-btn' + (year === y ? ' inqr-year-btn--active' : '')}
            onClick={() => setYear(y)}
          >
            {y}
          </button>
        ))}
      </div>

      {loading && <p className="inqr-loading">טוען...</p>}

      {!loading && (
        <>
          {/* ── Summary cards ── */}
          <div className="inqr-summary-row">
            <div className="inqr-summary-card">
              <span className="inqr-summary-label">סה״כ פניות</span>
              <span className="inqr-summary-value">{total}</span>
            </div>
            <div className="inqr-summary-card">
              <span className="inqr-summary-label">הפכו לפרויקט</span>
              <span className="inqr-summary-value inqr-summary-value--accent">{converted}</span>
            </div>
            <div className="inqr-summary-card">
              <span className="inqr-summary-label">אחוז המרה</span>
              <span className="inqr-summary-value">{convPct}%</span>
            </div>
            <div className="inqr-summary-card">
              <span className="inqr-summary-label">ממוצע לחודש</span>
              <span className="inqr-summary-value">{avgPerMonth}</span>
            </div>
          </div>

          {/* ── Bar chart ── */}
          {total === 0 ? (
            <p className="inqr-empty">אין פניות לשנה {year}</p>
          ) : (
            <div className="inqr-chart-card">
              <div className="inqr-chart-title">פניות לפי חודש</div>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 24, left: 0, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 12, fill: '#555' }}
                    interval={0}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#555' }}
                    allowDecimals={false}
                    width={36}
                  />
                  <Tooltip
                    formatter={(val, name) => [
                      val,
                      name === 'notConverted' ? 'פניות שלא הפכו לפרויקט' : 'פניות שהפכו לפרויקט',
                    ]}
                  />
                  <Legend
                    verticalAlign="bottom"
                    formatter={name =>
                      name === 'notConverted'
                        ? 'פניות שלא הפכו לפרויקט'
                        : 'פניות שהפכו לפרויקט'
                    }
                  />
                  <Bar
                    dataKey="notConverted"
                    name="notConverted"
                    stackId="a"
                    fill="#4F86C6"
                    radius={[0, 0, 0, 0]}
                    maxBarSize={48}
                  />
                  <Bar
                    dataKey="converted"
                    name="converted"
                    stackId="a"
                    fill="#1D9E75"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
