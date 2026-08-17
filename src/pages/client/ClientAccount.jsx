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
  const { first_name: ctxFirstName, previewMode } = useClient()
  const displayName = firstName || ctxFirstName || '—'

  /* previewMode (admin's "תצוגת לקוח" — see ClientPreviewOverlay.jsx):
     supabase.auth.signOut() is already a no-op under preview (see the
     guard in supabaseClient.js), but this handler navigates regardless
     of that call's result — left unchecked it would still yank the
     admin out of their own app to the login screen. Short-circuit the
     whole handler here since a transport-level guard alone can't stop
     a local navigate() call. */
  const handleLogout = async () => {
    if (previewMode) return
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
