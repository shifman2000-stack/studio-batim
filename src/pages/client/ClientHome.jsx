// src/pages/client/ClientHome.jsx
//
// "בית" — the default landing screen for /client.
// Airy, centered composition: studio logo + greeting + softer description.
// No buttons. The only way off this screen is the drawer menu.
//
// Greeting selection (single source of truth — ClientPortal computes the
// live identity from project_contacts and passes it down via props; the
// top bar uses the SAME logic):
//
//   isFamily && lastName  →  "ברוכים הבאים משפחת {lastName}"
//   isFamily && !lastName →  "ברוכים הבאים"
//   single contact        →  "הי {firstName}, ברוך הבא למרחב המשותף שלנו"
//
// firstName falls back to the useClient() snapshot if the live lookup
// returned nothing.

import { useClient } from '../../components/ClientRoute'

export default function ClientHome({ firstName, lastName, isFamily }) {
  const { first_name: ctxFirstName } = useClient()
  const displayName = firstName || ctxFirstName || ''

  let greeting
  if (isFamily) {
    greeting = lastName
      ? `ברוכים הבאים משפחת ${lastName}`
      : 'ברוכים הבאים'
  } else {
    greeting = `הי ${displayName}, ברוך הבא למרחב המשותף שלנו`
  }

  return (
    <div className="cp-home">
      <div className="cp-home-content">

        {/* Greeting — single line (single contact) or family welcome.
            The studio logo lockup that used to sit above this line now
            lives in the portal top bar (see ClientPortal.jsx). */}
        <p className="cp-home-greeting">{greeting}</p>

        {/* Softer line — explains what the space is for. Unchanged in
            both single and family modes. */}
        <p className="cp-home-subtagline">
          כאן נוכל לעקוב ביחד אחר הפרויקט ולשתף קבצים
        </p>

      </div>
    </div>
  )
}
