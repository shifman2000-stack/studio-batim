// src/pages/ClientPortal.jsx
//
// Client portal SHELL — the persistent top bar, the right-side slide-in
// drawer, and a content frame that swaps between sibling screens via
// internal state (no nested routes).
//
// The original "פרטי תיק" content now lives in ./client/ClientFile.jsx;
// this file holds only the layout + navigation.
//
// Navigation model (PART B):
//   * Home screen shows 4 parent-group tiles (see clientPortalGroups.js).
//   * Tap a group → either jumps straight to the only child screen
//     (direct mode) or expands a sub-grid of its children (expand mode).
//   * Tap a child → navigate to that screen, REMEMBERING the group it
//     came from (currentOrigin). The screen shows a curved IconBack at
//     the top; tapping it returns to the home sub-screen of that group.
//   * Drawer mirrors the same group structure: single-child groups are
//     flat buttons, multi-child groups expand inline as an accordion.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useClient } from '../components/ClientRoute'
import ClientHome from './client/ClientHome'
import ClientFile from './client/ClientFile'
import ClientDocuments from './client/ClientDocuments'
import ClientSharedFiles from './client/ClientSharedFiles'
import ClientQuantities from './client/ClientQuantities'
import ClientFinishing from './client/ClientFinishing'
import ClientContractorSpec from './client/ClientContractorSpec'
import ClientProgress from './client/ClientProgress'
import ClientMeetings from './client/ClientMeetings'
import ClientProgrammingQuestionnaire from './client/ClientProgrammingQuestionnaire'
import ClientAccount from './client/ClientAccount'
import ClientPlaceholder from './client/ClientPlaceholder'
import ClientFooter, { ClientFooterProvider } from './client/ClientFooter'
import Logo from '../components/Logo'
import { GROUPS, resolveGroup } from '../lib/clientPortalGroups'
import { IconChevron, IconBack } from '../components/icons/PortalIcons'

/* Drawer keys that are ALWAYS visible regardless of the manager's
   per-project setting. Everything else flows through isClientTabVisible.
   PART B: 'contact' removed — that info lives in the sticky ClientFooter. */
const ALWAYS_VISIBLE_KEYS = new Set(['home', 'account'])

/* ── Navigation context — exposes navigate(key, originGroupKey=null)
   and goBack() so descendant screens (home tiles, sub-screens, content
   screens) can switch the active screen and walk back without prop-
   drilling. ── */
const ClientNavContext = createContext({ navigate: () => {}, goBack: () => {} })
export function useClientNav() {
  return useContext(ClientNavContext)
}
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
   The MAIN drawer menu is now built from GROUPS (see clientPortalGroups.js).
   MENU_ITEMS still maps each child key → the screen Component + label, so
   ActiveScreen + the drawer can resolve labels uniformly.

   Fields:
     key       — internal id used for active-screen switching
     label     — Hebrew text shown in the drawer + as the screen title
     enabled   — false = grayed out, not tappable
     Component — the screen to render when this item is active
*/
const MENU_ITEMS = [
  { key: 'home',         label: 'דף בית',           enabled: true,  Component: ClientHome },
  { key: 'file',         label: 'פרטי תיק',         enabled: true,  Component: ClientFile },
  { key: 'documents',    label: 'מעקב מסמכים',      enabled: true,  Component: ClientDocuments },
  { key: 'shared',       label: 'מרחב משותף',       enabled: true,  Component: ClientSharedFiles },
  { key: 'questionnaire',label: 'שאלון פרוגרמה',    enabled: true,  Component: ClientProgrammingQuestionnaire },
  { key: 'quantities',   label: 'כתב כמויות',       enabled: true,  Component: ClientQuantities },
  { key: 'finishing',    label: 'חומרי גמר',        enabled: true,  Component: ClientFinishing },
  { key: 'contractor',   label: 'מפרט לקבלן',       enabled: true,  Component: ClientContractorSpec },
  { key: 'progress',     label: 'שלבי התקדמות',     enabled: true,  Component: ClientProgress },
  { key: 'meetings',     label: 'סיכומי פגישות',    enabled: true,  Component: ClientMeetings },
  /* "פרטי חשבון" — pinned at the drawer bottom as an avatar+name row.
     Excluded from the main menu loop via the `footer: true` flag, but
     still found by MENU_ITEMS.find when activeKey === 'account'. */
  { key: 'account',      label: 'פרטי חשבון',       enabled: true,  Component: ClientAccount, footer: true },
]

/* Quick key → label lookup used by the drawer's group sub-items. */
const LABEL_BY_KEY = MENU_ITEMS.reduce((acc, m) => { acc[m.key] = m.label; return acc }, {})

