import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

export default function NoAccess() {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F7F5F2',
      fontFamily: "'Heebo', sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      direction: 'rtl',
    }}>
      <div style={{
        background: '#fff',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        padding: '48px 56px',
        textAlign: 'center',
      }}>
        <h1 style={{
          fontFamily: "'Heebo', sans-serif",
          fontWeight: 700,
          fontSize: '24px',
          color: '#1a1a18',
          margin: '0 0 10px',
        }}>
          אין לך גישה למערכת
        </h1>
        <p style={{
          fontFamily: "'Heebo', sans-serif",
          fontWeight: 300,
          fontSize: '14px',
          color: '#8a8680',
          margin: 0,
        }}>
          פנה למנהל המערכת
        </p>
      </div>

      <button
        onClick={handleLogout}
        style={{
          marginTop: '28px',
          background: 'none',
          border: '1px solid #C1BCAF',
          borderRadius: '8px',
          padding: '8px 22px',
          fontFamily: "'Heebo', sans-serif",
          fontSize: '14px',
          fontWeight: 300,
          color: '#8a8680',
          cursor: 'pointer',
          transition: 'border-color 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#a8a39a'; e.currentTarget.style.color = '#1a1a18' }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = '#C1BCAF'; e.currentTarget.style.color = '#8a8680' }}
      >
        התנתקות
      </button>
    </div>
  )
}
