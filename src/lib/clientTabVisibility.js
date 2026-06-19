// src/lib/clientTabVisibility.js
//
// Per-project client tab visibility — single source of truth.
//
// projects.client_visible_tabs (jsonb) maps a CLIENT drawer key →
// boolean. NULL on the column or any missing key falls back to the
// DEFAULTS below. Both the manager (ProjectDetail) and the client
// (ClientPortal) resolve visibility through the same helper so they
// can't disagree.
//
// Only 7 client drawer items are controllable; the rest of the drawer
// ('home', 'contact', 'account') is always visible.

/* Manager TAB id → client drawer key → ship-out-of-the-box default.
   The label is what the manager sees in the right-click row; it
   intentionally matches the manager Tab label so the affordance is
   obvious. */
export const CONTROLLABLE_TABS = [
  { managerTabId: 1,  clientKey: 'file',        defaultVisible: true,  label: 'פרטי תיק' },
  { managerTabId: 2,  clientKey: 'documents',   defaultVisible: true,  label: 'מעקב מסמכים' },
  { managerTabId: 6,  clientKey: 'quantities',  defaultVisible: false, label: 'כתב כמויות' },
  { managerTabId: 7,  clientKey: 'finishing',   defaultVisible: false, label: 'חומרי גמר' },
  { managerTabId: 9,  clientKey: 'contractor',  defaultVisible: false, label: 'מפרט לקבלן' },
  { managerTabId: 10, clientKey: 'shared',      defaultVisible: true,  label: 'מרחב משותף' },
  { managerTabId: 8,  clientKey: 'progress',    defaultVisible: false, label: 'גאנט' },
]

export const DEFAULT_CLIENT_TAB_VISIBILITY = CONTROLLABLE_TABS.reduce((acc, t) => {
  acc[t.clientKey] = t.defaultVisible
  return acc
}, {})

/**
 * Resolve whether a client tab should be shown for this project.
 * @param {string} clientKey               One of the controllable client keys.
 * @param {object|null|undefined} json     projects.client_visible_tabs value.
 * @returns {boolean}
 */
export function isClientTabVisible(clientKey, json) {
  return json?.[clientKey] ?? DEFAULT_CLIENT_TAB_VISIBILITY[clientKey] ?? false
}