export default function ClientPortal() {
  const { first_name: ctxFirstName, project_id } = useClient()
  const [activeKey, setActiveKey]                = useState('home')   // default landing screen
  const [drawerOpen, setDrawerOpen]              = useState(false)
  /* Group this screen was navigated FROM (or null if entered from the
     home grid / a direct group / the account footer). Drives goBack. */
  const [currentOrigin, setCurrentOrigin]        = useState(null)
  /* One-shot: when goBack lands on an expandable group, ClientHome reads
     this on its next render and opens the matching sub-screen. ClientHome
     calls clearPendingHomeGroup once consumed. */
  const [pendingHomeGroup, setPendingHomeGroup]  = useState(null)
  /* Drawer accordion state — Set of group keys currently expanded. */
  const [drawerExpanded, setDrawerExpanded]      = useState(() => new Set())

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

  /* Per-project drawer visibility — projects.client_visible_tabs jsonb —
     PLUS the optional per-project whatsapp_group_url that swaps the
     sticky-footer WhatsApp button's href when set. One combined read on
     mount, with a graceful fallback to the visibility-only SELECT if
     the whatsapp_group_url column doesn't exist yet (e.g. a prod that
     hasn't been migrated). When the column is missing OR the value is
     null/empty, whatsappGroupUrl stays null and ClientFooter falls
     back to WHATSAPP_URL (the default wa.me link). */
  const [clientVisibleTabs, setClientVisibleTabs] = useState(null)
  const [whatsappGroupUrl,  setWhatsappGroupUrl]  = useState(null)
  /* Per-project override for the programming-questionnaire tile.
     Default false — until an admin flips projects.show_programming_questionnaire
     on for this project (via the settings modal), the client doesn't
     see the tile at all. Dev-only column for now; a prod row without
     the column reads back as undefined and safely stays false. */
  const [showProgrammingQuestionnaire, setShowProgrammingQuestionnaire] = useState(false)
  useEffect(() => {
    let cancelled = false
    const loadProjectMeta = async () => {
      if (!project_id) return
      let row = null
      const tryBoth = await supabase
        .from('projects')
        .select('client_visible_tabs, whatsapp_group_url, show_programming_questionnaire')
        .eq('id', project_id)
        .maybeSingle()
      if (tryBoth.error) {
        /* Most likely: prod row, one of the new columns not yet
           migrated. Re-run the visibility-only SELECT so the rest of
           the portal keeps working; whatsapp link silently stays at
           the default and the questionnaire tile stays hidden. */
        const fallback = await supabase
          .from('projects')
          .select('client_visible_tabs')
          .eq('id', project_id)
          .maybeSingle()
        row = fallback.data || null
      } else {
        row = tryBoth.data || null
      }
      if (cancelled) return
      setClientVisibleTabs(row?.client_visible_tabs || null)
      setWhatsappGroupUrl(row?.whatsapp_group_url ?? null)
      setShowProgrammingQuestionnaire(row?.show_programming_questionnaire === true)
    }
    loadProjectMeta()
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

  /* Resolve all 4 groups once per render. Hidden groups become null. */
  const resolvedGroups = useMemo(
    () => GROUPS.map(g => ({ group: g, resolved: resolveGroup(g, clientVisibleTabs, showProgrammingQuestionnaire) })),
    [clientVisibleTabs, showProgrammingQuestionnaire]
  )

  /* ── Navigation primitives shared via context ───────────────────── */
  const navValue = useMemo(() => ({
    /* Navigate to a screen, optionally remembering which group we came
       from (so goBack() can return to the home sub-screen of that group). */
    navigate: (key, originGroupKey = null) => {
      setActiveKey(key)
      setCurrentOrigin(originGroupKey)
      setDrawerOpen(false)
      setPendingHomeGroup(null)            /* clear any stale request */
    },
    /* Walk back from the current screen:
         * if currentOrigin points to an expandable group → land on the
           home sub-screen of that group (activeKey='home' + ClientHome
           opens it from pendingHomeGroup);
         * otherwise → land on the home groups grid. */
    goBack: () => {
      let landOnGroup = null
      if (currentOrigin) {
        const g = GROUPS.find(x => x.key === currentOrigin)
        if (g) {
          const r = resolveGroup(g, clientVisibleTabs, showProgrammingQuestionnaire)
          if (r && r.mode === 'expand') landOnGroup = currentOrigin
        }
      }
      setPendingHomeGroup(landOnGroup)
      setActiveKey('home')
      setCurrentOrigin(null)
      setDrawerOpen(false)
    },
  }), [currentOrigin, clientVisibleTabs, showProgrammingQuestionnaire])

  /* Drawer accordion — toggle a group's expanded state. */
  const toggleDrawerGroup = (groupKey) => {
    setDrawerExpanded(prev => {
      const next = new Set(prev)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }

  const activeItem  = MENU_ITEMS.find(m => m.key === activeKey) || MENU_ITEMS[0]
  const ActiveScreen = activeItem.Component

  /* The floating back arrow appears on every content screen except:
       · home        — the grid itself; nothing to go back to.
       · account     — reached via the drawer footer, not group nav.
       · questionnaire — the programming module renders its OWN round
                        back-arrow (same .cp-screen-back styling) that
                        returns to the module's internal hub rather
                        than exiting via goBack(). Suppressing the
                        shared one here keeps exactly ONE back control
                        visible on those screens. */
  const showBackArrow = activeKey !== 'home' && activeKey !== 'account' && activeKey !== 'questionnaire'

  return (
    <ClientFooterProvider whatsappGroupUrl={whatsappGroupUrl}>
    <ClientNavContext.Provider value={navValue}>
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
          {/* "דף בית" — pinned at the top of the drawer above the group
              rows. Treated as a normal top-level item: navigates to the
              home screen and closes the drawer. Active highlight matches
              other .cp-menu-item rows when activeKey === 'home'. */}
          <button
            type="button"
            className={'cp-menu-item' + (activeKey === 'home' ? ' cp-menu-item--active' : '')}
            onClick={() => navValue.navigate('home', null)}
          >
            דף בית
          </button>

          {/* Group-based main menu. Each GROUPS entry → one row (direct
              button) or one accordion (header + indented sub-buttons). */}
          {resolvedGroups.map(({ group, resolved }) => {
            if (!resolved) return null

            if (resolved.mode === 'direct') {
              const isActive = activeKey === resolved.target
              return (
                <button
                  key={group.key}
                  type="button"
                  className={'cp-menu-item' + (isActive ? ' cp-menu-item--active' : '')}
                  onClick={() => navValue.navigate(resolved.target, null)}
                >
                  {group.label}
                </button>
              )
            }

            /* expand mode — accordion */
            const isExpanded   = drawerExpanded.has(group.key)
            const containsActive = resolved.children.includes(activeKey)
            return (
              <div key={group.key} className="cp-menu-group">
                <button
                  type="button"
                  className={
                    'cp-menu-group-header'
                    + (isExpanded     ? ' cp-menu-group-header--open'   : '')
                    + (containsActive ? ' cp-menu-group-header--active' : '')
                  }
                  onClick={() => toggleDrawerGroup(group.key)}
                  aria-expanded={isExpanded}
                >
                  <span className="cp-menu-group-label">{group.label}</span>
                  <span
                    className={
                      'cp-menu-group-chevron'
                      + (isExpanded ? ' cp-menu-group-chevron--open' : '')
                    }
                    aria-hidden="true"
                  >
                    <IconChevron size={14} />
                  </span>
                </button>
                {isExpanded && (
                  <div className="cp-menu-group-children">
                    {resolved.children.map(childKey => {
                      const isChildActive = activeKey === childKey
                      return (
                        <button
                          key={childKey}
                          type="button"
                          className={'cp-menu-subitem' + (isChildActive ? ' cp-menu-subitem--active' : '')}
                          onClick={() => navValue.navigate(childKey, group.key)}
                        >
                          {LABEL_BY_KEY[childKey] || childKey}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
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
              onClick={() => navValue.navigate('account', null)}
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
            For every screen except 'home' and 'account' we render the
            SHARED .cp-screen-header row at the very top: title text on
            the right (RTL start), curved IconBack pinned at the visual
            LEFT. The same .cp-screen-header is used by ClientHome on
            its group sub-screen, so both surfaces share one geometry.
            When the wrapper renders a title, the cp-content--with-header
            modifier hides each screen's own .cp-screen-title to avoid
            duplication. ── */}
      <main className={'cp-content' + (showBackArrow ? ' cp-content--with-header' : '')}>
        {showBackArrow && (
          <div className="cp-screen-header">
            <h2 className="cp-screen-header-title">{activeItem.label}</h2>
            <button
              type="button"
              className="cp-screen-back"
              onClick={() => navValue.goBack()}
              aria-label="חזרה"
            >
              <IconBack size={20} />
            </button>
          </div>
        )}
        <ActiveScreen
          title={activeItem.label}
          firstName={firstName}
          lastName={lastName}
          isFamily={isFamily}
          clientVisibleTabs={clientVisibleTabs}
          showProgrammingQuestionnaire={showProgrammingQuestionnaire}
          /* Home-only props: lets ClientHome auto-open a group's sub-
             screen after goBack lands here, then clear it once consumed. */
          pendingHomeGroup={activeKey === 'home' ? pendingHomeGroup : null}
          clearPendingHomeGroup={() => setPendingHomeGroup(null)}
        />
      </main>

      {/* ── Sticky contact footer (Phone / WhatsApp / Email) ──
          Lives as a flex-shrink:0 sibling of <main>, so .cp-content
          (the scroll container) is pushed up and the footer doesn't
          cover content. Hidden in screens that own a competing fixed
          bottom bar — see ClientFooterProvider + useClientFooter. */}
      <ClientFooter />

    </div>
    </ClientNavContext.Provider>
    </ClientFooterProvider>
  )
}
