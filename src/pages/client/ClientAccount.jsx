// src/pages/client/ClientAccount.jsx
//
// "פרטי חשבון" screen — shows the client's first_name and is the ONLY
// place where the logout button lives now. (Logout was removed from
// the top of the פרטי תיק screen.)
//
// firstName comes in as a prop from ClientPortal, which fetches it
// LIVE from project_contacts on mount (matching the authenticated
// email). If the prop is missing for any reason, fall back to the
// client_users snapshot via useClient() so the screen never breaks.

import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'

export default function ClientAccount({ firstName }) {
  const navigate = useNavigate()
  const { first_name: ctxFirstName } = useClient()
  const displayName = firstName || ctxFirstName || '—'

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="cp-page">
      <div className="cp-container">

        <h1 className="cp-screen-title">פרטי חשבון</h1>

        <section className="cp-card">
          <div className="cp-row">
            <span className="cp-label">שם:</span>
            <span className="cp-value">{displayName}</span>
          </div>
        </section>

        <button className="cp-account-logout-btn" onClick={handleLogout}>
          התנתקות
        </button>

      </div>
    </div>
  )
}
