import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import './Header.css'

// DEV ONLY - REMOVE BEFORE PRODUCTION
const DEV_USERS = [
  { label: 'עינב', email: 'einav.studiob@gmail.com',  password: 'einav4924' },
  { label: 'ניר',  email: 'shifman2000@gmail.com',    password: '1234' },
  { label: 'ענבר', email: 'inbar.studiob@gmail.com',  password: 'Test1234' },
]

const todayStr = () => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

const nowHHMM = () => {
  const n = new Date()
  return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`
}

function Header() {
  const [arrived, setArrived]       = useState(false)
  const [firstName, setFirstName]   = useState('')
  const [userId, setUserId]         = useState(null)
  const [role, setRole]             = useState(null)
  const navigate = useNavigate()

  // DEV ONLY - REMOVE BEFORE PRODUCTION
  const handleDevSwitch = async (email, password) => {
    const today = todayStr()
    // Step 1: sign in as the target user to obtain their uid
    await supabase.auth.signOut()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data?.user) {
      console.error('Dev switch sign-in failed:', error)
      return
    }
    const uid = data.user.id
    // Step 2: wipe ALL of today's records for that user across all tables
    const [{ error: e1 }, { error: e2 }, { error: e3 }] = await Promise.all([
      supabase.from('attendance')       .delete().eq('user_id', uid).eq('date', today),
      supabase.from('pending_approvals').delete().eq('user_id', uid).eq('date', today),
      supabase.from('hour_reports')     .delete().eq('user_id', uid).eq('date', today),
    ])
    console.log('dev switch delete result:', { uid, today, attendance: e1, pending_approvals: e2, hour_reports: e3 })
    // Step 3: clear any localStorage draft keys for this user
    localStorage.removeItem(`arrival_${uid}_${today}`)
    localStorage.removeItem(`departure_${uid}_${today}`)
    // Step 4: navigate to the correct page for the switched user's role
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', uid).single()
    window.location.href = profile?.role === 'employee' ? '/tasks' : '/פרויקטים'
  }

  useEffect(() => {
    const init = async (session) => {
      if (!session?.user) return
      const uid = session.user.id
      setUserId(uid)

      const { data: profile } = await supabase
        .from('profiles').select('first_name, role').eq('id', uid).single()
      if (profile?.first_name) setFirstName(profile.first_name)
      if (profile?.role) setRole(profile.role)

      // Check today's arrival from pending_approvals (draft) or attendance (approved)
      const [{ data: todayPending }, { data: todayAtt }] = await Promise.all([
        supabase.from('pending_approvals').select('arrival_time').eq('user_id', uid).eq('date', todayStr()).maybeSingle(),
        supabase.from('attendance').select('arrival_time').eq('user_id', uid).eq('date', todayStr()).maybeSingle(),
      ])
      if (todayPending?.arrival_time || todayAtt?.arrival_time) {
        setArrived(true)
      }
    }

    // onAuthStateChange fires with INITIAL_SESSION once the persisted
    // session is loaded from storage — avoids the race condition where
    // getSession() returns null if called before the client has initialised.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      init(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleAttendance = async () => {
    if (!userId) return
    const hhmm = nowHHMM()

    if (!arrived) {
      // הגעתי — insert or update pending_approvals with arrival_time
      const { data: existing } = await supabase
        .from('pending_approvals')
        .select('id')
        .eq('user_id', userId)
        .eq('date', todayStr())
        .maybeSingle()

      if (existing) {
        await supabase.from('pending_approvals')
          .update({ arrival_time: hhmm, day_type: 'work', status: 'pending' })
          .eq('id', existing.id)
      } else {
        await supabase.from('pending_approvals')
          .insert([{ user_id: userId, date: todayStr(), arrival_time: hhmm, day_type: 'work', status: 'pending', work_from_home: false }])
      }

      localStorage.setItem('arrival_time_today', hhmm)
      setArrived(true)
      // Notify Hours.jsx to pre-populate the arrival field
      window.dispatchEvent(new CustomEvent('hours-attendance-updated', {
        detail: { type: 'arrival', time: hhmm },
      }))
    } else {
      // יצאתי — update departure_time in pending_approvals
      await supabase.from('pending_approvals')
        .update({ departure_time: hhmm })
        .eq('user_id', userId)
        .eq('date', todayStr())

      localStorage.setItem('departure_time_today', hhmm)
      // Notify Hours.jsx to pre-populate the departure field
      window.dispatchEvent(new CustomEvent('hours-attendance-updated', {
        detail: { type: 'departure', time: hhmm },
      }))

      // Navigate to hours page and open the entry tab
      navigate('/hours', { state: { openTab: 'entry' } })
    }
  }

  return (
    <div>
    {/* DEV ONLY — localhost only */}
    {window.location.hostname === 'localhost' && (
      <div className="dev-switcher" dir="rtl">
        <span className="dev-switcher-label">DEV — החלף משתמש:</span>
        {DEV_USERS.map(u => (
          <button
            key={u.label}
            className="dev-switcher-btn"
            onClick={() => handleDevSwitch(u.email, u.password)}
          >
            {u.label}
          </button>
        ))}
      </div>
    )}
    <header className="site-header" dir="rtl">

      {/* Logo — LEFT */}
      <NavLink to="/dashboard">
        <img src="/logo.png" alt="Studio Batim Logo" className="header-logo" />
      </NavLink>

      {/* Right group: [שלום עינב] [הגעתי] | [nav links] */}
      <div className="header-controls">

        {/* User greeting + Attendance — rightmost */}
        <div className="header-user-attendance">
          {firstName && (
            <span className="user-greeting">שלום, {firstName}</span>
          )}
          {role === 'employee' && (
            <div className="attendance-wrapper">
              <button
                className={`attendance-btn ${arrived ? 'left' : 'arrived'}`}
                onClick={handleAttendance}
              >
                {arrived ? 'יצאתי' : 'הגעתי'}
              </button>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="header-sep" />

        {/* Nav links */}
        <nav className="header-nav">
          <NavLink to="/hours" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>
            דיווח שעות
          </NavLink>
          <NavLink to="/tasks" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>
            ניהול משימות
          </NavLink>
          <NavLink to="/פרויקטים" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>
            פרויקטים
          </NavLink>
          <NavLink to="/professionals" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>
            בעלי מקצוע
          </NavLink>
          {role === 'admin' && (
            <NavLink to="/inquiries" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>פניות</NavLink>
          )}
          {role === 'admin' && (
            <NavLink to="/reports" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>דוחות</NavLink>
          )}
        </nav>

      </div>
    </header>
    </div>
  )
}

export default Header
