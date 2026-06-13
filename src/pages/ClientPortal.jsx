// src/pages/ClientPortal.jsx
//
// Client portal SHELL — the persistent top bar, the right-side slide-in
// drawer, and a content frame that swaps between sibling screens via
// internal state (no nested routes).
//
// The original "פרטי תיק" content now lives in ./client/ClientFile.jsx;
// this file holds only the layout + navigation.

import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useClient } from '../components/ClientRoute'
import ClientHome from './client/ClientHome'
import ClientFile from './client/ClientFile'
import ClientDocuments from './client/ClientDocuments'
import ClientContact from './client/ClientContact'
import ClientAccount from './client/ClientAccount'
import ClientPlaceholder from './client/ClientPlaceholder'
import './ClientPortal.css'

/* ── Hamburger icon ──────────────────────────────────────────────── */
const HamburgerIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round"
       xmlns="http://www.w3.org/2000/svg">
    <line x1="3" y1="6"  x2="21" y2="6"  />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
)

/* ── Drawer menu config ──────────────────────────────────────────────
   Each item has:
     key       — internal id used for active-screen switching
     label     — Hebrew text shown in the drawer + as the screen title
     enabled   — false = grayed out, not tappable, but the wiring still
                 points to ClientPlaceholder so it's a clean one-line
                 flip to enable later.
     Component — the screen to render when this item is active.
*/
const MENU_ITEMS = [
  { key: 'home',         label: 'בית',           enabled: true,  Component: ClientHome },
  { key: 'file',         label: 'פרטי תיק',      enabled: true,  Component: ClientFile },
  { key: 'documents',    label: 'מסמכים',        enabled: true,  Component: ClientDocuments },
  { key: 'quantities',   label: 'כתב כמויות',    enabled: false, Component: ClientPlaceholder },
  { key: 'finishing',    label: 'חומרי גמר',     enabled: false, Component: ClientPlaceholder },
  { key: 'contractor',   label: 'מפרט לקבלן',    enabled: false, Component: ClientPlaceholder },
  { key: 'progress',     label: 'שלבי התקדמות',  enabled: false, Component: ClientPlaceholder },
  { key: 'contact',      label: 'צור קשר',       enabled: true,  Component: ClientContact },
  { key: 'account',      label: 'פרטי חשבון',    enabled: true,  Component: ClientAccount },
]

export default function ClientPortal() {
  const { first_name: ctxFirstName, project_id } = useClient()
  const [activeKey, setActiveKey]   = useState('home')   // default landing screen
  const [drawerOpen, setDrawerOpen] = useState(false)

  /* ── Live first_name from project_contacts ───────────────────────
     The client_users.first_name from useClient() is a SNAPSHOT captured
     on the very first login (by link_client_on_login) and goes stale if
     the contact name is later edited. To keep the greeting and other
     display names current, look the client up live: their auth email
     matched against project_contacts.email for this project, case-
     insensitive and whitespace-trimmed — same matching rule as
     link_client_on_login uses on the server.

     Falls back silently to the snapshot if no contact matches (e.g.
     after the email was edited but client_users wasn't re-linked). */
  const [liveFirstName, setLiveFirstName] = useState(null)

  useEffect(() => {
    let cancelled = false
    const loadLive = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const rawEmail = session?.user?.email
      if (!rawEmail || !project_id) return
      const normalized = rawEmail.trim().toLowerCase()

      /* RLS already restricts project_contacts SELECT to the client's
         project, so this returns at most the few rows for this project. */
      const { data: contacts } = await supabase
        .from('project_contacts')
        .select('first_name, email')
        .eq('project_id', project_id)
        .order('id')                       /* deterministic when multiple rows match */

      if (cancelled || !contacts) return
      const match = contacts.find(c => (c.email || '').trim().toLowerCase() === normalized)
      if (match?.first_name) setLiveFirstName(match.first_name)
    }
    loadLive()
    return () => { cancelled = true }
  }, [project_id])

  const firstName = liveFirstName || ctxFirstName || ''

  const activeItem  = MENU_ITEMS.find(m => m.key === activeKey) || MENU_ITEMS[0]
  const ActiveScreen = activeItem.Component

  const handleSelect = (item) => {
    if (!item.enabled) return         // belt + suspenders alongside the disabled attr
    setActiveKey(item.key)
    setDrawerOpen(false)
  }

  return (
    <div className="cp-shell">

      {/* ── Top bar — hamburger on the right, greeting centered ── */}
      <header className="cp-topbar">
        <button
          type="button"
          className="cp-hamburger"
          onClick={() => setDrawerOpen(o => !o)}
          aria-label={drawerOpen ? 'סגור תפריט' : 'פתח תפריט'}
        >
          <HamburgerIcon />
        </button>
        <div className="cp-greeting">הי, {firstName}</div>
      </header>

      {/* ── Drawer overlay (closes drawer on tap) ── */}
      <div
        className={`cp-drawer-overlay${drawerOpen ? ' cp-drawer-overlay--open' : ''}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden={!drawerOpen}
      />

      {/* ── Drawer ── */}
      <aside
        className={`cp-drawer${drawerOpen ? ' cp-drawer--open' : ''}`}
        aria-hidden={!drawerOpen}
      >
        <nav className="cp-drawer-menu">
          {MENU_ITEMS.map(item => {
            const isActive = item.key === activeKey
            const cls = [
              'cp-menu-item',
              !item.enabled && 'cp-menu-item--disabled',
              isActive      && 'cp-menu-item--active',
            ].filter(Boolean).join(' ')
            return (
              <button
                key={item.key}
                type="button"
                className={cls}
                onClick={() => handleSelect(item)}
                disabled={!item.enabled}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* ── Content frame — renders the currently selected screen.
            firstName is the live name (or snapshot fallback). Screens
            that don't need it simply ignore the prop. ── */}
      <main className="cp-content">
        <ActiveScreen title={activeItem.label} firstName={firstName} />
      </main>

    </div>
  )
}
