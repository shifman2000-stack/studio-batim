import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import Logo from './components/Logo'
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

  // Departure summary modal (all environments)
  const [departureModalOpen,  setDepartureModalOpen]  = useState(false)
  const [departureModalTimes, setDepartureModalTimes] = useState({ arrival: '', departure: '' })

  // DEV ONLY ────────────────────────────────────────────────────────────────
  const [devArrivalModalOpen, setDevArrivalModalOpen] = useState(false)
  const [devArrivalTime,      setDevArrivalTime]      = useState('09:00')
  const [devClearConfirmOpen, setDevClearConfirmOpen] = useState(false)
  // ─────────────────────────────────────────────────────────────────────────

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

  // Departure summary modal — dismiss and navigate ────────────────────────
  const handleDepartureModalConfirm = () => {
    setDepartureModalOpen(false)
    setArrived(false)
    navigate('/hours', { state: { openTab: 'entry' } })
  }
  // ─────────────────────────────────────────────────────────────────────────

  // DEV ONLY — confirm custom arrival time and save as if הגעתי was clicked ──
  const handleDevArrivalConfirm = async () => {
    const hhmm = devArrivalTime
    setDevArrivalModalOpen(false)
    if (!userId || !hhmm) return

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
    window.dispatchEvent(new CustomEvent('hours-attendance-updated', {
      detail: { type: 'arrival', time: hhmm },
    }))
  }

  // DEV ONLY — wipe all today's attendance data for the active user ─────────
  const handleDevClearToday = async () => {
    const today = todayStr()
    await Promise.all([
      supabase.from('attendance')       .delete().eq('user_id', userId).eq('date', today),
      supabase.from('pending_approvals').delete().eq('user_id', userId).eq('date', today),
      supabase.from('hour_reports')     .delete().eq('user_id', userId).eq('date', today),
    ])
    localStorage.removeItem('arrival_time_today')
    localStorage.removeItem('departure_time_today')
    setArrived(false)
    setDevClearConfirmOpen(false)
    window.location.reload()
  }
  // ─────────────────────────────────────────────────────────────────────────

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
      // DEV ONLY: open the custom-time modal instead of using real clock ────
      if (import.meta.env.DEV) {
        setDevArrivalTime('09:00')
        setDevArrivalModalOpen(true)
        return
      }
      // ─────────────────────────────────────────────────────────────────────
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

      // Show departure summary modal; navigation happens in handleDepartureModalConfirm
      const arrivalTime = localStorage.getItem('arrival_time_today') || ''
      setDepartureModalTimes({ arrival: arrivalTime, departure: hhmm })
      setDepartureModalOpen(true)
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
        {/* DEV ONLY — clear today's attendance */}
        <span style={{ width: 1, height: 14, background: '#ca8a04', display: 'inline-block', margin: '0 4px', flexShrink: 0 }} />
        <button
          className="dev-switcher-btn"
          style={{ background: '#b45309', color: '#fff' }}
          onClick={() => setDevClearConfirmOpen(true)}
        >
          נקה נוכחות היום
        </button>
      </div>
    )}
    <header className="site-header" dir="rtl">

      {/* Logo — LEFT */}
      <NavLink to="/dashboard" style={{ textDecoration: 'none' }}>
        <Logo />
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
        <span style={{ display: 'block', width: '1px', height: '28px', flexShrink: 0, background: 'linear-gradient(to bottom, transparent, #c8bfb0 25%, #c8bfb0 75%, transparent)', margin: '0 16px' }} />

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

    {/* Departure summary modal (all environments) ──────────────────────── */}
    {departureModalOpen && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#f7f5f2',
          border: '1px solid rgba(26,26,24,0.10)',
          borderRadius: 6,
          boxShadow: '0 8px 32px rgba(0,0,0,0.16)',
          padding: '40px 44px',
          maxWidth: 420,
          width: '90vw',
          fontFamily: "'Heebo', sans-serif",
          direction: 'rtl',
        }}>
          <p style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 24, fontWeight: 400, color: '#1a1a18',
            margin: '0 0 14px',
          }}>
            {firstName ? `הי ${firstName},` : 'הי,'}
          </p>
          <p style={{
            fontWeight: 300, fontSize: 14, color: '#4a4a48',
            lineHeight: 1.8, margin: '0 0 36px',
          }}>
            שעות הנוכחות שנרשמו לך היום הן{' '}
            מ-{departureModalTimes.arrival || '—'} עד {departureModalTimes.departure || '—'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              className="header-departure-confirm-btn"
              onClick={handleDepartureModalConfirm}
            >
              אישור
            </button>
          </div>
        </div>
      </div>
    )}

    {/* DEV ONLY — custom arrival time modal ───────────────────────────── */}
    {import.meta.env.DEV && devArrivalModalOpen && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#f7f5f2', border: '1px solid rgba(26,26,24,0.13)',
          padding: '28px 32px', maxWidth: 360, width: '90vw',
          fontFamily: "'Heebo', sans-serif", direction: 'rtl',
        }}>
          <p style={{ fontWeight: 400, fontSize: 14, color: '#1a1a18', margin: '0 0 4px' }}>
            DEV — בחר שעת הגעה
          </p>
          <p style={{ fontWeight: 300, fontSize: 12, color: '#8a8680', margin: '0 0 20px' }}>
            הזמן שיוזן יישמר כשעת הגעה במקום השעה הנוכחית
          </p>
          <input
            type="time"
            value={devArrivalTime}
            onChange={e => setDevArrivalTime(e.target.value)}
            style={{
              border: 'none', borderBottom: '1px solid rgba(26,26,24,0.3)',
              background: 'transparent', padding: '4px 2px',
              fontFamily: "'Heebo', sans-serif", fontSize: 22,
              color: '#1a1a18', direction: 'ltr', outline: 'none',
              marginBottom: 24, display: 'block',
            }}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
            <button
              onClick={() => setDevArrivalModalOpen(false)}
              style={{
                background: 'transparent', color: '#1a1a18',
                border: '1px solid rgba(26,26,24,0.22)',
                padding: '8px 20px', fontFamily: "'Heebo', sans-serif",
                fontWeight: 300, fontSize: 12, letterSpacing: '0.1em',
                borderRadius: 0, cursor: 'pointer',
              }}
            >ביטול</button>
            <button
              onClick={handleDevArrivalConfirm}
              style={{
                background: '#1a1a18', color: '#f7f5f2',
                border: '1px solid #1a1a18',
                padding: '8px 20px', fontFamily: "'Heebo', sans-serif",
                fontWeight: 300, fontSize: 12, letterSpacing: '0.1em',
                borderRadius: 0, cursor: 'pointer',
              }}
            >אישור</button>
          </div>
        </div>
      </div>
    )}

    {/* DEV ONLY — clear today confirmation modal ──────────────────────── */}
    {import.meta.env.DEV && devClearConfirmOpen && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          background: '#f7f5f2', border: '1px solid rgba(26,26,24,0.13)',
          padding: '28px 32px', maxWidth: 400, width: '90vw',
          fontFamily: "'Heebo', sans-serif", direction: 'rtl',
        }}>
          <p style={{ fontWeight: 400, fontSize: 14, color: '#1a1a18', margin: '0 0 12px' }}>
            למחוק את כל הנוכחות של היום עבור המשתמש הפעיל?
          </p>
          <p style={{ fontWeight: 300, fontSize: 12, color: '#8a8680', margin: '0 0 24px', lineHeight: 1.6 }}>
            ימחקו שורות מ-attendance, hour_reports ו-pending_approvals לתאריך היום. הדף יירענן לאחר המחיקה.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
            <button
              onClick={() => setDevClearConfirmOpen(false)}
              style={{
                background: 'transparent', color: '#1a1a18',
                border: '1px solid rgba(26,26,24,0.22)',
                padding: '8px 20px', fontFamily: "'Heebo', sans-serif",
                fontWeight: 300, fontSize: 12, letterSpacing: '0.1em',
                borderRadius: 0, cursor: 'pointer',
              }}
            >ביטול</button>
            <button
              onClick={handleDevClearToday}
              style={{
                background: '#1a1a18', color: '#f7f5f2',
                border: '1px solid #1a1a18',
                padding: '8px 20px', fontFamily: "'Heebo', sans-serif",
                fontWeight: 300, fontSize: 12, letterSpacing: '0.1em',
                borderRadius: 0, cursor: 'pointer',
              }}
            >אישור</button>
          </div>
        </div>
      </div>
    )}
    {/* ──────────────────────────────────────────────────────────────────── */}

    </div>
  )
}

export default Header
