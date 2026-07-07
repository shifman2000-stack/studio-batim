// src/pages/client/ClientHome.jsx
//
// "בית" — landing screen for the client portal. Greeting at the top
// (slightly raised to make room) + a 2-column grid of group tiles
// below. Each tile is one of the four top-level navigation GROUPS
// (defined in src/lib/clientPortalGroups.js). Group behaviour is
// determined by resolveGroup (see clientPortalGroups.js):
//   * null   → group is hidden.
//   * direct → tap navigates straight to the only child screen.
//   * expand → tap reveals a sub-screen with that group's child tiles,
//     a curved IconBack at the visual LEFT of the title row to return
//     to the groups grid (matches the per-content-screen back-arrow
//     placement).
//
// On a sub-screen, the greeting + subtitle are hidden — the only
// heading is the group name in the centered title row.
//
// PART B navigation memory: when a child tile is tapped, navigate is
// called with the parent group's key as `origin` so the per-screen back
// arrow can return to the sub-screen of that group (see goBack in
// ClientPortal.jsx). When the user lands back on 'home' via goBack with
// an active origin group, ClientPortal passes `pendingHomeGroup` and
// this component opens that sub-screen on mount, then immediately tells
// the parent to clear the request so it doesn't fire on a re-render.
//
// Greeting selection (single source of truth — ClientPortal computes the
// live identity from project_contacts and passes it down via props; the
// top bar uses the SAME logic):
//
//   isFamily && lastName  →  "ברוכים הבאים משפחת {lastName}"
//   isFamily && !lastName →  "ברוכים הבאים"
//   single contact        →  two centered lines:
//                              line 1: "הי {firstName}"  (no comma)
//                              line 2: "ברוך הבא למרחב המשותף שלנו"
//
// firstName falls back to the useClient() snapshot if the live lookup
// returned nothing.

import { useEffect, useState } from 'react'
import { useClient } from '../../components/ClientRoute'
import { useClientNav } from '../ClientPortal'
import { GROUPS, resolveGroup } from '../../lib/clientPortalGroups'
import { GroupIcon, IconBack } from '../../components/icons/PortalIcons'

/* Child-key → drawer label. Mirrors MENU_ITEMS in ClientPortal.jsx —
   kept inline so the home screen doesn't have to import the whole
   menu config just to render a sub-tile label. */
const CHILD_LABELS = {
  file:          'פרטי תיק',
  documents:     'תיק מסמכים',
  shared:        'מרחב משותף',
  quantities:    'כתב כמויות',
  finishing:     'חומרי גמר',
  contractor:    'מפרט לקבלן',
  progress:      'שלבי התקדמות',
  meetings:      'סיכומי פגישות',
}

export default function ClientHome({
  firstName, lastName, isFamily,
  clientVisibleTabs,
  pendingHomeGroup,
  clearPendingHomeGroup,
}) {
  const { first_name: ctxFirstName } = useClient()
  const { navigate } = useClientNav()
  const displayName = firstName || ctxFirstName || ''

  /* Sub-screen state — when set, the group grid is replaced by the
     children grid of that group + a back button. Initialized from a
     pending request (goBack origin) when present. */
  const [openGroupKey, setOpenGroupKey] = useState(() => pendingHomeGroup || null)

  /* Consume any pending-open-group request that arrives after mount
     (e.g. user navigates away and back via goBack to the same group). */
  useEffect(() => {
    if (pendingHomeGroup) {
      setOpenGroupKey(pendingHomeGroup)
      clearPendingHomeGroup?.()
    }
  }, [pendingHomeGroup])  // eslint-disable-line react-hooks/exhaustive-deps

  const familyGreeting = isFamily
    ? (lastName ? `ברוכים הבאים משפחת ${lastName}` : 'ברוכים הבאים')
    : null

  /* Pre-resolve every group once per render so we don't redo the
     visibility math inside the JSX. Hidden groups become null. */
  const resolvedGroups = GROUPS.map(g => ({ group: g, resolved: resolveGroup(g, clientVisibleTabs) }))
  const visibleGroups  = resolvedGroups.filter(rg => rg.resolved !== null)

  const handleGroupTap = (group, resolved) => {
    if (!resolved) return
    if (resolved.mode === 'direct') {
      /* origin = null → "going from the home grid directly", so the
         per-screen back arrow returns to the home grid, not a sub-screen. */
      navigate(resolved.target, null)
    } else {
      setOpenGroupKey(group.key)
    }
  }

  /* When in sub-screen mode, pick the active group + its visible
     children for rendering. If the manager's visibility flipped and
     the group is no longer expandable, fall back to the groups grid. */
  const activeSubGroup = openGroupKey
    ? visibleGroups.find(rg => rg.group.key === openGroupKey && rg.resolved.mode === 'expand')
    : null

  return (
    <div className={'cp-home' + (activeSubGroup ? ' cp-home--subgroup' : '')}>
      <div className="cp-home-content">

        {/* Greeting + subtitle — shown ONLY on the main groups grid,
            NOT inside a group sub-screen. Inside a sub-screen the only
            heading is the group name in the shared header row. */}
        {!activeSubGroup && (
          <>
            {isFamily ? (
              <p className="cp-home-greeting" style={{ textAlign: 'center' }}>
                {familyGreeting}
              </p>
            ) : (
              <p className="cp-home-greeting" style={{ textAlign: 'center' }}>
                הי {displayName}
                <br />
                ברוך הבא לאזור האישי שלך בסטודיו בתים
              </p>
            )}

            <p className="cp-home-subtagline">
              כאן נוכל לעקוב ביחד אחר הפרויקט ולשתף קבצים
            </p>
          </>
        )}

        {/* Tile grid — groups view OR sub-screen view */}
        {activeSubGroup ? (
          <div className="cp-home-subgroup">
            {/* Shared header row — SAME class, same geometry, same back
                arrow as the per-content-screen wrapper in ClientPortal.jsx.
                Group name on the right, IconBack pinned at the visual
                LEFT. Single source of truth in ClientPortal.css. */}
            <div className="cp-screen-header">
              <h2 className="cp-screen-header-title">{activeSubGroup.group.label}</h2>
              <button
                type="button"
                className="cp-screen-back"
                onClick={() => setOpenGroupKey(null)}
                aria-label="חזרה"
              >
                <IconBack size={20} />
              </button>
            </div>
            <div className="cp-home-tiles">
              {activeSubGroup.resolved.children.map(childKey => (
                <button
                  key={childKey}
                  type="button"
                  className="cp-home-tile cp-home-tile--child"
                  onClick={() => navigate(childKey, activeSubGroup.group.key)}
                >
                  <span className="cp-home-tile-label">{CHILD_LABELS[childKey] || childKey}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          visibleGroups.length > 0 && (
            <div className="cp-home-tiles">
              {visibleGroups.map(({ group, resolved }) => (
                <button
                  key={group.key}
                  type="button"
                  className="cp-home-tile"
                  onClick={() => handleGroupTap(group, resolved)}
                >
                  <span className="cp-home-tile-icon">
                    <GroupIcon name={group.icon} size={36} />
                  </span>
                  <span className="cp-home-tile-label">{group.label}</span>
                </button>
              ))}
            </div>
          )
        )}

      </div>
    </div>
  )
}
