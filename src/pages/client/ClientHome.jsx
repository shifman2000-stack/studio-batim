// src/pages/client/ClientHome.jsx
//
// "בית" — the default landing screen for /client.
// Reuses the existing <Logo /> lockup (סטודיו בתים + BY EINAV SHIFMAN
// + the brand divider) from src/components/Logo.jsx so the welcome
// screen is visually identical to the app's header.
//
// Two-line message below the logo:
//   1. greeting + welcome — Heebo, prominent, charcoal
//   2. softer description  — Heebo lighter, warm-gray
//
// firstName comes in as a prop from ClientPortal (live name from
// project_contacts) with a fallback to the useClient() snapshot.

import { useClient } from '../../components/ClientRoute'
import Logo from '../../components/Logo'

export default function ClientHome({ firstName }) {
  const { first_name: ctxFirstName } = useClient()
  const displayName = firstName || ctxFirstName || ''

  return (
    <div className="cp-home">
      <div className="cp-home-content">

        {/* Studio logo lockup — reused from <Logo /> for visual identity. */}
        <div className="cp-home-logo-wrap">
          <Logo />
        </div>

        {/* Combined greeting + welcome. */}
        <p className="cp-home-greeting">
          הי {displayName}, ברוך הבא למרחב המשותף שלנו
        </p>

        {/* Softer line — explains what the space is for. */}
        <p className="cp-home-subtagline">
          כאן נוכל לעקוב ביחד אחר הפרויקט ולשתף קבצים
        </p>

      </div>
    </div>
  )
}
