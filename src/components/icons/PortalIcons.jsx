// src/components/icons/PortalIcons.jsx
//
// Shared Feather-style icons for the client portal. All use
// stroke="currentColor" so callers control the color via CSS.
//
// Other client screens still ship local copies of IconChevron for
// historical reasons; this module centralizes the icons that the new
// home tiles + drawer sub-menu need, plus the existing IconChevron /
// IconUser for anywhere that wants the canonical version.

export const IconChevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

export const IconUser = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

/* Curved "undo" arrow used for "חזרה" affordances on the home sub-screen
   and per-content-screen back button. Feather-style stroke. */
export const IconBack = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 14 4 9 9 4"/>
    <path d="M20 20v-7a4 4 0 0 0-4-4H4"/>
  </svg>
)

/* Clipboard with horizontal lines — "מפרטים לשלב ביצוע". */
export const IconPlans = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="2" width="8" height="4" rx="1"/>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
    <line x1="8"  y1="11" x2="16" y2="11"/>
    <line x1="8"  y1="15" x2="16" y2="15"/>
    <line x1="8"  y1="19" x2="13" y2="19"/>
  </svg>
)

/* Folder — "פרטי תיק". */
export const IconFiling = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
)

/* Trending-up — "התקדמות התהליך". */
export const IconProgressGroup = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
    <polyline points="17 6 23 6 23 12"/>
  </svg>
)

/* Two-user "share" silhouette — "מרחב משותף". */
export const IconSharedGroup = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
)

/* Resolve a group's `icon` string identifier to the actual component. */
const GROUP_ICONS = {
  plans:          IconPlans,
  filing:         IconFiling,
  progress_group: IconProgressGroup,
  shared_group:   IconSharedGroup,
}

export function GroupIcon({ name, size = 32 }) {
  const Cmp = GROUP_ICONS[name]
  if (!Cmp) return null
  return <Cmp size={size} />
}
