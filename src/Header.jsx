import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { supabase } from './supabaseClient'
import './Header.css'

function Header() {
  const [arrived, setArrived] = useState(false)
  const [time, setTime] = useState(null)
  const [firstName, setFirstName] = useState('')

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      const { data } = await supabase
        .from('profiles')
        .select('first_name')
        .eq('id', session.user.id)
        .single()
      if (data?.first_name) setFirstName(data.first_name)
    }
    fetchUser()
  }, [])

  const handleAttendance = () => {
    const now = new Date()
    const formatted = now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    setTime(formatted)
    setArrived(prev => !prev)
  }

  return (
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
          <div className="attendance-wrapper">
            <button
              className={`attendance-btn ${arrived ? 'arrived' : 'left'}`}
              onClick={handleAttendance}
            >
              {arrived ? 'הגעתי' : 'יצאתי'}
            </button>
            {time && <span className="attendance-time">{time}</span>}
          </div>
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
          <NavLink to="/projects" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>
            ניהול פרויקטים
          </NavLink>
          <NavLink to="/פרויקטים" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>
            פרויקטים
          </NavLink>
          <NavLink to="/professionals" className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}>
            בעלי מקצוע
          </NavLink>
        </nav>

      </div>
    </header>
  )
}

export default Header
