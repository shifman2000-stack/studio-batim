import { deriveFirstNames, isFilled } from './resolve.js'

/* ═══════════════════════════════════════════════════════════════════════
   פעולות העורך על content_v2 — פונקציות טהורות

   כל פונקציה כאן מחזירה content **חדש** ולא נוגעת בקלט. זה לא
   פדנטיות: העורך שומר אוטומטית, והתצוגה המקדימה מרנדרת את אותו
   אובייקט. מוטציה במקום הייתה גורמת לתצוגה להראות מצב שלא נשמר,
   או לשמירה לרוץ על מצב שכבר השתנה.

   מזהים: `id` של סעיף, שלב, קבוצה או תנאי הוא **יציב**. סידור מחדש
   לא משנה אותו, ולכן גם נתיבי "קפוא" (linked.js) וגם התאמת התבנית
   (templateSync.js) שורדים כל פעולה כאן.
   ═══════════════════════════════════════════════════════════════════════ */

export const newId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const mapSections = (content, fn) => ({
  ...content,
  sections: (content?.sections ?? []).map(fn),
})

export const sectionByType = (content, type) =>
  (content?.sections ?? []).find(s => s?.type === type)

/* ── vars ─────────────────────────────────────────────────────────── */

/**
 * בונה מחדש את vars מ-clients/property/totals.
 *
 * ⚠️ חייב להישאר זהה ל-buildQuoteV2Content ב-content.js. vars הוא
 * מה שהמרנדרים קוראים, ולכן כל שדה שנגזר שם ולא כאן יגרום להצעה
 * להיראות אחרת אחרי עריכה מאשר ביצירה.
 */
export function recomputeVars(content) {
  const clients = Array.isArray(content?.clients) ? content.clients : []
  const p = content?.property ?? {}
  return {
    ...content,
    vars: {
      ...(content?.vars ?? {}),
      firstNames: deriveFirstNames(clients.map(c => c?.firstName)),
      settlement: p.settlement ?? '',
      houseArea: p.houseArea ?? '',
      plotArea: p.plotArea ?? '',
      fee: Number(content?.totals?.fee) || 0,
      clientPhone: clients[0]?.phone ?? '',
      clientEmail: clients[0]?.email ?? '',
    },
  }
}

export function setClient(content, index, patch) {
  const clients = [...(content?.clients ?? [])]
  while (clients.length <= index) clients.push({ firstName: '', lastName: '', phone: '', email: '' })
  clients[index] = { ...clients[index], ...patch }
  return recomputeVars({ ...content, clients })
}

/** מסיר את הלקוח השני. ההצעה חוזרת ללשון יחיד מעצמה. */
export function removeSecondClient(content) {
  return recomputeVars({ ...content, clients: (content?.clients ?? []).slice(0, 1) })
}

export function setProperty(content, patch) {
  return recomputeVars({ ...content, property: { ...(content?.property ?? {}), ...patch } })
}

export function setFee(content, fee) {
  const n = Number(fee) || 0
  return recomputeVars({ ...content, totals: { ...(content?.totals ?? {}), fee: n } })
}

/* ── עריכת שדות ───────────────────────────────────────────────────── */

/** ממזג patch לאובייקט שה-id שלו ownerId, בכל עומק. */
export function patchById(content, ownerId, patch) {
  return mapSections(content, sec => {
    if (sec?.id === ownerId) return { ...sec, ...patch }
    let next = sec
    if (Array.isArray(sec?.items) && sec.items.some(i => i?.id === ownerId)) {
      next = { ...next, items: next.items.map(i => (i?.id === ownerId ? { ...i, ...patch } : i)) }
    }
    if (Array.isArray(sec?.groups)) {
      let touched = false
      const groups = sec.groups.map(g => {
        if (g?.id === ownerId) { touched = true; return { ...g, ...patch } }
        if (Array.isArray(g?.items) && g.items.some(i => i?.id === ownerId)) {
          touched = true
          return { ...g, items: g.items.map(i => (i?.id === ownerId ? { ...i, ...patch } : i)) }
        }
        return g
      })
      if (touched) next = { ...next, groups }
    }
    return next
  })
}

/* ── שלבים ────────────────────────────────────────────────────────── */

const EMPTY_STAGE = {
  formalName: '', trigger: '', duration: '', process: '', output: '',
  storyTitle: '', storyBody: '', storyDeliverable: '', shortLabel: '', pct: 0,
}

/** מחזיר גם את ה-id שנוצר, כדי שהעורך יפתח מיד את הכרטיס החדש. */
export function addStage(content, payload = {}) {
  const id = newId('st')
  const next = mapSections(content, sec =>
    sec?.type === 'stages'
      ? { ...sec, items: [...(sec.items ?? []), { ...EMPTY_STAGE, ...payload, id }] }
      : sec)
  return { content: next, id }
}

export function removeStage(content, stageId) {
  return mapSections(content, sec =>
    sec?.type === 'stages'
      ? { ...sec, items: (sec.items ?? []).filter(s => s?.id !== stageId) }
      : sec)
}

