/* סיומת מפורשת: Vite לא צריך אותה, אבל node כן — הבדיקות לידו
   רצות ב-node רגיל בלי bundler. */

/* ═══════════════════════════════════════════════════════════════════════
   תבנית ברבים, והמרה ליחיד
   ═══════════════════════════════════════════════════════════════════════

   עד כאן התבנית החזיקה את שני הניסוחים זה בתוך זה: ‎{בוא|בואו}.
   זה אילץ את עינב לערוך כל שדה פעמיים, ואת הקוד להרכיב את
   הניסוח חזרה משתי תיבות — מה שאיבד עריכות בשקט.

   מעכשיו התבנית כתובה **ברבים בלבד**, כטקסט רגיל. הצעה ללקוח
   אחד מומרת ליחיד פעם אחת, בעת יצירתה, על ידי Claude.

   ⚠️ ה-resolver (resolve.js) ממשיך לתמוך ב-{יחיד|רבים} ואסור
   לגעת בו: הצעות שכבר נשלחו ונחתמו מחזיקות את התחביר הזה
   בתוכן הקפוא שלהן, והן חייבות להמשיך להיראות בדיוק כפי שהיו.
   ═══════════════════════════════════════════════════════════════════════ */

const ALT_RE = /\{([^{}|]*)\|([^{}|]*)\}/g
const VAR_RE = /\{\{(\w+)\}\}/g
const OPT_RE = /\[\[([^[\]]*)\]\]/g

/** שדות שאינם טקסט ללקוח ולא נשלחים להמרה ולא מנורמלים. */
export const NON_TEXT_FIELDS = new Set(['id', 'type', 'libraryId', 'enabled', 'pct'])

/**
 * מחזיר את צד הרבים של כל חלופה, ומשאיר את כל השאר כפי שהוא.
 *
 * ⚠️ נוגע **רק** ב-{א|ב}. ‎{{משתנה}} אינו נפגע כי ה-regex אוסר
 * ‎{ ו-} בתוך החלופה, ו-[[קטע מותנה]] אינו נוגע בו כלל.
 */
export function pluralOf(raw) {
  if (typeof raw !== 'string') return raw
  return raw.replace(ALT_RE, (_m, _s, p) => p)
}

/** אותו דבר, על כל שדות הטקסט של content_v2. */
export function pluralizeContent(content) {
  return mapTextFields(content, (text) => pluralOf(text))
}

/** האם נשארה חלופה כלשהי בתוכן — לאימות אחרי הגירה. */
export function hasAlternatesAnywhere(content) {
  let found = false
  mapTextFields(content, (text) => {
    ALT_RE.lastIndex = 0
    if (ALT_RE.test(text)) found = true
    return text
  })
  return found
}

/* ── מעבר על שדות הטקסט ────────────────────────────────────────────
   מבנה content_v2 הוא sections → items / groups → items. שלוש
   הרמות האלה הן כל מה שיש, ולכן המעבר כתוב במפורש ולא כרקורסיה
   כללית: רקורסיה הייתה נכנסת גם ל-clients, ל-vars ול-signatures. */

function mapObj(obj, fn, ownerPath, out) {
  const next = { ...obj }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'string' || NON_TEXT_FIELDS.has(k)) continue
    const path = `${ownerPath}.${k}`
    const r = fn(v, path)
    if (out) out.push({ path, text: v })
    if (typeof r === 'string') next[k] = r
  }
  return next
}

function walk(content, fn, out) {
  const sections = (content?.sections ?? []).map(sec => {
    const next = mapObj(sec, fn, sec.id, out)
    if (Array.isArray(sec.items)) next.items = sec.items.map(it => mapObj(it, fn, it.id, out))
    if (Array.isArray(sec.groups)) {
      next.groups = sec.groups.map(g => ({
        ...mapObj(g, fn, g.id, out),
        items: (g.items ?? []).map(it => mapObj(it, fn, it.id, out)),
      }))
    }
    return next
  })
  return { ...content, sections }
}

/** מחיל פונקציה על כל שדה טקסט ומחזיר content חדש. */
export function mapTextFields(content, fn) {
  return walk(content, fn)
}

/** כל שדות הטקסט כרשימת {path, text} — מה שנשלח להמרה. */
export function collectTextFields(content) {
  const out = []
  walk(content, (t) => t, out)
  return out.filter(f => f.text.trim() !== '')
}

/** כותב בחזרה רשימת {path, text} אל התוכן. */
export function applyTextFields(content, fields) {
  const byPath = new Map((fields ?? []).map(f => [f.path, f.text]))
  return walk(content, (text, path) => (byPath.has(path) ? byPath.get(path) : text))
}

/* ── אימות המרה ────────────────────────────────────────────────────
   ⚠️ זה השומר היחיד על נוסח שחוזר ממודל. המרה ליחיד נוגעת
   בפעלים ובכינויים, ולא במנגנונים: שדה שחזר בלי {{משתנה}} או עם
   מספר אחר של קטעים מותנים הוא שדה שבור — ההצעה תרנדר טקסט
   שגוי או תאבד נתון של הלקוח. כזה שדה נדחה ונשאר ברבים. */

export function varsIn(raw) {
  const out = []
  String(raw ?? '').replace(VAR_RE, (_m, n) => { out.push(n); return '' })
  return out.sort()
}

export function countOptionals(raw) {
  let n = 0
  String(raw ?? '').replace(OPT_RE, () => { n++; return '' })
  return n
}

/**
 * האם הנוסח שחזר שומר על המנגנונים של המקור.
 * @returns {null|string} null = תקין, אחרת סיבת הפסילה.
 */
export function validateConversion(before, after) {
  if (typeof after !== 'string' || after.trim() === '') return 'הנוסח חזר ריק'
  const a = varsIn(before), b = varsIn(after)
  if (a.join('|') !== b.join('|')) return `המשתנים השתנו (${a.join(',') || '—'} → ${b.join(',') || '—'})`
  if (countOptionals(before) !== countOptionals(after)) {
    return `מספר הקטעים המותנים השתנה (${countOptionals(before)} → ${countOptionals(after)})`
  }
  ALT_RE.lastIndex = 0
  if (ALT_RE.test(after)) return 'הנוסח חזר עם חלופת {יחיד|רבים}'
  return null
}
