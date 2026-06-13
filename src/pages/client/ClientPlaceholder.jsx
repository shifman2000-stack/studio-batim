// src/pages/client/ClientPlaceholder.jsx
//
// Generic "המסך בפיתוח" screen. Wired into the drawer for the five
// not-yet-built items so when they eventually become enabled the
// switching just works. Receives the screen's title via prop so the
// header reads correctly.

export default function ClientPlaceholder({ title }) {
  return (
    <div className="cp-page">
      <div className="cp-container">

        <h1 className="cp-screen-title">{title}</h1>

        <section className="cp-card cp-placeholder-card">
          <p className="cp-placeholder-msg">המסך בפיתוח</p>
        </section>

      </div>
    </div>
  )
}
