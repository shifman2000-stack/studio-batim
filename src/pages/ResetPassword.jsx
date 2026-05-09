// src/pages/ResetPassword.jsx
// Handles the password-reset redirect from Supabase email link.
// URL contains the recovery token; Supabase JS detects it automatically
// (detectSessionInUrl is true by default) and fires PASSWORD_RECOVERY.
//
// Route: /reset-password

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import logoUrl from '../logo-A-stacked.svg'
import '../App.css'

// ── Eye SVG icons (same as App.jsx) ──────────────────────────────────────────
const EyeOpen = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="#C1BCAF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

const EyeClosed = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="#C1BCAF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

function PasswordInput({ value, onChange, required, placeholder }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="password-wrapper">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        className="password-input"
      />
      <button
        type="button"
        className="eye-toggle"
        onClick={() => setVisible(v => !v)}
        tabIndex={-1}
        aria-label={visible ? 'הסתר סיסמה' : 'הצג סיסמה'}
      >
        {visible ? <EyeOpen /> : <EyeClosed />}
      </button>
    </div>
  )
}

export default function ResetPassword() {
  const navigate = useNavigate()

  const [ready,      setReady]      = useState(false)   // true once PASSWORD_RECOVERY fires
  const [password,   setPassword]   = useState('')
  const [confirm,    setConfirm]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [errorMsg,   setErrorMsg]   = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Supabase detects the #access_token fragment in the URL and fires
  // PASSWORD_RECOVERY via onAuthStateChange.  We wait for that event before
  // showing the form so the session is active when we call updateUser().
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (password !== confirm) {
      setErrorMsg('הסיסמאות אינן תואמות')
      return
    }
    if (password.length < 6) {
      setErrorMsg('הסיסמה חייבת להכיל לפחות 6 תווים')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setErrorMsg('שגיאה בעדכון הסיסמה. נסי שוב.')
    } else {
      setSuccessMsg('הסיסמה עודכנה בהצלחה! מעביר לדף הכניסה...')
      setTimeout(() => navigate('/'), 2000)
    }
  }

  return (
    <div className="login-page">
      <img src={logoUrl} alt="סטודיו בתים" style={{ height: '80px', width: 'auto', background: 'transparent' }} />

      <div className="login-box" dir="rtl">

        {!ready ? (
          /* Waiting for the recovery token to be detected */
          <p style={{
            fontFamily: "'Heebo', sans-serif",
            fontWeight: 300,
            fontSize: 14,
            color: '#4a4a48',
            textAlign: 'center',
            margin: 0,
          }}>
            טוען...
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{
              fontFamily: "'Heebo', sans-serif",
              fontWeight: 300,
              fontSize: 14,
              color: '#4a4a48',
              lineHeight: 1.7,
              margin: '0 0 20px',
            }}>
              בחרי סיסמה חדשה לחשבונך.
            </p>

            <div className="field-group">
              <label>סיסמה חדשה</label>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>אימות סיסמה</label>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>

            {errorMsg   && <p className="auth-error">{errorMsg}</p>}
            {successMsg && <p className="auth-success">{successMsg}</p>}

            <button type="submit" className="login-btn" disabled={loading || !!successMsg}>
              {loading ? 'שומר...' : 'עדכון סיסמה'}
            </button>
          </form>
        )}

      </div>
    </div>
  )
}
