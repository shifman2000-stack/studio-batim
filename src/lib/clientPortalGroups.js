// src/lib/clientPortalGroups.js
//
// Top-level navigation groups for the client portal. Four parents,
// each with one or more children that map to existing MENU_ITEMS keys
// in ClientPortal.jsx.
//
// The shape is intentionally tiny — `icon` is a string identifier that
// the consumer (ClientHome tiles, drawer sub-menu) resolves to a real
// Feather-style SVG via src/components/icons/PortalIcons.jsx.

import { isClientTabVisible } from './clientTabVisibility'

export const GROUPS = [
  {
    key:      'filing',
    label:    'פרטי תיק',
    icon:     'filing',
    children: ['file'],
  },
  {
    key:      'shared_group',
    label:    'מרחב משותף',
    icon:     'shared_group',
    children: ['shared'],
  },
  {
    key:      'progress_group',
    label:    'התקדמות התהליך',
    icon:     'progress_group',
    children: ['documents', 'progress', 'meetings'],
  },
  {
    key:      'plans',
    label:    'מפרטים לשלב ביצוע',
    icon:     'plans',
    children: ['quantities', 'finishing', 'contractor'],
  },
]

/**
 * Client keys that are ALWAYS visible regardless of the per-project
 * client_visible_tabs jsonb. These are keys that aren't in
 * clientTabVisibility.js's CONTROLLABLE_TABS at all (so
 * isClientTabVisible falls through to `false`) but we still want the
 * tile/drawer entry to render — typically because they're brand-new
 * screens shipped ahead of their manager-side toggle.
 *
 * Currently EMPTY: the questionnaire is temporarily disconnected from
 * the portal so this bundle can ship without the questionnaire /
 * house-builder module. When the manager-side lands the questionnaire
 * key will move back in here (or graduate to CONTROLLABLE_TABS).
 */
const ALWAYS_ON_CHILDREN = new Set()

/**
 * Children of a group that the current project allows the client to see.
 * Order is preserved from the group's `children` array.
 * @param {object} group
 * @param {object|null} clientVisibleTabs   projects.client_visible_tabs json
 * @returns {string[]}
 */
export function getVisibleChildren(group, clientVisibleTabs) {
  return group.children.filter(k =>
    ALWAYS_ON_CHILDREN.has(k) || isClientTabVisible(k, clientVisibleTabs)
  )
}

/**
 * Decide how a group should behave for the current project. The
 * 'direct' vs 'expand' decision depends on the group's DEFINITION
 * (how many children it has in GROUPS), NOT on how many happen to be
 * visible to this client right now — so the user gets a consistent UX:
 * an inherently-multi group always shows a sub-screen, even when only
 * one of its children is currently visible.
 *
 *   - 0 visible children                       → null (hide the group)
 *   - group defined with exactly ONE child     → { mode: 'direct',  target:   <only visible child> }
 *   - group defined with TWO OR MORE children  → { mode: 'expand',  children: [<visible children>] }
 *     (even if only one is currently visible — the sub-screen still
 *      renders with that single tile, keeping behavior consistent)
 *
 * @param {object} group
 * @param {object|null} clientVisibleTabs
 * @returns {null | { mode: 'direct', target: string } | { mode: 'expand', children: string[] }}
 */
export function resolveGroup(group, clientVisibleTabs) {
  const visible = getVisibleChildren(group, clientVisibleTabs)
  if (visible.length === 0) return null
  if (group.children.length === 1) return { mode: 'direct', target: visible[0] }
  return { mode: 'expand', children: visible }
}
