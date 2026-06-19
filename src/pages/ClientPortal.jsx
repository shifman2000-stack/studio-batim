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
import ClientSharedFiles from './client/ClientSharedFiles'
import ClientQuantities from './client/ClientQuantities'
import ClientProgress from './client/ClientProgress'
import ClientContact from './client/ClientContact'
import ClientAccount from './client/ClientAccount'
import ClientPlaceholder from './client/ClientPlaceholder'
import ClientFooter, { ClientFooterProvider } from './client/ClientFooter'
import Logo from '../components/Logo'
import { isClientTabVisible } from '../lib/clientTabVisibility'

/* Drawer keys that are ALWAYS visible regardless of the manager's
   per-project setting. Everything else flows through isClientTabVisible. */
const ALWAYS_VISIBLE_KEYS = new Set(['home', 'contact', 'account'])
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

/* ── Generic user icon (Feather-style, stroke="currentColor") for the
   account row pinned at the drawer bottom. ── */
const IconUser = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
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
  { key: 'home',         label: 'דף בית',           enabled: true,  Component: ClientHome },
  { key: 'file',         label: 'פרטי תיק',         enabled: true,  Component: ClientFile },
  { key: 'documents',    label: 'תיק מסמכים',       enabled: true,  Component: ClientDocuments },
  { key: 'shared',       label: 'מרחב קבצים משותף', enabled: true,  Component: ClientSharedFiles },
  { key: 'quantities',   label: 'כתב כמויות',       enabled: true,  Component: ClientQuantities },
  { key: 'finishing',    label: 'חומרי גמר',        enabled: false, Component: ClientPlaceholder },
  { key: 'contractor',   label: 'מפרט לקבלן',       enabled: false, Component: ClientPlaceholder },
  { key: 'progress',     label: 'שלבי התקדמות',     enabled: true,  Component: ClientProgress },
  { key: 'contact',      label: 'צור קשר',          enabled: true,  Component: ClientContact },
  /* "פרטי חשבון" — pinned at the drawer bottom as an avatar+name row.
     Excluded from the main menu loop via the `footer: true` flag, but
     still found by MENU_ITEMS.find when activeKey === 'account'. */
  { key: 'account',      label: 'פרטי חשבון',       enabled: true,  Component: ClientAccount, footer: true },
]

