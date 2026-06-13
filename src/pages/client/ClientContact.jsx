// src/pages/client/ClientContact.jsx
//
// "צור קשר" screen — Studio Batim's contact details, each tappable.
// - Phone     → tel: link
// - WhatsApp  → https://wa.me/972... (IL international, leading 0 dropped, 972 prepended)
// - Email     → mailto: link
//
// Reuses the shared inline "label: value" row styling. Values are LTR
// formatted via dir="ltr" so digits and the @ in the email don't get
// reordered by the surrounding RTL paragraph.

const PHONE          = '0529593927'
const PHONE_DISPLAY  = '052-959-3927'
const WHATSAPP_URL   = 'https://wa.me/972529593927'
const EMAIL          = 'einav.studiob@gmail.com'

export default function ClientContact() {
  return (
    <div className="cp-page">
      <div className="cp-container">

        <h1 className="cp-screen-title">צור קשר</h1>

        <section className="cp-card">
          <div className="cp-row">
            <span className="cp-label">טלפון:</span>
            <a
              className="cp-value cp-link"
              href={`tel:${PHONE}`}
              dir="ltr"
            >
              {PHONE_DISPLAY}
            </a>
          </div>

          <div className="cp-row">
            <span className="cp-label">וואטסאפ:</span>
            <a
              className="cp-value cp-link"
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
            >
              {PHONE_DISPLAY}
            </a>
          </div>

          <div className="cp-row">
            <span className="cp-label">אימייל:</span>
            <a
              className="cp-value cp-link"
              href={`mailto:${EMAIL}`}
              dir="ltr"
            >
              {EMAIL}
            </a>
          </div>
        </section>

      </div>
    </div>
  )
}