/** מזיז פריט ברשימה. dir = -1 למעלה, 1 למטה. מחוץ לטווח — בלי שינוי. */
function moved(list, id, dir) {
  const i = list.findIndex(x => x?.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return null
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

export function moveStage(content, stageId, dir) {
  const sec = sectionByType(content, 'stages')
  const next = moved(sec?.items ?? [], stageId, dir)
  if (!next) return content
  return mapSections(content, s => (s?.type === 'stages' ? { ...s, items: next } : s))
}

export function setStagePct(content, stageId, pct) {
  const n = Math.max(0, Math.min(100, Number(String(pct).replace(/[^\d]/g, '')) || 0))
  return patchById(content, stageId, { pct: n })
}

/* ── תוספות ───────────────────────────────────────────────────────── */

export function toggleExtra(content, extraId) {
  return mapSections(content, sec =>
    sec?.type === 'extras'
      ? { ...sec, items: (sec.items ?? []).map(x => (x?.id === extraId ? { ...x, enabled: x?.enabled === false } : x)) }
      : sec)
}

export function addExtra(content, payload = {}) {
  const id = newId('ex')
  return mapSections(content, sec =>
    sec?.type === 'extras'
      ? { ...sec, items: [...(sec.items ?? []), { title: '', sub: '', ...payload, id }] }
      : sec)
}

export function removeExtra(content, extraId) {
  return mapSections(content, sec =>
    sec?.type === 'extras'
      ? { ...sec, items: (sec.items ?? []).filter(x => x?.id !== extraId) }
      : sec)
}

/* ── תנאים ────────────────────────────────────────────────────────── */

export function addGroup(content, title = 'נושא חדש') {
  const id = newId('grp')
  return {
    content: mapSections(content, sec =>
      sec?.type === 'terms'
        ? { ...sec, groups: [...(sec.groups ?? []), { id, title, items: [] }] }
        : sec),
    id,
  }
}

export function removeGroup(content, groupId) {
  return mapSections(content, sec =>
    sec?.type === 'terms'
      ? { ...sec, groups: (sec.groups ?? []).filter(g => g?.id !== groupId) }
      : sec)
}

export function moveGroup(content, groupId, dir) {
  const sec = sectionByType(content, 'terms')
  const next = moved(sec?.groups ?? [], groupId, dir)
  if (!next) return content
  return mapSections(content, s => (s?.type === 'terms' ? { ...s, groups: next } : s))
}

const EMPTY_TERM = { formalTitle: '', body: '', question: '', marketingAnswer: '' }

export function addTerm(content, groupId, payload = {}) {
  const id = newId('tm')
  return {
    content: mapSections(content, sec =>
      sec?.type === 'terms'
        ? {
          ...sec,
          groups: (sec.groups ?? []).map(g =>
            g?.id === groupId ? { ...g, items: [...(g.items ?? []), { ...EMPTY_TERM, ...payload, id }] } : g),
        }
        : sec),
    id,
  }
}

export function removeTerm(content, termId) {
  return mapSections(content, sec =>
    sec?.type === 'terms'
      ? { ...sec, groups: (sec.groups ?? []).map(g => ({ ...g, items: (g.items ?? []).filter(i => i?.id !== termId) })) }
      : sec)
}

export function moveTerm(content, termId, dir) {
  const sec = sectionByType(content, 'terms')
  const group = (sec?.groups ?? []).find(g => (g?.items ?? []).some(i => i?.id === termId))
  if (!group) return content
  const next = moved(group.items, termId, dir)
  if (!next) return content
  return mapSections(content, s =>
    s?.type === 'terms'
      ? { ...s, groups: s.groups.map(g => (g?.id === group.id ? { ...g, items: next } : g)) }
      : s)
}

/* ── וריאנט הבריכה (החלטה 31) ─────────────────────────────────────── */

/**
 * מחליף את תכולת השירות ואת שלבים 1-3 בגרסאות המתויגות `בריכה`,
 * או מחזיר את גרסאות ברירת המחדל.
 *
 * ההתאמה בין פריט ספרייה לשלב בהצעה היא לפי **`formalName`** —
 * גרסת הבריכה וגרסת ברירת המחדל של אותו שלב חולקות שם רשמי זהה,
 * וזה מה שמחבר ביניהן. ה-`id` של השלב בהצעה נשמר, וכך גם ה-`pct`:
 * אם עינב כבר שינתה את חלוקת התשלומים, החלפת נוסח לא תדרוס אותה.
 *
 * @param {object[]} library  שורות quote_library_items
 * @param {boolean}  on       true = עם בריכה, false = חזרה לברירת המחדל
 */
export function applyPoolVariant(content, library, on) {
  const pick = (type, wantPool) => (library ?? []).filter(r =>
    r?.type === type && !r?.archived && (r?.tags ?? []).includes('בריכה') === wantPool)

  const scopeRow = pick('scope', on)[0]
  const stageRows = pick('stage', on)

  let next = content

  if (scopeRow?.payload) {
    const scope = sectionByType(next, 'scope')
    if (scope) next = patchById(next, scope.id, { ...scopeRow.payload })
  }

  const stages = sectionByType(next, 'stages')?.items ?? []
  for (const row of stageRows) {
    const name = row?.payload?.formalName
    if (!isFilled(name)) continue
    const target = stages.find(s => s?.formalName === name)
    if (!target) continue
    const { pct: _ignored, ...rest } = row.payload
    next = patchById(next, target.id, rest)
  }

  return next
}

/** האם ההצעה כרגע בגרסת הבריכה — לפי תכולת השירות. */
export function isPoolOn(content, library) {
  const poolScope = (library ?? []).find(r => r?.type === 'scope' && (r?.tags ?? []).includes('בריכה'))
  const body = sectionByType(content, 'scope')?.body
  return !!poolScope && !!body && body === poolScope.payload?.body
}