export default function ClientPortal() {
  const { first_name: ctxFirstName, project_id } = useClient()
  const [activeKey, setActiveKey]   = useState('home')   // default landing screen
  const [drawerOpen, setDrawerOpen] = useState(false)

  /* ── Live identity from project_contacts ─────────────────────────
     The client_users.first_name from useClient() is a SNAPSHOT captured
     on the very first login (by link_client_on_login) and goes stale if
     the contact name is later edited. To keep the greeting and downstream
     display names current, look the client up live: their auth email
     matched against project_contacts.email for this project, case-
     insensitive and whitespace-trimmed — same matching rule as
     link_client_on_login uses on the server.

     When 2+ contacts share the same email (partners), we don't try to
     guess which one is logged in. Instead we expose `isFamily = true`
     and a representative `lastName` so the UI can switch to a family-
     scoped greeting ("שלום משפחת {lastName}").

     Falls back silently to the client_users snapshot if no contact
     matches (e.g. after the email was edited but client_users wasn't
     re-linked). */
  const [liveIdentity, setLiveIdentity] = useState(null)
  /* liveIdentity shape: { firstName, lastName, isFamily } | null */

  /* Per-project drawer visibility — projects.client_visible_tabs jsonb.
     One read on mount; resolved through isClientTabVisible(). */
  const [clientVisibleTabs, setClientVisibleTabs] = useState(null)
  useEffect(() => {
    let cancelled = false
    const loadVisibility = async () => {
      if (!project_id) return
      const { data } = await supabase
        .from('projects')
        .select('client_visible_tabs')
        .eq('id', project_id)
        .maybeSingle()
      if (cancelled) return
      setClientVisibleTabs(data?.client_visible_tabs || null)
    }
    loadVisibility()
    return () => { cancelled = true }
  }, [project_id])

  useEffect(() => {
    let cancelled = false
    const loadLive = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const rawEmail = session?.user?.email
      if (!rawEmail || !project_id) return
      const normalized = rawEmail.trim().toLowerCase()

      /* RLS already restricts project_contacts SELECT to the client's
         project, so this returns at most the few rows for this project.
         No LIMIT — we need to count matches to detect the family case. */
      const { data: contacts } = await supabase
        .from('project_contacts')
        .select('first_name, last_name, email')
        .eq('project_id', project_id)
        .order('id')                       /* deterministic when multiple rows match */

      if (cancelled || !contacts) return
      const matches = contacts.filter(c =>
        (c.email || '').trim().toLowerCase() === normalized
      )
      if (matches.length === 0) return    /* fall back to ctxFirstName */

      /* first_name: from the first matching row (used for single-contact
         greeting + for ClientAccount and any future per-person screen). */
      const firstName = (matches[0]?.first_name || '').trim() || null

      /* last_name: first matching row that HAS a non-empty trimmed
         last_name. Used as the family name when isFamily is true. */
      let lastName = null
      for (const m of matches) {
        const ln = (m.last_name ?? '').trim()
        if (ln !== '') { lastName = ln; break }
      }

      const isFamily = matches.length >= 2
      setLiveIdentity({ firstName, lastName, isFamily })
    }
    loadLive()
    return () => { cancelled = true }
  }, [project_id])

  const firstName = liveIdentity?.firstName || ctxFirstName || ''
  const lastName  = liveIdentity?.lastName  || null
  const isFamily  = liveIdentity?.isFamily  || false

  /* Drawer visibility filter — `home`, `contact`, `account` are pinned
     (always visible); every other item is gated by the per-project
     `client_visible_tabs` from the manager, resolved via the shared
     helper so client and manager agree. */
  const isItemVisible = (item) =>
    ALWAYS_VISIBLE_KEYS.has(item.key) || isClientTabVisible(item.key, clientVisibleTabs)

  const activeItem  = MENU_ITEMS.find(m => m.key === activeKey) || MENU_ITEMS[0]
  const ActiveScreen = activeItem.Component

  const handleSelect = (item) => {
    if (!item.enabled) return         // belt + suspenders alongside the disabled attr
    setActiveKey(item.key)
    setDrawerOpen(false)
  }

  return (
    <ClientFooterProvider>
    <div className="cp-shell">

      {/* ── Top bar — hamburger on the right, studio logo centered ──
          The logo here REUSES the shared <Logo /> component (same fonts,
          weights, letter-spacing, divider gradient). It is wrapped in a
          fixed-width scaler that scales the original markup via CSS
          transform so all parts (סטודיו בתים + divider + BY EINAV SHIFMAN)
          stay intact and proportional, just sized down to fit the topbar
          height. The greeting that used to live here moved into the home
          screen body. */}
      <header className="cp-topbar">
        <button
          type="button"
          className="cp-hamburger"
          onClick={() => setDrawerOpen(o => !o)}
          aria-label={drawerOpen ? 'סגור תפריט' : 'פתח תפריט'}
        >
          <HamburgerIcon />
        </button>
        <div className="cp-topbar-logo" aria-label="סטודיו בתים">
          <Logo />
        </div>
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
          {MENU_ITEMS.filter(item => !item.footer && isItemVisible(item)).map(item => {
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

        {/* ── Account footer row, pinned at the drawer bottom.
              Generic user avatar + the client's name. Clicking selects
              the 'account' screen exactly like a normal drawer item. ── */}
        {(() => {
          const accountItem = MENU_ITEMS.find(m => m.key === 'account')
          if (!accountItem) return null
          const isActive    = activeKey === 'account'
          const displayName = [firstName, lastName].filter(Boolean).join(' ').trim()
                              || 'פרטי חשבון'
          return (
            <button
              type="button"
              className={'cp-drawer-account' + (isActive ? ' cp-drawer-account--active' : '')}
              onClick={() => handleSelect(accountItem)}
              aria-label={`פרטי חשבון — ${displayName}`}
            >
              <span className="cp-drawer-account-avatar">
                <IconUser size={20} />
              </span>
              <span className="cp-drawer-account-name">{displayName}</span>
            </button>
          )
        })()}
      </aside>

      {/* ── Content frame — renders the currently selected screen.
            firstName is the live name (or snapshot fallback); lastName +
            isFamily are exposed so screens like Home can switch to a
            family-scoped greeting. Screens that don't need them ignore
            the props. ── */}
      <main className="cp-content">
        <ActiveScreen
          title={activeItem.label}
          firstName={firstName}
          lastName={lastName}
          isFamily={isFamily}
        />
      </main>

      {/* ── Sticky contact footer (Phone / WhatsApp / Email) ──
          Lives as a flex-shrink:0 sibling of <main>, so .cp-content
          (the scroll container) is pushed up and the footer doesn't
          cover content. Hidden in screens that own a competing fixed
          bottom bar — see ClientFooterProvider + useClientFooter. */}
      <ClientFooter />

    </div>
    </ClientFooterProvider>
  )
}
