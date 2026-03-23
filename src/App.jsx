import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import './App.css'

// ── Eye SVG icons ──
const EyeOpen = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)

const EyeClosed = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

// ── Password input with eye toggle ──
function PasswordInput({ value, onChange, required }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="password-wrapper">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required={required}
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

function App() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')

  // Login fields
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Register fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('')
  const [authCode, setAuthCode] = useState('')

  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [loading, setLoading] = useState(false)

  // ── LOGIN ──
  const handleLogin = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    })

    setLoading(false)

    if (error) {
      setErrorMsg('אימייל או סיסמה שגויים')
    } else {
      navigate('/dashboard')
    }
  }

  // ── REGISTER ──
  const handleRegister = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    setSuccessMsg('')

    if (regPassword !== regPasswordConfirm) {
      setErrorMsg('הסיסמאות אינן תואמות')
      return
    }

    setLoading(true)

    // 1. Check authorization code
    const { data: codeData, error: codeError } = await supabase
      .from('authorization_codes')
      .select('role')
      .eq('code', authCode)
      .single()

    if (codeError || !codeData) {
      setErrorMsg('קוד הרשאה שגוי')
      setLoading(false)
      return
    }

    const role = codeData.role

    // 2. Create user
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: regEmail,
      password: regPassword,
    })

    if (signUpError) {
      setErrorMsg('שגיאה ביצירת המשתמש: ' + signUpError.message)
      setLoading(false)
      return
    }

    const userId = signUpData.user?.id

    // 3. Insert into profiles
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: userId, first_name: firstName, last_name: lastName, role })

    setLoading(false)

    if (profileError) {
      setErrorMsg('שגיאה בשמירת הפרופיל')
      return
    }

    setSuccessMsg('נרשמת בהצלחה! כעת תוכל להתחבר')
    setMode('login')
  }

  const switchToRegister = () => { setErrorMsg(''); setSuccessMsg(''); setMode('register') }
  const switchToLogin    = () => { setErrorMsg(''); setSuccessMsg(''); setMode('login') }

  return (
    <div className="login-page">
      <img src="/logo.png" alt="Studio Batim Logo" className="login-logo" />

      <div className="login-box" dir="rtl">

        {/* ── LOGIN FORM ── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin}>
            <div className="field-group">
              <label>אימייל</label>
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>סיסמה</label>
              <PasswordInput
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                required
              />
            </div>

            {errorMsg && <p className="auth-error">{errorMsg}</p>}
            {successMsg && <p className="auth-success">{successMsg}</p>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'מתחבר...' : 'כניסה'}
            </button>

            <p className="auth-switch">
              משתמש חדש?{' '}
              <button type="button" className="auth-link" onClick={switchToRegister}>
                הרשמה
              </button>
            </p>
          </form>
        )}

        {/* ── REGISTER FORM ── */}
        {mode === 'register' && (
          <form onSubmit={handleRegister}>
            <div className="field-group">
              <label>שם פרטי</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>שם משפחה</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>אימייל</label>
              <input
                type="email"
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>סיסמה</label>
              <PasswordInput
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>אימות סיסמה</label>
              <PasswordInput
                value={regPasswordConfirm}
                onChange={(e) => setRegPasswordConfirm(e.target.value)}
                required
              />
            </div>

            <div className="field-group">
              <label>קוד הרשאה</label>
              <input
                type="text"
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                required
              />
            </div>

            {errorMsg && <p className="auth-error">{errorMsg}</p>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'נרשם...' : 'הרשמה'}
            </button>

            <p className="auth-switch">
              יש לך חשבון?{' '}
              <button type="button" className="auth-link" onClick={switchToLogin}>
                כניסה
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

export default App
