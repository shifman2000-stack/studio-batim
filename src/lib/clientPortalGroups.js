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
    children: ['questionnaire', 'documents', 'progress', 'meetings'],
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
 * Currently empty. 'questionnaire' USED to live here as a force-on
 * override; it's now gated per-project via the
 * projects.show_programming_questionnaire boolean instead (see
 * getVisibleChildren below).
 */
const ALWAYS_ON_CHILDREN = new Set()

/**
 * Children of a group that the current project allows the client to see.
 * Order is preserved from the group's `children` array.
 *
 * Two extra gates on top of the ALWAYS_ON / client_visible_tabs logic:
 *   * 'questionnaire' — hidden unless the third param
 *     `showProgrammingQuestionnaire` is strictly true (the value of
 *     projects.show_programming_questionnaire for this project).
 *     Undefined / false → tile is not rendered to the client at all.
 *
 * @param {object} group
 * @param {object|null} clientVisibleTabs             projects.client_visible_tabs json
 * @param {boolean|undefined} showProgrammingQuestionnaire
 *   projects.show_programming_questionnaire — controls ONLY the
 *   'questionnaire' child. Default undefined → treated as false.
 * @returns {string[]}
 */
export function getVisibleChildren(group, clientVisibleTabs, showProgrammingQuestionnaire) {
  return group.children.filter(k => {
    /* Per-project override for the programming-questionnaire tile.
       Must be strictly true (not truthy) — a missing column reads
       back as undefined and stays hidden on the client. */
    if (k === 'questionnaire') return showProgrammingQuestionnaire === true
    return ALWAYS_ON_CHILDREN.has(k) || isClientTabVisible(k, clientVisibleTabs)
  })
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
 * @param {boolean|undefined} showProgrammingQuestionnaire   forwarded to getVisibleChildren
 * @returns {null | { mode: 'direct', target: string } | { mode: 'expand', children: string[] }}
 */
export function resolveGroup(group, clientVisibleTabs, showProgrammingQuestionnaire) {
  const visible = getVisibleChildren(group, clientVisibleTabs, showProgrammingQuestionnaire)
  if (visible.length === 0) return null
  if (group.children.length === 1) return { mode: 'direct', target: visible[0] }
  return { mode: 'expand', children: visible }
}
