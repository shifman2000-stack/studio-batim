import { Fragment, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from './supabaseClient'
import GoogleCalendarPanel from './components/hours/GoogleCalendarPanel'
import EmployeesMultiSelect from './components/EmployeesMultiSelect'
import {
  toMins,
  isoDate,
  formatDDMMYY,
  formatTotalHHMM,
  fetchEmployeeDailyDetails,
  formatDrillLine,
} from './lib/hoursDetail'
import './Hours.css'

// NOTE: Ensure the following columns exist in your Supabase tables:
//   pending_approvals: work_from_home (boolean, default false)
//   attendance:        work_from_home (boolean, default false)
//   hour_reports:      date, hours, minutes (NOT work_date / hours_worked)

// 00:15 → 12:00 in 15-min steps
const HOUR_OPTIONS = []
for (let h = 0; h <= 12; h++)
  for (let m = 0; m < 60; m += 15) {
    if (h === 0 && m === 0) continue
    if (h === 12 && m > 0) break
    HOUR_OPTIONS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

const formatTimeInput = (val) => {
  const digits = val.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

const validateTime = (val) => {
  if (!val) return ''
  if (!/^\d{2}:\d{2}$/.test(val)) return 'פורמט שגוי — נדרש HH:MM'
  const [h, m] = val.split(':').map(Number)
  if (h > 23 || m > 59) return 'שעה לא תקינה'
  return ''
}

const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
]
const DAY_NAMES = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']
const DAY_TYPE_LABELS = { work: 'עבודה', vacation: 'חופש', sick: 'מחלה' }

/* toMins / isoDate / formatDDMMYY / formatTotalHHMM live in
   src/lib/hoursDetail.js — imported above so this component and the
   standalone "דוח שעות עבודה" page share one source of truth for the
   drill-down math and formatting. */

const toHHMM = (mins) => {
  if (!mins && mins !== 0) return ''
  const h = Math.floor(Math.abs(mins) / 60)
  const m = Math.abs(mins) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const todayISO = () => {
  const n = new Date()
  return isoDate(n.getFullYear(), n.getMonth(), n.getDate())
}

const formatTitle = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('he-IL', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

const formatDate = (dateStr) => {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('he-IL', {
    day: 'numeric', month: 'numeric', year: 'numeric',
  })
}

// ── Virtual "general" option for project / stage dropdowns ──
// Selecting this saves NULL to hour_reports.project_id / stage_id.
const GENERAL_VALUE = '__general__'
const GENERAL_LABEL = 'כללי'

function Hours() {
  const location = useLocation()
  const [userId, setUserId]             = useState(null)
  const [loggedInUserId, setLoggedInUserId] = useState(null)
  const [userEmail, setUserEmail]       = useState(null)
  const [userRole, setUserRole]         = useState(null)
  const [projects, setProjects]         = useState([])
  const [stages, setStages]             = useState([])
  const [allUsers, setAllUsers]         = useState([])
  const [viewUserId, setViewUserId]     = useState(null)

  const [viewYear, setViewYear]   = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const [calData, setCalData]     = useState({})

  // Form state
  const [selectedDate, setSelectedDate] = useState(todayISO())
  const [arrival, setArrival]           = useState('')
  const [departure, setDeparture]       = useState('')
  const [dayType, setDayType]           = useState('work')
  const [workFromHome, setWorkFromHome] = useState(false)
  const [records, setRecords]           = useState([])
  const [attendanceId, setAttendanceId] = useState(null)
  const [pendingId, setPendingId]       = useState(null)
  const [dayStatus, setDayStatus]       = useState(null) // null | 'pending' | 'approved' | 'rejected'
  const [manualEntry, setManualEntry]   = useState(false) // הזנה ידנית checkbox
  const [origArrival, setOrigArrival]   = useState('')   // snapshot for change detection
  const [origDeparture, setOrigDeparture] = useState('')
  const [saving, setSaving]             = useState(false)
  const [saved, setSaved]               = useState(false)
  const [arrivalError, setArrivalError]     = useState('')
  const [departureError, setDepartureError] = useState('')

  // Admin approvals list and monthly summary
  const [approvalsList, setApprovalsList] = useState([])
  const [monthlySummary, setMonthlySummary] = useState({
    sickDays: 0, vacationDays: 0, totalMins: 0,
    pendingMins: 0, rejectedMins: 0, officeDays: 0, wfhDays: 0,
  })
  /* Per-employee daily details for the calendar's viewed month (ADMIN view).
     Shape: [{ id, name, byDate: { 'YYYY-MM-DD': entry } }]
     Populated by fetchMonthlySummary's admin branch — reuses the same query
     (with `date` added to the SELECT). Rendered below the calendar as a
     per-day view keyed by the user's currently selected day. */
  const [dailyByEmployee, setDailyByEmployee] = useState([])

  /* ── Drill-down state ──
     Calendar drill-down (below the calendar — keyed by userId).
     Resets on viewYear/viewMonth change so re-expand fetches fresh data. */
  const [calendarDrillExpanded, setCalendarDrillExpanded] = useState(() => new Set())
  const [calendarDrillCache,    setCalendarDrillCache]    = useState({})
  const [calendarDrillLoading,  setCalendarDrillLoading]  = useState(() => new Set())

  /* Report-tab drill-down (employee & admin reports — keyed by userId).
     Resets on reportYear/reportMonth change or on fetchReportData. */
  const [reportDrillExpanded, setReportDrillExpanded] = useState(() => new Set())
  const [reportDrillCache,    setReportDrillCache]    = useState({})
  const [reportDrillLoading,  setReportDrillLoading]  = useState(() => new Set())
  /* Print-request flag — flipped true by the export button after the
     drill cache is prewarmed for every filtered employee. The effect
     below waits one commit so the print-only rows are guaranteed to be
     in the DOM before window.print() captures it. */
  const [printPending, setPrintPending] = useState(false)
  const [gcalDots, setGcalDots]           = useState({}) // { 'YYYY-MM-DD': ['#hex',...] }
  const [adminTab, setAdminTab]           = useState(1) // 1=פגישות 2=הזנת שעות 3=אישורים 4=דוחות
  const [employeeTab, setEmployeeTab]     = useState(1) // 1=הזנת שעות 2=דוחות
  const [reportYear, setReportYear]       = useState(new Date().getFullYear())
  const [reportMonth, setReportMonth]     = useState(new Date().getMonth())
  const [reportData, setReportData]       = useState([])
  const [reportLoading, setReportLoading] = useState(false)
  const [reportUserId, setReportUserId]   = useState('')  // legacy — kept for employee locked view back-compat
  /* Admin report multi-select: set of employee IDs currently visible.
     Initialized to ALL employees when allUsers loads (see useEffect below). */
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState(() => new Set())

  useEffect(() => { init() }, [])
  useEffect(() => {
    if (location.state?.openTab === 'entry') {
      setAdminTab(2)
      const dateStr = location.state?.date || todayISO()
      // Navigate calendar view to the correct month
      const d = new Date(dateStr + 'T00:00:00')
      setViewYear(d.getFullYear())
      setViewMonth(d.getMonth())
      // Select the day — waits for userId via selectDay's internal guard
      if (userId) {
        selectDay(dateStr)
      } else {
        // userId not ready yet; store for deferred selection
        setSelectedDate(dateStr)
      }
    }
  }, [location.state, userId])
  useEffect(() => {
    if (userId) { fetchCalendarData(); fetchMonthlySummary() }
  }, [userId, viewYear, viewMonth])
  useEffect(() => {
    if (userId && userRole === 'admin') fetchApprovals()
  }, [userId, userRole])

  // Listen for Header הגעתי / יצאתי events — pre-populate form and refresh calendar
  useEffect(() => {
    const handleAttendanceUpdate = async (e) => {
      const { type, time } = e.detail
      if (type === 'arrival') {
        setArrival(time)
        // Grab the new pendingId so subsequent saves update the same record
        if (loggedInUserId && selectedDate === todayISO()) {
          const { data } = await supabase
            .from('pending_approvals')
            .select('id')
            .eq('user_id', loggedInUserId)
            .eq('date', selectedDate)
            .maybeSingle()
          if (data) setPendingId(data.id)
        }
      } else if (type === 'departure') {
        setDeparture(time)
      }
      // Refresh calendar cells + monthly summary if today is in the viewed month
      const t = new Date()
      if (t.getFullYear() === viewYear && t.getMonth() === viewMonth && userId) {
        fetchCalendarData()
        fetchMonthlySummary()
      }
    }
    window.addEventListener('hours-attendance-updated', handleAttendanceUpdate)
    return () => window.removeEventListener('hours-attendance-updated', handleAttendanceUpdate)
  }, [selectedDate, userId, viewYear, viewMonth])

  // ── Init ──
  const init = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    setUserId(session.user.id)
    setLoggedInUserId(session.user.id)
    setViewUserId(session.user.id)
    setUserEmail(session.user.email || null)
    const { data: profile } = await supabase
      .from('profiles').select('role, first_name, last_name').eq('id', session.user.id).single()
    if (profile) setUserRole(profile.role)
    const [{ data: projs }, { data: stg }] = await Promise.all([
      supabase.from('projects').select('id, name').eq('archived', false).order('name'),
      supabase.from('stages').select('id, name').order('order_index'),
    ])
    if (projs) setProjects(projs)
    if (stg) setStages(stg.filter(s => s.id !== 9))
    if (profile?.role === 'admin') {
      const { data: users } = await supabase
        .from('profiles').select('id, first_name, last_name, role')
        .in('role', ['admin', 'employee']).order('first_name')
      if (users) setAllUsers(users)
    } else if (profile?.role === 'employee') {
      /* Populate allUsers with just the current user so the reports dropdown
         can show their name (locked / disabled for employees). */
      setAllUsers([{
        id:         session.user.id,
        first_name: profile.first_name,
        last_name:  profile.last_name,
      }])
    }
  }

  // ── Calendar data ──
  const fetchCalendarData = async () => {
    const first = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate()
    const last = isoDate(viewYear, viewMonth, lastDay)

    const [{ data: reports }, { data: attendance }, { data: pending }] = await Promise.all([
      supabase.from('hour_reports').select('date, hours, minutes')
        .eq('user_id', userId).gte('date', first).lte('date', last),
      supabase.from('attendance').select('date, day_type, arrival_time, departure_time, work_from_home')
        .eq('user_id', userId).gte('date', first).lte('date', last),
      supabase.from('pending_approvals').select('date, day_type, status, work_from_home')
        .eq('user_id', userId).gte('date', first).lte('date', last),
    ])

    const map = {}

    // hour_reports → totalMins per day
    if (reports) {
      for (const r of reports) {
        if (!map[r.date]) map[r.date] = { totalMins: 0 }
        map[r.date].totalMins = (map[r.date].totalMins || 0) + (r.hours || 0) * 60 + (r.minutes || 0)
      }
    }

    // pending_approvals — lower priority
    if (pending) {
      for (const p of pending) {
        if (!map[p.date]) map[p.date] = { totalMins: 0 }
        map[p.date].dayType      = p.day_type || 'work'
        map[p.date].calStatus    = p.status
        map[p.date].workFromHome = !!p.work_from_home
      }
    }

    // attendance — highest priority (approved records)
    if (attendance) {
      for (const a of attendance) {
        if (!map[a.date]) map[a.date] = { totalMins: 0 }
        if (a.day_type) map[a.date].dayType = a.day_type
        map[a.date].calStatus    = 'approved'
        map[a.date].workFromHome = !!a.work_from_home
        if (a.day_type === 'work' && a.arrival_time && a.departure_time) {
          map[a.date].attMins =
            toMins(a.departure_time.slice(0, 5)) - toMins(a.arrival_time.slice(0, 5))
        }
      }
    }

    // Admin work days: no attendance record is written, so derive approved status
    // directly from hour_reports — any day with logged hours is considered approved.
    if (userRole === 'admin') {
      for (const date of Object.keys(map)) {
        if (map[date].totalMins > 0 && !map[date].calStatus) {
          map[date].calStatus = 'approved'
          map[date].dayType   = map[date].dayType || 'work'
        }
      }
    }

    setCalData(map)
  }

  // ── Admin approvals list ──
  // Only show work day entries that have both arrival and departure (fully submitted)
  // Auto-mode drafts (from Header הגעתי only) are excluded by the departure filter
  const fetchApprovals = async () => {
    // Step 1: fetch all pending records
    const { data, error } = await supabase
      .from('pending_approvals')
      .select('id, date, day_type, arrival_time, departure_time, status, user_id, work_from_home, project_breakdown')
      .eq('status', 'pending')
      .eq('day_type', 'work')
      .not('arrival_time', 'is', null)
      .not('departure_time', 'is', null)
      .order('date', { ascending: true })
    console.log('pending approvals:', data, error)
    if (!data) return

    // Step 2: fetch profiles for each unique user_id
    const uniqueUserIds = [...new Set(data.map(r => r.user_id))]
    const { data: profilesData } = uniqueUserIds.length > 0
      ? await supabase.from('profiles').select('id, first_name, last_name').in('id', uniqueUserIds)
      : { data: [] }

    // Step 3: combine
    const profileMap = {}
    if (profilesData) profilesData.forEach(p => { profileMap[p.id] = p })
    setApprovalsList(data.map(rec => ({ ...rec, _profile: profileMap[rec.user_id] || null })))
  }

  // ── Monthly summary ──
  const fetchMonthlySummary = async () => {
    const first = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate()
    const last = isoDate(viewYear, viewMonth, lastDay)

    const [{ data: attData }, { data: repData }, { data: pendData }] = await Promise.all([
      supabase.from('attendance').select('day_type, work_from_home, arrival_time, departure_time')
        .eq('user_id', userId).gte('date', first).lte('date', last),
      supabase.from('hour_reports').select('hours, minutes')
        .eq('user_id', userId).gte('date', first).lte('date', last),
      supabase.from('pending_approvals').select('day_type, arrival_time, departure_time, status')
        .eq('user_id', userId).gte('date', first).lte('date', last),
    ])

    // Sick / vacation: only from attendance (they save directly as approved, no pending flow)
    const sickDays     = attData ? attData.filter(a => a.day_type === 'sick').length     : 0
    const vacationDays = attData ? attData.filter(a => a.day_type === 'vacation').length : 0

    // Approved hours — prefer attendance diff (actual time at work) over project sum.
    // Admins don't write attendance records, so fall back to hour_reports for their case.
    const attendanceMins = attData
      ? attData
          .filter(a => a.day_type === 'work' && a.arrival_time && a.departure_time)
          .reduce((s, a) =>
            s + toMins(a.departure_time.slice(0, 5)) - toMins(a.arrival_time.slice(0, 5)), 0)
      : 0
    const reportMins = repData
      ? repData.reduce((s, r) => s + (r.hours || 0) * 60 + (r.minutes || 0), 0)
      : 0
    // Use attendance diff if available, otherwise fall back to project sum (admin case)
    const totalMins = attendanceMins > 0 ? attendanceMins : reportMins

    // Pending / rejected hours — from pending_approvals
    let pendingMins = 0, rejectedMins = 0
    if (pendData) {
      for (const p of pendData) {
        if (p.day_type !== 'work' || !p.arrival_time || !p.departure_time) continue
        const mins = toMins(p.departure_time.slice(0, 5)) - toMins(p.arrival_time.slice(0, 5))
        if (p.status === 'pending')  pendingMins  += mins
        if (p.status === 'rejected') rejectedMins += mins
      }
    }

    // Office vs WFH — approved work days only
    const approvedWork = attData ? attData.filter(a => a.day_type === 'work') : []
    const officeDays   = approvedWork.filter(a => !a.work_from_home).length
    const wfhDays      = approvedWork.filter(a =>  a.work_from_home).length

    setMonthlySummary({ sickDays, vacationDays, totalMins, pendingMins, rejectedMins, officeDays, wfhDays })

    /* For admin: also build a per-employee daily breakdown for the same month.
       Renders below the calendar as a per-day view (one row per selected
       employee for the user's selected day). Uses the SAME two queries with
       `date` added to the SELECT — no extra round-trips. */
    if (userRole === 'admin') {
      const [{ data: employees }, { data: allAtt }, { data: allRep }] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name')
          .eq('role', 'employee').order('first_name'),
        supabase.from('attendance').select('user_id, date, day_type, arrival_time, departure_time')
          .gte('date', first).lte('date', last),
        supabase.from('hour_reports').select('user_id, date, hours, minutes')
          .gte('date', first).lte('date', last),
      ])

      const empDaily = (employees || []).map(emp => {
        const empAtt = allAtt ? allAtt.filter(a => a.user_id === emp.id) : []
        const empRep = allRep ? allRep.filter(r => r.user_id === emp.id) : []

        /* Aggregate by date — same logic as fetchEmployeeDailyDetails so the
           rendered line is identical to the report's drill-down entries. */
        const dayMap = new Map()
        for (const a of empAtt) {
          const existing = dayMap.get(a.date) || {
            date: a.date, dayType: null, attMins: 0, repMins: 0,
            arrivalTime: null, departureTime: null,
          }
          if (a.day_type) existing.dayType = a.day_type
          if (a.arrival_time   && !existing.arrivalTime)   existing.arrivalTime   = a.arrival_time.slice(0, 5)
          if (a.departure_time && !existing.departureTime) existing.departureTime = a.departure_time.slice(0, 5)
          if (a.day_type === 'work' && a.arrival_time && a.departure_time) {
            existing.attMins += toMins(a.departure_time.slice(0, 5)) - toMins(a.arrival_time.slice(0, 5))
          }
          dayMap.set(a.date, existing)
        }
        for (const r of empRep) {
          const existing = dayMap.get(r.date) || {
            date: r.date, dayType: null, attMins: 0, repMins: 0,
            arrivalTime: null, departureTime: null,
          }
          existing.repMins += (r.hours || 0) * 60 + (r.minutes || 0)
          dayMap.set(r.date, existing)
        }

        const byDate = {}
        for (const day of dayMap.values()) {
          /* Prefer attendance diff (actual at-work mins); fall back to project sum (admin case). */
          const totalMins = day.attMins > 0 ? day.attMins : day.repMins
          /* Include vacation/sick days OR days with hours. Skip empty days. */
          if (day.dayType === 'vacation' || day.dayType === 'sick' || totalMins > 0) {
            byDate[day.date] = {
              date:          day.date,
              dayType:       day.dayType,
              arrivalTime:   day.arrivalTime,
              departureTime: day.departureTime,
              totalMins,
            }
          }
        }

        return {
          id:    emp.id,
          name:  [emp.first_name, emp.last_name].filter(Boolean).join(' ').trim() || '-',
          byDate,
        }
      })

      empDaily.sort((a, b) => a.name.localeCompare(b.name, 'he'))
      setDailyByEmployee(empDaily)
    }
  }

  /* ── Drill-down helpers — fetch + toggle + render body ── */
  /* fetchEmployeeDailyDetails + formatDrillLine live in
     src/lib/hoursDetail.js — imported at the top of the file so this
     component and the standalone "דוח שעות עבודה" page share exactly
     one implementation of the drill-down data pull and line format. */

  /* Same as formatDrillLine but WITHOUT the leading "DD/MM/YY  |  " segment.
     Used only in the per-day view below the calendar — the date is already
     visible on the calendar itself, so showing it again on each row is noise.
     formatDrillLine is intentionally left unchanged (still used by the report
     drill-down and the employee daily-details list, which list multiple days). */
  const formatDrillEntryNoDate = (day) => {
    if (day.dayType === 'vacation') return 'יום חופש'
    if (day.dayType === 'sick')     return 'יום מחלה'
    const arrival   = day.arrivalTime   || '—'
    const departure = day.departureTime || '—'
    const total     = formatTotalHHMM(day.totalMins)
    return `${arrival} - ${departure}  |  סה״כ שעות: ${total}`
  }

  const toggleCalendarDrill = async (uId) => {
    if (calendarDrillExpanded.has(uId)) {
      setCalendarDrillExpanded(prev => { const n = new Set(prev); n.delete(uId); return n })
      return
    }
    setCalendarDrillExpanded(prev => new Set(prev).add(uId))
    if (!calendarDrillCache[uId]) {
      setCalendarDrillLoading(prev => new Set(prev).add(uId))
      const days = await fetchEmployeeDailyDetails(uId, viewYear, viewMonth)
      setCalendarDrillCache(prev => ({ ...prev, [uId]: days }))
      setCalendarDrillLoading(prev => { const n = new Set(prev); n.delete(uId); return n })
    }
  }

  const toggleReportDrill = async (uId) => {
    if (reportDrillExpanded.has(uId)) {
      setReportDrillExpanded(prev => { const n = new Set(prev); n.delete(uId); return n })
      return
    }
    setReportDrillExpanded(prev => new Set(prev).add(uId))
    if (!reportDrillCache[uId]) {
      setReportDrillLoading(prev => new Set(prev).add(uId))
      const days = await fetchEmployeeDailyDetails(uId, reportYear, reportMonth)
      setReportDrillCache(prev => ({ ...prev, [uId]: days }))
      setReportDrillLoading(prev => { const n = new Set(prev); n.delete(uId); return n })
    }
  }

  const renderDrillBody = (uId, mode) => {
    const loadingSet = mode === 'calendar' ? calendarDrillLoading : reportDrillLoading
    const cache      = mode === 'calendar' ? calendarDrillCache    : reportDrillCache
    if (loadingSet.has(uId)) return <div className="hours-drill-loading">טוען...</div>
    const days = cache[uId]
    if (!days || days.length === 0) return <div className="hours-drill-empty">אין ימים פעילים</div>
    return days.map(day => (
      <div key={day.date} className="hours-drill-line">{formatDrillLine(day)}</div>
    ))
  }

  /* Reset calendar drill state when the calendar month changes. */
  useEffect(() => {
    setCalendarDrillExpanded(new Set())
    setCalendarDrillCache({})
  }, [viewYear, viewMonth])

  /* Reset report drill state when the report month changes. */
  useEffect(() => {
    setReportDrillExpanded(new Set())
    setReportDrillCache({})
  }, [reportYear, reportMonth])

  /* Deferred print — fires after React commits the drill cache into
     the DOM (so the print-only .hours-drill-print-row for every
     employee has its content), then calls window.print() on the next
     paint via requestAnimationFrame. Double-rAF is the safest way to
     be sure the browser has painted the DOM before the print dialog
     snapshots it. */
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

  /* Initialize the admin multi-select with ONLY Adi + Inbar (by first_name)
     when allUsers loads. All other employees (including Nir) start UNchecked. */
  useEffect(() => {
    const DEFAULT_FIRST_NAMES = new Set(['עדי', 'ענבר'])
    const empIds = allUsers
      .filter(u => u.role === 'employee' && DEFAULT_FIRST_NAMES.has(u.first_name))
      .map(u => u.id)
    setSelectedEmployeeIds(new Set(empIds))
  }, [allUsers])

  /* Auto-fetch report data whenever ANY filter changes (employee multi-select,
     month, year) — replaces the manual "הצג" button click. Fires on mount once
     userId is set, then again whenever a filter value changes. */
  useEffect(() => {
    if (userId) fetchReportData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, reportYear, reportMonth, selectedEmployeeIds])

  // ── Reports (admin Tab 3) ──
  const fetchReportData = async () => {
    /* Collapse all drill-downs and clear cache before re-fetching summary data */
    setReportDrillExpanded(new Set())
    setReportDrillCache({})
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
      // Prefer attendance diff (actual time at work); fall back to project sum for admin users
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

  // ── Select day ──
  const selectDay = async (dateStr) => {
    setSelectedDate(dateStr)
    setArrival('')
    setDeparture('')
    setOrigArrival('')
    setOrigDeparture('')
    setDayType('work')
    setWorkFromHome(false)
    setRecords([])
    setAttendanceId(null)
    setPendingId(null)
    setDayStatus(null)
    setManualEntry(false)
    setArrivalError('')
    setDepartureError('')
    if (!userId) return

    const [{ data: attData }, { data: pendData }, { data: reps }] = await Promise.all([
      supabase.from('attendance')
        .select('id, arrival_time, departure_time, day_type, work_from_home')
        .eq('user_id', userId).eq('date', dateStr).maybeSingle(),
      supabase.from('pending_approvals')
        .select('id, arrival_time, departure_time, day_type, status, work_from_home')
        .eq('user_id', userId).eq('date', dateStr).maybeSingle(),
      supabase.from('hour_reports')
        .select('id, project_id, stage, stage_id, hours, minutes')
        .eq('user_id', userId).eq('date', dateStr),
    ])

    if (attData) {
      const arr = attData.arrival_time   ? attData.arrival_time.slice(0, 5)   : ''
      const dep = attData.departure_time ? attData.departure_time.slice(0, 5) : ''
      setAttendanceId(attData.id)
      setArrival(arr)
      setDeparture(dep)
      setOrigArrival(arr)
      setOrigDeparture(dep)
      setDayType(attData.day_type || 'work')
      setWorkFromHome(!!attData.work_from_home)
      setDayStatus('approved')
    }

    if (pendData) {
      setPendingId(pendData.id)
      if (!attData) {
        const arr = pendData.arrival_time   ? pendData.arrival_time.slice(0, 5)   : ''
        const dep = pendData.departure_time ? pendData.departure_time.slice(0, 5) : ''
        setArrival(arr)
        setDeparture(dep)
        setOrigArrival(arr)
        setOrigDeparture(dep)
        setDayType(pendData.day_type || 'work')
        setWorkFromHome(!!pendData.work_from_home)
        setDayStatus(pendData.status)
        // Past pending/rejected records were manually submitted → default to manual mode
        if (dateStr < todayISO()) setManualEntry(true)
      }
    }

    // For today: override arrival/departure from localStorage if present
    if (dateStr === todayISO()) {
      const lsArr = localStorage.getItem('arrival_time_today')
      const lsDep = localStorage.getItem('departure_time_today')
      if (lsArr) { setArrival(lsArr); setOrigArrival(lsArr) }
      if (lsDep) { setDeparture(lsDep); setOrigDeparture(lsDep) }
    }

    if (reps?.length > 0) {
      setRecords(reps.map(r => ({
        id:          r.id,
        // NULL in DB → GENERAL_VALUE so the "כללי" option is pre-selected
        project_id:  r.project_id == null ? GENERAL_VALUE : r.project_id,
        stage_id:    r.stage_id   == null ? GENERAL_VALUE : r.stage_id,
        hours_hhmm:  toHHMM((r.hours || 0) * 60 + (r.minutes || 0)),
      })))
    }
  }

  // ── Record helpers ──
  const addRecord    = () => setRecords(prev => [...prev, { id: null, project_id: '', stage_id: '', hours_hhmm: '' }])
  const updateRecord = (idx, field, val) => setRecords(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  const removeRecord = (idx) => setRecords(prev => prev.filter((_, i) => i !== idx))

  const workMins   = () => (arrival && departure ? toMins(departure) - toMins(arrival) : 0)
  const recordMins = () => records.reduce((s, r) => s + toMins(r.hours_hhmm), 0)

  // ── Derived permissions ──
  const today   = todayISO()
  const isAdmin = userRole === 'admin'
  const isPast  = !!(selectedDate && selectedDate < today)
  const isToday  = !!(selectedDate && selectedDate === today)

  // Time fields editable: admin always, employee only in manual-entry mode
  const timeFieldsEditable = isAdmin || manualEntry

  // Project records always editable (any record, any time)
  const canEditProjects = true

  // Any record can be deleted at any time
  const canDelete = !!selectedDate

  // Detect if times have changed vs what was loaded (only relevant in manual mode)
  const timesChanged = manualEntry && (arrival !== origArrival || departure !== origDeparture)

  // ── Button mode ──
  // vacation_sick    → "שמור" (green) — save vacation/sick directly to attendance (approved)
  // admin_save       → "שמור" (green) — admin saves work day directly to attendance (approved)
  // direct_save      → "סיום" (green) — auto mode, saves to attendance+hour_reports directly
  // submit_approval  → "שלח לאישור" / "עדכן בקשה" (orange) — manual mode, saves to pending_approvals
  // update_dist      → "עדכן חלוקה" (green) — project records only, no time change
  let buttonMode = null
  if (selectedDate) {
    if (dayType !== 'work') {
      // vacation/sick: always direct to attendance, no approval needed
      buttonMode = 'vacation_sick'
    } else if (isAdmin) {
      buttonMode = 'admin_save'
    } else if (!manualEntry) {
      // Auto mode: arrival/departure come from Header buttons, locked in form
      buttonMode = dayStatus === 'approved' ? 'update_dist' : 'direct_save'
    } else {
      // Manual-entry mode
      if (dayStatus === 'approved' && !timesChanged) {
        // Only project distribution changed
        buttonMode = 'update_dist'
      } else {
        // New entry, or times changed → needs approval
        buttonMode = 'submit_approval'
      }
    }
  }

  // Show tooltip when auto mode needs departure before submit
  const needsDeparture = buttonMode === 'direct_save' && !!arrival && !departure

  const canSubmit = () => {
    if (!selectedDate || !buttonMode) return false
    if (buttonMode === 'vacation_sick') return true
    if (buttonMode === 'admin_save') {
      // Admin saves directly — no arrival/departure needed, just need project records
      return records.length > 0
    }
    if (buttonMode === 'direct_save') {
      if (needsDeparture || !arrival || !departure || arrivalError || departureError) return false
      return workMins() > 0 && records.length > 0 && Math.abs(workMins() - recordMins()) <= 30
    }
    if (buttonMode === 'submit_approval') {
      return !!(arrival && departure && !arrivalError && !departureError)
    }
    if (buttonMode === 'update_dist') {
      return records.length > 0 && Math.abs(workMins() - recordMins()) <= 30
    }
    return false
  }

  // ── Save helpers ──

  // Vacation / sick: save directly to attendance as approved (no approval flow)
  const handleVacationSickSave = async () => {
    if (!selectedDate || !userId) return
    setSaving(true)
    const { data: upserted } = await supabase
      .from('attendance')
      .upsert(
        { user_id: userId, date: selectedDate, day_type: dayType, arrival_time: null, departure_time: null, work_from_home: false },
        { onConflict: 'user_id,date' }
      )
      .select().single()
    if (upserted) setAttendanceId(upserted.id)
    // Remove any pending entry for this day
    if (pendingId) {
      await supabase.from('pending_approvals').delete().eq('id', pendingId).eq('user_id', userId)
      setPendingId(null)
    }
    setDayStatus('approved')
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    fetchCalendarData()
    fetchMonthlySummary()
  }

  // Auto work mode: save directly to attendance + hour_reports as approved
  const handleDirectSave = async () => {
    if (!selectedDate || !userId) return
    setSaving(true)
    console.log('saving work_from_home:', workFromHome)
    const { data: upserted, error: directError } = await supabase
      .from('attendance')
      .upsert(
        { user_id: userId, date: selectedDate, day_type: 'work', arrival_time: arrival || null, departure_time: departure || null, work_from_home: workFromHome },
        { onConflict: 'user_id,date' }
      )
      .select().single()
    console.log('attendance result:', { data: upserted, error: directError })
    if (upserted) setAttendanceId(upserted.id)
    const { error: deleteError } = await supabase.from('hour_reports').delete().eq('user_id', userId).eq('date', selectedDate)
    console.log('hour_reports delete result:', { error: deleteError })
    const inserts = buildHourReportInserts()
    console.log('hour_reports rows to insert:', inserts)
    const { data: insertData, error: insertError } = inserts.length > 0
      ? await supabase.from('hour_reports').insert(inserts).select()
      : { data: null, error: null }
    console.log('hour_reports insert result:', { data: insertData, error: insertError })
    // Clean up draft from pending_approvals if it exists
    if (pendingId) {
      const { error: pendingDeleteError } = await supabase.from('pending_approvals').delete().eq('id', pendingId).eq('user_id', userId)
      console.log('pending_approvals delete result:', { error: pendingDeleteError })
      setPendingId(null)
    }
    setDayStatus('approved')
    setOrigArrival(arrival)
    setOrigDeparture(departure)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    fetchCalendarData()
    fetchMonthlySummary()
  }

  const buildHourReportInserts = () =>
    records
      // GENERAL_VALUE ('__general__') is truthy, so it passes the project_id check just like a real id.
      // Empty string (nothing selected) is falsy and is correctly excluded.
      .filter(r => r.project_id && r.hours_hhmm)
      .map(r => {
        const mins = toMins(r.hours_hhmm)
        return {
          user_id:    userId,
          date:       selectedDate,
          // GENERAL_VALUE → NULL in DB; real UUID stays as-is
          project_id: r.project_id === GENERAL_VALUE ? null : (r.project_id || null),
          // GENERAL_VALUE → NULL; '' → NULL; real id (number) → Number
          stage_id:   r.stage_id === GENERAL_VALUE ? null : (r.stage_id !== '' ? Number(r.stage_id) : null),
          hours:      Math.floor(mins / 60),
          minutes:    mins % 60,
        }
      })

  // Admin work day: save only to hour_reports (no attendance record needed)
  const handleAdminSave = async () => {
    if (!selectedDate || !userId) return
    setSaving(true)

    await supabase.from('hour_reports').delete().eq('user_id', userId).eq('date', selectedDate)
    const inserts = buildHourReportInserts()
    const { error: adminError } = inserts.length > 0
      ? await supabase.from('hour_reports').insert(inserts)
      : { error: null }
    console.log('save error:', adminError)

    // Clean up any pending entry for this day
    if (pendingId) {
      await supabase.from('pending_approvals').delete().eq('id', pendingId)
      setPendingId(null)
    }

    setDayStatus('approved')
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    fetchCalendarData()
    fetchMonthlySummary()
  }

  // Employee: send to pending_approvals (any date, including future/today)
  const handleEmployeeSave = async () => {
    if (!selectedDate || !userId) return
    setSaving(true)
    console.log('saving work_from_home:', workFromHome)

    const breakdownRows = dayType === 'work'
      ? records
          .filter(r => r.project_id && r.hours_hhmm)
          .map(r => {
            const mins = toMins(r.hours_hhmm)
            return {
              // GENERAL_VALUE → NULL in JSONB; doApprove will insert NULL as-is (no re-conversion needed)
              project_id: r.project_id === GENERAL_VALUE ? null : (r.project_id || null),
              stage_id:   r.stage_id   === GENERAL_VALUE ? null : (r.stage_id !== '' ? Number(r.stage_id) : null),
              hours:      Math.floor(mins / 60),
              minutes:    mins % 60,
            }
          })
      : []

    const payload = {
      user_id:           userId,
      date:              selectedDate,
      day_type:          dayType,
      arrival_time:      dayType === 'work' ? (arrival   || null) : null,
      departure_time:    dayType === 'work' ? (departure || null) : null,
      work_from_home:    dayType === 'work' ? workFromHome : false,
      status:            'pending',
      project_breakdown: breakdownRows.length > 0 ? breakdownRows : null,
    }

    // Step 2: update or insert into pending_approvals (upsert by user_id + date)
    // Resolve the pending id — from state first, then a DB lookup
    let resolvedPendingId = pendingId
    if (!resolvedPendingId) {
      const { data: existing } = await supabase
        .from('pending_approvals')
        .select('id')
        .eq('user_id', userId)
        .eq('date', selectedDate)
        .maybeSingle()
      resolvedPendingId = existing?.id || null
      if (resolvedPendingId) setPendingId(resolvedPendingId)
    }

    let saveError = null
    if (resolvedPendingId) {
      // Record exists — update it, do NOT delete
      const { error } = await supabase
        .from('pending_approvals')
        .update(payload)
        .eq('id', resolvedPendingId)
        .eq('user_id', userId)
      saveError = error
    } else {
      // No existing record — insert new
      const { data, error } = await supabase
        .from('pending_approvals')
        .insert([payload])
        .select()
        .single()
      if (data) setPendingId(data.id)
      saveError = error
    }
    console.log('save result:', saveError)

    // Step 3: if an attendance record exists, also update it + replace hour_reports
    if (attendanceId) {
      await supabase
        .from('attendance')
        .update({
          arrival_time:   arrival   || null,
          departure_time: departure || null,
          work_from_home: workFromHome,
        })
        .eq('id', attendanceId)
        .eq('user_id', userId)
      await supabase.from('hour_reports').delete().eq('user_id', userId).eq('date', selectedDate)
      const inserts = buildHourReportInserts()
      if (inserts.length > 0) await supabase.from('hour_reports').insert(inserts)
    }

    setDayStatus('pending')
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    fetchCalendarData()
    fetchMonthlySummary()
  }

  // Employee: update project distribution for an approved past work day
  const handleUpdateDistribution = async () => {
    if (!selectedDate || !userId) return
    setSaving(true)
    console.log('updating work_from_home:', workFromHome)

    const [, { error: wfhError }] = await Promise.all([
      supabase.from('hour_reports').delete().eq('user_id', userId).eq('date', selectedDate),
      supabase.from('attendance').update({ work_from_home: workFromHome }).eq('user_id', userId).eq('date', selectedDate),
    ])
    console.log('save error:', wfhError)
    const inserts = buildHourReportInserts()
    if (inserts.length > 0) await supabase.from('hour_reports').insert(inserts)

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    fetchCalendarData()
    fetchMonthlySummary()
  }

  const handleMainAction = () => {
    if (buttonMode === 'vacation_sick')   return handleVacationSickSave()
    if (buttonMode === 'admin_save')      return handleAdminSave()
    if (buttonMode === 'direct_save')     return handleDirectSave()
    if (buttonMode === 'submit_approval') return handleEmployeeSave()
    if (buttonMode === 'update_dist')     return handleUpdateDistribution()
  }

  // Any record can be deleted at any time (no restrictions)
  const handleDelete = async () => {
    if (!selectedDate || !userId) return

    // Delete from all three tables by user_id + date (no reliance on stored IDs)
    const [{ error: e1 }, { error: e2 }, { error: e3 }] = await Promise.all([
      supabase.from('attendance')       .delete().eq('user_id', userId).eq('date', selectedDate),
      supabase.from('pending_approvals').delete().eq('user_id', userId).eq('date', selectedDate),
      supabase.from('hour_reports')     .delete().eq('user_id', userId).eq('date', selectedDate),
    ])
    console.log('delete result:', { attendance: e1, pending_approvals: e2, hour_reports: e3 })

    // Clear stored IDs
    setAttendanceId(null)
    setPendingId(null)

    // Clear form
    setDayStatus(null)
    setArrival('')
    setDeparture('')
    setOrigArrival('')
    setOrigDeparture('')
    setDayType('work')
    setWorkFromHome(false)
    setManualEntry(false)
    setRecords([])
    fetchCalendarData()
    fetchMonthlySummary()
  }

  // ── Admin approval actions ──
  const doApprove = async (rec) => {
    const { error: pendingError } = await supabase.from('pending_approvals')
      .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: loggedInUserId })
      .eq('id', rec.id)
    const { error: upsertError } = await supabase.from('attendance').upsert(
      {
        user_id:        rec.user_id,
        date:           rec.date,
        day_type:       rec.day_type,
        arrival_time:   rec.arrival_time,
        departure_time: rec.departure_time,
        work_from_home: !!rec.work_from_home,
      },
      { onConflict: 'user_id,date' }
    )

    // Create hour_reports from project_breakdown if attendance upsert succeeded
    if (!upsertError && rec.project_breakdown && rec.project_breakdown.length > 0) {
      const { error: deleteError } = await supabase
        .from('hour_reports')
        .delete()
        .eq('user_id', rec.user_id)
        .eq('date', rec.date)

      const hrInserts = rec.project_breakdown.map(b => ({
        user_id:    rec.user_id,
        date:       rec.date,
        project_id: b.project_id,
        stage_id:   b.stage_id,
        hours:      b.hours,
        minutes:    b.minutes,
      }))
      const { error: insertError } = await supabase
        .from('hour_reports')
        .insert(hrInserts)
    }
  }

  const handleApproveRecord = async (rec) => {
    await doApprove(rec)
    setApprovalsList(prev => prev.filter(r => r.id !== rec.id))
    fetchCalendarData()
    fetchMonthlySummary()
  }

  const handleRejectRecord = async (id) => {
    await supabase.from('pending_approvals')
      .update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: userId })
      .eq('id', id)
    setApprovalsList(prev => prev.filter(r => r.id !== id))
  }

  const handleApproveAll = async () => {
    for (const rec of [...approvalsList]) {
      await doApprove(rec)
    }
    setApprovalsList([])
    fetchCalendarData()
    fetchMonthlySummary()
  }

  const approvalEmployeeName = (rec) => {
    if (!rec._profile) return '-'
    const { first_name, last_name } = rec._profile
    return `${first_name || ''} ${last_name || ''}`.trim() || '-'
  }

  // ── Button label / class ──
  const getButtonLabel = () => {
    if (saving) return '...'
    if (buttonMode === 'vacation_sick')   return 'שמור'
    if (buttonMode === 'admin_save')      return 'שמור'
    if (buttonMode === 'direct_save')     return 'סיום'
    if (buttonMode === 'submit_approval') return dayStatus === 'pending' ? 'עדכן בקשה' : 'שלח לאישור'
    if (buttonMode === 'update_dist')     return 'עדכן חלוקה'
    return ''
  }

  const getButtonClass = () => {
    if (['vacation_sick', 'admin_save', 'direct_save', 'update_dist'].includes(buttonMode))
      return 'hours-save-btn hours-save-btn-green'
    if (buttonMode === 'submit_approval')
      return 'hours-submit-approval-btn'
    return 'hours-save-btn'
  }

  // ── Admin: switch viewed user ──
  const handleViewUserChange = (newUserId) => {
    setViewUserId(newUserId)
    setUserId(newUserId)
    setSelectedDate(todayISO())
    setArrival(''); setDeparture(''); setOrigArrival(''); setOrigDeparture('')
    setDayType('work'); setWorkFromHome(false)
    setRecords([]); setAttendanceId(null); setPendingId(null)
    setDayStatus(null); setManualEntry(false)
    setArrivalError(''); setDepartureError('')
  }

  // ── Calendar grid ──
  const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay()
  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const diff = Math.abs(workMins() - recordMins())

  const DAY_STATUS_LABELS = {
    approved: '✓ מאושר',
    pending:  '⏳ ממתין לאישור',
    rejected: '✗ נדחה',
  }

  // ─── Reusable JSX fragments ────────────────────────────────────────────

  // Calendar + monthly summary — used in employee right panel and admin left panel
  const calendarContent = (
    <>
      <div className="hours-cal-header">
        <button className="hours-cal-nav" onClick={() => {
          setGcalDots({})
          if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
          else setViewMonth(m => m + 1)
        }}>‹</button>
        <span className="hours-cal-title">{MONTH_NAMES[viewMonth]} {viewYear}</span>
        <button className="hours-cal-nav" onClick={() => {
          setGcalDots({})
          if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
          else setViewMonth(m => m - 1)
        }}>›</button>
      </div>

      <div className="hours-cal-grid">
        {DAY_NAMES.map(d => (
          <div key={d} className="hours-cal-dayname">{d}</div>
        ))}
        {cells.map((day, idx) => {
          if (!day) return <div key={`e-${idx}`} className="hours-cal-empty" />
          const ds        = isoDate(viewYear, viewMonth, day)
          const info      = calData[ds]
          const dt        = info?.dayType   || 'work'
          const mins      = info?.totalMins || 0
          const attMins   = info?.attMins   || 0
          const calStatus = info?.calStatus
          const isSel     = ds === selectedDate

          let cls = 'hours-cal-cell'
          if (calStatus && dt === 'vacation') cls += ' cal-vacation'
          else if (calStatus && dt === 'sick') cls += ' cal-sick'
          if (calStatus === 'rejected') cls += ' cal-rejected'
          if (ds === today) cls += ' cal-today'
          if (isSel)        cls += ' cal-selected'

          const dots = gcalDots[ds] || []

          return (
            <div key={ds} className={cls} onClick={() => selectDay(ds)}>
              <span className="cal-day-num">{day}</span>
              {isAdmin && dots.length > 0 && (
                <div className="cal-gcal-dots">
                  {dots.slice(0, 3).map((color, i) => (
                    <span key={i} className="cal-gcal-dot" style={{ background: color }} />
                  ))}
                </div>
              )}
              {calStatus === 'approved' && dt === 'work' && (
                <>
                  <span className="cal-status-approved">✓</span>
                  {(mins > 0 || attMins > 0) && (
                    <span className="cal-day-hours">{toHHMM(attMins > 0 ? attMins : mins)}</span>
                  )}
                </>
              )}
              {calStatus === 'approved' && dt === 'vacation' && (
                <span className="cal-day-label">חופש</span>
              )}
              {calStatus === 'approved' && dt === 'sick' && (
                <span className="cal-day-label">מחלה</span>
              )}
              {calStatus === 'pending' && dt === 'work' && (
                <span className="cal-status-pending">⏳</span>
              )}
              {calStatus === 'pending' && dt === 'vacation' && (
                <>
                  <span className="cal-day-label">חופש</span>
                  <span className="cal-status-pending">⏳</span>
                </>
              )}
              {calStatus === 'pending' && dt === 'sick' && (
                <>
                  <span className="cal-day-label">מחלה</span>
                  <span className="cal-status-pending">⏳</span>
                </>
              )}
              {calStatus === 'rejected' && (
                <span className="cal-status-rejected">✗</span>
              )}
            </div>
          )
        })}
      </div>

      {isAdmin ? (
        /* Admin: per-day view, driven by clicking a day in the calendar.
           For each currently-selected employee that has an entry on the
           selected day, render one row using the same daily-entry format
           as the report's drill-down lines. Employees with no entry for
           the selected day are omitted entirely. */
        <div className="hours-monthly-summary-admin">
          {dailyByEmployee
            .filter(emp => selectedEmployeeIds.has(emp.id) && emp.byDate[selectedDate])
            .map(emp => (
              <div key={emp.id} className="hours-summary-group">
                <div className="hours-summary-row">
                  <span className="hours-employee-name">{emp.name}</span>
                  <span className="hours-summary-sep">|</span>
                  <span className="hours-drill-line">{formatDrillEntryNoDate(emp.byDate[selectedDate])}</span>
                </div>
              </div>
            ))}
        </div>
      ) : null}
    </>
  )

  // Entry form body — used in employee left panel and admin Tab 1
  const entryFormBody = !selectedDate ? (
    <div className="hours-no-selection">בחר יום בלוח השנה</div>
  ) : (
    <>
      <div className="hours-form-header-row">
        <div className="hours-form-title">{formatTitle(selectedDate)}</div>
        {dayStatus && (
          <div className={`hours-day-status hours-status-${dayStatus}`}>
            {DAY_STATUS_LABELS[dayStatus]}
          </div>
        )}
      </div>

      <div className="hours-daytype-row">
        <button className={`hours-daytype-btn${dayType === 'work'     ? ' active' : ''}`} onClick={() => setDayType('work')}>עבודה</button>
        <button className={`hours-daytype-btn vacation${dayType === 'vacation' ? ' active' : ''}`} onClick={() => setDayType('vacation')}>חופש</button>
        <button className={`hours-daytype-btn sick${dayType === 'sick'     ? ' active' : ''}`} onClick={() => setDayType('sick')}>מחלה</button>
      </div>

      {dayType === 'work' && !isAdmin && (
        <label className="hours-wfh-label">
          <input type="checkbox" checked={workFromHome} onChange={e => setWorkFromHome(e.target.checked)} />
          <span>עבודה מהבית</span>
        </label>
      )}

      {dayType === 'work' && (
        <>
          {!isAdmin && (
            <>
              <div className="hours-arrival-row">
                <span className="hours-time-label">הגעה</span>
                <input
                  className={`hours-time-input${arrivalError ? ' hours-time-input-error' : ''}${!timeFieldsEditable ? ' hours-time-input-locked' : ''}`}
                  type="text" placeholder="HH:MM" value={arrival}
                  onChange={e => { if (timeFieldsEditable) { setArrival(formatTimeInput(e.target.value)); setArrivalError('') } }}
                  onBlur={e => timeFieldsEditable && setArrivalError(validateTime(e.target.value))}
                  readOnly={!timeFieldsEditable}
                />
                <span className="hours-time-label">יציאה</span>
                <input
                  className={`hours-time-input${departureError ? ' hours-time-input-error' : ''}${!timeFieldsEditable ? ' hours-time-input-locked' : ''}`}
                  type="text" placeholder="HH:MM" value={departure}
                  onChange={e => { if (timeFieldsEditable) { setDeparture(formatTimeInput(e.target.value)); setDepartureError('') } }}
                  onBlur={e => timeFieldsEditable && setDepartureError(validateTime(e.target.value))}
                  readOnly={!timeFieldsEditable}
                />
                {arrival && departure && !arrivalError && !departureError && (
                  <span className="hours-total-work">סה״כ: {toHHMM(workMins())}</span>
                )}
                <label className="hours-manual-entry-label">
                  <input
                    type="checkbox" checked={manualEntry}
                    onChange={e => { setManualEntry(e.target.checked); setArrivalError(''); setDepartureError('') }}
                  />
                  <span>הזנה ידנית</span>
                </label>
              </div>
              {(arrivalError || departureError) && (
                <div className="hours-time-errors-row">
                  {arrivalError   && <span className="hours-time-error">{arrivalError}</span>}
                  {departureError && <span className="hours-time-error">{departureError}</span>}
                </div>
              )}
            </>
          )}

          <div className="hours-records-box">
            {records.map((rec, idx) => (
              <div key={idx} className="hours-record-row">
                <select className="hours-select" value={rec.project_id}
                  onChange={e => updateRecord(idx, 'project_id', e.target.value)}>
                  <option value="">פרויקט...</option>
                  <option value={GENERAL_VALUE}>{GENERAL_LABEL}</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select className="hours-select hours-select-stage" value={rec.stage_id}
                  onChange={e => updateRecord(idx, 'stage_id', e.target.value)}>
                  <option value="">שלב...</option>
                  <option value={GENERAL_VALUE}>{GENERAL_LABEL}</option>
                  {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select className="hours-time-select" value={rec.hours_hhmm}
                  onChange={e => updateRecord(idx, 'hours_hhmm', e.target.value)}>
                  <option value="">שעות...</option>
                  {HOUR_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button className="hours-remove-btn" onClick={() => removeRecord(idx)} title="הסר שורה">🗑</button>
              </div>
            ))}
            <button className="hours-add-record-btn" onClick={addRecord}>+ הוסף פרויקט</button>
            {records.length > 0 && (
              <div className="hours-records-total">
                סה״כ פרויקטים: {toHHMM(recordMins())}
                {workMins() > 0 && (
                  <span className={diff <= 15 ? 'hours-match' : 'hours-mismatch'}>
                    {diff <= 15 ? ' ✓' : ` (פער: ${toHHMM(diff)})`}
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="hours-save-row">
        {buttonMode && (
          <button
            className={getButtonClass()}
            onClick={handleMainAction}
            disabled={saving || !canSubmit()}
            title={needsDeparture ? 'יש ללחוץ יצאתי לפני שליחה' : ''}
          >
            {getButtonLabel()}
          </button>
        )}
        {canDelete && (
          <button className="hours-delete-btn" onClick={handleDelete} title="מחק">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}
        {saved && <span className="hours-saved-indicator">✓ נשמר</span>}
      </div>
    </>
  )

  // Approvals content — admin Tab 2
  const approvalsContent = (
    <div className="hours-approvals-tab">
      <div className="hours-approvals-header">
        <span className="hours-approvals-title">אישורים לדיווח שעות</span>
        {approvalsList.length > 0 && (
          <button className="hours-approve-all-btn" onClick={handleApproveAll} title="אשר הכל">
            ✓✓ אשר הכל ({approvalsList.length})
          </button>
        )}
      </div>
      {approvalsList.length === 0 ? (
        <div className="hours-approvals-empty">אין אישורים ממתינים</div>
      ) : (
        <table className="hours-approvals-table">
          <thead>
            <tr>
              <th>שם עובד</th>
              <th>תאריך</th>
              <th>סוג</th>
              <th>הגעה</th>
              <th>יציאה</th>
              <th>סה״כ שעות</th>
              <th>מהבית</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {approvalsList.map(rec => {
              const recMins = rec.arrival_time && rec.departure_time
                ? toMins(rec.departure_time.slice(0, 5)) - toMins(rec.arrival_time.slice(0, 5))
                : 0
              return (
                <tr key={rec.id}>
                  <td>{approvalEmployeeName(rec)}</td>
                  <td>{formatDate(rec.date)}</td>
                  <td>{DAY_TYPE_LABELS[rec.day_type] || rec.day_type}</td>
                  <td>{rec.arrival_time   ? rec.arrival_time.slice(0, 5)   : '-'}</td>
                  <td>{rec.departure_time ? rec.departure_time.slice(0, 5) : '-'}</td>
                  <td>{recMins > 0 ? toHHMM(recMins) : '-'}</td>
                  <td>{rec.work_from_home ? 'כן' : 'לא'}</td>
                  <td>
                    <div className="hours-approval-actions">
                      <button className="hours-approve-icon-btn" title="אשר" onClick={() => handleApproveRecord(rec)}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M2.5 8.5L6 12L13.5 4" stroke="#22c55e" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button className="hours-reject-icon-btn" title="דחה" onClick={() => handleRejectRecord(rec.id)}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M4 4L12 12M12 4L4 12" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )

  // Reports content — used by admin Tab 4 and employee Tab 2.
  // When `lockedUserId` is set (employee mode), the employee dropdown is
  // pre-filled with that user, disabled, and the "הכל" option is hidden.
  const renderReportsContent = ({ lockedUserId = null } = {}) => {
    const userIsLocked = !!lockedUserId
    /* Admin sees the multi-select; locked employee sees a single-row table
       (no employee picker at all — they can only see themselves). */
    const employees = allUsers.filter(u => u.role === 'employee')
    const filteredRows = reportData.filter(row =>
      userIsLocked ? row.id === lockedUserId : selectedEmployeeIds.has(row.id)
    )

    /* PDF-export handler for this report.
       Pre-fetches per-day details for EVERY visible employee (not just
       the ones the user happens to have expanded on screen) so the
       exported PDF always includes each employee's full daily detail.
       The on-screen expand/collapse state is not consulted here — the
       print-only .hours-drill-print-row below reads directly from
       reportDrillCache. */
    const exportReport = async () => {
      const missing = filteredRows.filter(r => !reportDrillCache[r.id])
      if (missing.length > 0) {
        const additions = {}
        for (const r of missing) {
          additions[r.id] = await fetchEmployeeDailyDetails(r.id, reportYear, reportMonth)
        }
        /* Batched with setPrintPending so the deferred-print effect fires
           after this update is committed. */
        setReportDrillCache(prev => ({ ...prev, ...additions }))
      }
      setPrintPending(true)
    }
    return (
      <div className="hours-reports-tab">
        <div className="hours-reports-controls">
          {userIsLocked ? (
            <select
              className="hours-user-select"
              value={lockedUserId}
              disabled
            >
              {allUsers.filter(u => u.id === lockedUserId).map(u => (
                <option key={u.id} value={u.id}>
                  {[u.first_name, u.last_name].filter(Boolean).join(' ')}
                </option>
              ))}
            </select>
          ) : (
            employees.length > 0 && (
              <EmployeesMultiSelect
                employees={employees}
                selectedIds={selectedEmployeeIds}
                onChange={setSelectedEmployeeIds}
              />
            )
          )}
          <select
            className="hours-select hours-reports-select"
            value={reportMonth}
            onChange={e => setReportMonth(Number(e.target.value))}
          >
            {MONTH_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
          </select>
          <select
            className="hours-select hours-reports-select"
            value={reportYear}
            onChange={e => setReportYear(Number(e.target.value))}
          >
            {[2023, 2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        {reportLoading && <div className="hours-reports-loading">טוען...</div>}
        {!reportLoading && reportData.length > 0 && filteredRows.length === 0 && !userIsLocked && (
          <div className="hours-reports-empty">בחרי לפחות עובד אחד</div>
        )}
        {!reportLoading && reportData.length > 0 && filteredRows.length > 0 && (
          <>
            <div className="report-table-container">
              <div className="report-print-header">
                סטודיו בתים — דיווח שעות עובדים | {MONTH_NAMES[reportMonth]} {reportYear}
              </div>
              <table className="hours-report-table">
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
                            onClick={() => toggleReportDrill(row.id)}
                            title={reportDrillExpanded.has(row.id) ? 'סגור' : 'הצג ימים פעילים'}
                          >
                            {reportDrillExpanded.has(row.id) ? '−' : '+'}
                          </button>
                        </td>
                      </tr>
                      {reportDrillExpanded.has(row.id) && (
                        <tr className="hours-drill-row">
                          <td colSpan={7}>
                            <div className="hours-drill-list">{renderDrillBody(row.id, 'report')}</div>
                          </td>
                        </tr>
                      )}
                      {/* Print-only per-day detail — ALWAYS rendered in the
                          DOM, but display:none on screen. Made visible only
                          inside @media print. Reads its data straight from
                          reportDrillCache; the export handler above pre-warms
                          the cache for every filtered employee before print,
                          so this block has content regardless of whether the
                          on-screen row is currently expanded. */}
                      <tr className="hours-drill-print-row" aria-hidden="true">
                        <td colSpan={7}>
                          <div className="hours-drill-print-list">
                            {(reportDrillCache[row.id] || []).map(day => (
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
            </div>
            <div className="hours-reports-export-row">
              <button className="hours-reports-export-btn" title="ייצוא ל-PDF" onClick={exportReport}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
            </div>
          </>
        )}
        {!reportLoading && reportData.length === 0 && (
          <div className="hours-reports-empty">אין נתונים לחודש זה</div>
        )}
      </div>
    )
  }

  return (
    <div className="hours-page" dir="rtl">
      <div className="hours-split">
        {isAdmin ? (
          <>
            {/* Admin: LEFT = calendar, RIGHT = tabbed interface */}
            <div className="hours-calendar-panel">
              {calendarContent}
            </div>

            <div className="hours-form-panel">
              <div className="hours-admin-tabs-bar">
                <button
                  className={`hours-admin-tab${adminTab === 1 ? ' active' : ''}`}
                  onClick={() => setAdminTab(1)}
                >פגישות</button>
                <button
                  className={`hours-admin-tab${adminTab === 2 ? ' active' : ''}`}
                  onClick={() => setAdminTab(2)}
                >הזנת שעות</button>
                <button
                  className={`hours-admin-tab${adminTab === 3 ? ' active' : ''}`}
                  onClick={() => setAdminTab(3)}
                >
                  אישורים
                  {approvalsList.length > 0 && (
                    <span className="hours-tab-badge">{approvalsList.length}</span>
                  )}
                </button>
                <button
                  className={`hours-admin-tab${adminTab === 4 ? ' active' : ''}`}
                  onClick={() => setAdminTab(4)}
                >דוחות</button>
              </div>

              {adminTab === 1 && (
                <GoogleCalendarPanel
                  selectedDate={selectedDate}
                  userEmail={userEmail}
                  viewYear={viewYear}
                  viewMonth={viewMonth}
                  onMonthEvents={setGcalDots}
                />
              )}
              {adminTab === 2 && entryFormBody}
              {adminTab === 3 && approvalsContent}
              {adminTab === 4 && renderReportsContent()}
            </div>
          </>
        ) : (
          <>
            {/* Employee: RIGHT = calendar, LEFT = tabbed interface (entry / reports) */}
            <div className="hours-calendar-panel">
              {calendarContent}
            </div>

            <div className="hours-form-panel">
              <div className="hours-admin-tabs-bar">
                <button
                  className={`hours-admin-tab${employeeTab === 1 ? ' active' : ''}`}
                  onClick={() => setEmployeeTab(1)}
                >הזנת שעות</button>
                <button
                  className={`hours-admin-tab${employeeTab === 2 ? ' active' : ''}`}
                  onClick={() => setEmployeeTab(2)}
                >דוחות</button>
              </div>

              {employeeTab === 1 && entryFormBody}
              {employeeTab === 2 && renderReportsContent({ lockedUserId: userId })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default Hours
