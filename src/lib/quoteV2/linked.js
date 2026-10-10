import { resolveText } from './resolve.js'

/* ═══════════════════════════════════════════════════════════════════════
   מקושר / קפוא — מסמך התכנון, C.5 (החלטה 36)

   עינב לא רואה `{{משתנה}}`, `{יחיד|רבים}` או `[[קטע מותנה]]` לעולם.
   שני מצבים לכל שדה טקסט בעורך:

   · **מקושר** (ברירת מחדל) — מציגים את הטקסט **פתור**, שומרים את
     הגולמי מהתבנית. מילוי לקוח שני או מחיקת שטח משנים אותו לבד.
   · **קפוא** — ברגע שעינב הקלידה, מה שהיא כתבה הוא מה שיישמר,
     מילה במילה. השדה מפסיק להתעדכן, ומוצג עליו ↺.

   איך יודעים מי קפוא: `content.meta.frozen` — מערך של נתיבים.
   נתיב הוא `<id של הבעלים>.<שדה>`, למשל `sec_open.greeting` או
   `st_1.storyBody`. ה-id יציב גם אחרי סידור מחדש, ולכן הנתיב שורד
   העברת שלב למעלה או למטה — מה שאינדקס לא היה שורד.

   ⚠️ השחזור (↺) קורא את הנוסח הגולמי **מהתבנית** ולא מעותק נוסף
   בתוך ההצעה. זה מה שמונע שני מקורות אמת לאותו טקסט.
   ═══════════════════════════════════════════════════════════════════════ */

/** הנתיב הקנוני של שדה. */
export function fieldPath(ownerId, field) {
  return `${ownerId}.${field}`
}

/** רשימת הנתיבים הקפואים, תמיד מערך. */
export function frozenPaths(content) {
  const list = content?.meta?.frozen
  return Array.isArray(list) ? list : []
}

export function isFrozen(content, ownerId, field) {
  return frozenPaths(content).includes(fieldPath(ownerId, field))
}

/** מחזיר meta חדש עם הנתיב מסומן כקפוא. לא משנה את הקלט. */
export function freeze(content, ownerId, field) {
  const path = fieldPath(ownerId, field)
  const cur = frozenPaths(content)
  if (cur.includes(path)) return content
  return { ...content, meta: { ...(content?.meta ?? {}), frozen: [...cur, path] } }
}

/** מסיר את הסימון. לא משנה את הקלט. */
export function unfreeze(content, ownerId, field) {
  const path = fieldPath(ownerId, field)
  const cur = frozenPaths(content)
  if (!cur.includes(path)) return content
  return { ...content, meta: { ...(content?.meta ?? {}), frozen: cur.filter(p => p !== path) } }
}

/**
 * מה להציג בשדה.
 *
 * קפוא → בדיוק מה שנשמר. מקושר → הטקסט הפתור.
 * זה גם מה שעינב מתחילה להקליד ממנו, ולכן עריכה מתחילה מהניסוח
 * שהיא רואה ולא מתחביר שהיא לא מכירה.
 */
export function displayValue({ raw, frozen, vars, clientCount }) {
  if (frozen) return raw ?? ''
  return resolveText(raw ?? '', vars ?? {}, clientCount ?? 1)
}

/**
 * האם יש מה לשחזר — כלומר השדה קפוא **ויש** לו מקור בתבנית.
 * שדה שעינב יצרה מאפס (שלב חדש, תנאי חדש) אין לו נוסח אוטומטי,
 * ולכן גם לא כפתור ↺.
 */
export function canRestore({ frozen, templateRaw }) {
  return !!frozen && templateRaw !== undefined && templateRaw !== null
}

/* ── חיפוש הנוסח הגולמי בתבנית ─────────────────────────────────────── */

/**
 * מאתר בתוך content/template את האובייקט שה-id שלו הוא ownerId.
 * מחפש בסעיפים, בפריטי stages/extras, ובקבוצות ובפריטי terms.
 * מחזיר undefined אם אין — וזה מצב חוקי (פריט חדש).
 */
export function findById(root, ownerId) {
  for (const sec of root?.sections ?? []) {
    if (sec?.id === ownerId) return sec
    for (const it of sec?.items ?? []) {
      if (it?.id === ownerId) return it
    }
    for (const g of sec?.groups ?? []) {
      if (g?.id === ownerId) return g
      for (const it of g?.items ?? []) {
        if (it?.id === ownerId) return it
      }
    }
  }
  return undefined
}

/** הנוסח הגולמי מהתבנית עבור שדה, או undefined אם אין מקור. */
export function templateRawOf(template, ownerId, field) {
  const owner = findById(template, ownerId)
  if (!owner) return undefined
  const v = owner[field]
  return v === undefined ? undefined : v
}
