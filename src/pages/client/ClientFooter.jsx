// src/pages/client/ClientFooter.jsx
//
// Sticky bottom action bar for the client portal — three contact
// shortcuts (Phone / WhatsApp / Email) that point to the SAME endpoints
// as the ClientContact ("צור קשר") screen via the shared contactInfo
// module. Renders on every portal screen.
//
// Visibility is controlled via a tiny React context so individual
// screens can hide the footer when they own a competing fixed-bottom
// UI element. Today the only consumer of that hide signal is
// ClientFile's edit mode (which renders the .cp-edit-bar save/cancel
// strip at the same screen edge).
//
// The context ALSO carries the per-project whatsapp_group_url (or null).
// When set, the WhatsApp button opens that group invite link instead of
// the default wa.me link to Einav's number. When null / empty /
// undefined / the DB column is missing entirely, the button falls back
// to WHATSAPP_URL unchanged.
//
// Provider lives at the portal shell (ClientPortal.jsx passes the value
// in); useClientFooter() exposes both the visibility setter and the
// link to any descendant.

import { createContext, useCallback, useContext, useState } from 'react'
import { PHONE, WHATSAPP_URL, EMAIL } from './contactInfo'

const FooterContext = createContext({
  hidden: false,
  setHidden: () => {},
  whatsappGroupUrl: null,
})

export function useClientFooter() {
  return useContext(FooterContext)
}

export function ClientFooterProvider({ children, whatsappGroupUrl = null }) {
  const [hidden, setHiddenState] = useState(false)
  const setHidden = useCallback((v) => setHiddenState(!!v), [])
  return (
    <FooterContext.Provider value={{ hidden, setHidden, whatsappGroupUrl }}>
      {children}
    </FooterContext.Provider>
  )
}

/* ── Feather-style outline icons (stroke="currentColor") ─────────────
   Matched to the portal's existing inline-SVG icon style (IconTrash,
   IconChevron, IconPencil). The "WhatsApp" icon is drawn as an outline
   speech bubble — no brand fill, no #25D366 — so all three icons share
   the same stroke-only treatment and inherit color from CSS. ── */

const IconPhone = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
  </svg>
)

const IconWhatsApp = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* Outer speech bubble with tail (Feather message-circle silhouette) */}
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    {/* Phone-handset glyph hint inside the bubble */}
    <path d="M9.5 9.2c0 2.9 2.4 5.3 5.3 5.3l.9-1.2 1.8.8c0 .9-.7 1.4-1.7 1.4-3.1 0-6.2-3.1-6.2-6.2 0-1 .5-1.7 1.4-1.7l.8 1.8-1.2.9z"/>
  </svg>
)

const IconMail = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22 6 12 13 2 6"/>
  </svg>
)

export default function ClientFooter() {
  const { hidden, whatsappGroupUrl } = useClientFooter()
  if (hidden) return null

  /* WhatsApp button href:
       * if the project has a non-empty whatsapp_group_url → use it
         (opens the group invite in chat.whatsapp.com);
       * otherwise → fall back to WHATSAPP_URL (the default wa.me link
         to Einav's number, exactly the pre-existing behaviour).
     `whatsappGroupUrl` may be null / undefined (column not yet on prod
     / no value set) or a string with surrounding whitespace; the
     `|| ''` + `.trim()` chain handles all of those without throwing. */
  const groupUrl     = (whatsappGroupUrl || '').trim()
  const whatsappHref = groupUrl ? groupUrl : WHATSAPP_URL

  return (
    <footer className="cp-footer" dir="rtl">
      <a
        className="cp-footer-link"
        href={`tel:${PHONE}`}
        aria-label="התקשרי לטלפון"
      >
        <IconPhone />
        <span>טלפון</span>
      </a>
      <a
        className="cp-footer-link"
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="פתח שיחת WhatsApp"
      >
        <IconWhatsApp />
        <span>וואטסאפ</span>
      </a>
      <a
        className="cp-footer-link"
        href={`mailto:${EMAIL}`}
        aria-label="שליחת מייל"
      >
        <IconMail />
        <span>מייל</span>
      </a>
    </footer>
  )
}
