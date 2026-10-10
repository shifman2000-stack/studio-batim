import { resolveText, isFilled } from './resolve.js'

/* ═══════════════════════════════════════════════════════════════════════
   עריכת התבנית עצמה — המרה חזרה מטקסט לדוגמה אל נוסח התבנית

   בעורך רגיל עינב עורכת **הצעה**, והטקסט שלה נשמר כמו שהוא. כאן היא
   עורכת את **התבנית**, ולכן מה שהיא מקלידה חייב לחזור להיות גנרי:
   "לקוח1 ולקוח2" צריך לחזור להיות {{firstNames}}, "נגבה" להיות
   {{settlement}}, ו"בואו נבנה לכם" צריך להתפצל חזרה ל-{בוא|בואו}.

   ⚠️ סדר הפעולות הוא **הפוך בדיוק** לסדר הפתירה ב-resolve.js
   (קטע מותנה → משתנה → דקדוק), ולכן כאן: דקדוק אחרון להרכבה, אבל
   המשתנים מוחזרים **לפני** הרכבת הדקדוק. זה לא קוסמטי: בשורת
   הפתיחה {{firstNames}} יושב מחוץ לחלופות, וערכו שונה ביחיד
   וברבים ("לקוח1" מול "לקוח1 ולקוח2"). אם נרכיב קודם את החלופות,
   ההבדל הזה ייראה כהבדל דקדוקי ונקבל {לקוח1|לקוח1 ולקוח2} במקום
   {{firstNames}} — התבנית תאבד את המשתנה ותיוולד עם שם הלקוח
   לדוגמה בתוכה.

   מה שעינב לא נגעה בו — **לא עובר כאן בכלל**. הנוסח המקורי מועתק
   מילה במילה, וכך אין שום סיכון של הלוך-ושוב על טקסט תקין.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── נתוני הדוגמה ─────────────────────────────────────────────────── */

export const SAMPLE = {
  name1: 'לקוח1',
  name2: 'לקוח2',
  settlement: 'נגבה',
  houseArea: '200',
  plotArea: '500',
  fee: 120000,
}

/** firstNames נגזר בדיוק כמו ב-deriveFirstNames: "א ו-ב" ללא מקף. */
export function sampleVars(twoClients) {
  return {
    firstNames: twoClients ? `${SAMPLE.name1} ו${SAMPLE.name2}` : SAMPLE.name1,
    settlement: SAMPLE.settlement,
    houseArea: SAMPLE.houseArea,
    plotArea: SAMPLE.plotArea,
    fee: SAMPLE.fee,
    clientPhone: '',
    clientEmail: '',
  }
}

export function sampleClients(twoClients) {
  const mk = (first) => ({ firstName: first, lastName: '', phone: '', email: '' })
  return twoClients ? [mk(SAMPLE.name1), mk(SAMPLE.name2)] : [mk(SAMPLE.name1)]
}

/* ── זיהוי מנגנונים בנוסח ─────────────────────────────────────────── */

const ALT_RE = /\{([^{}|]*)\|([^{}|]*)\}/g
const VAR_RE = /\{\{(\w+)\}\}/g
const OPT_RE = /\[\[([^[\]]*)\]\]/g

export const hasAlternates = raw => ALT_RE.test(String(raw ?? '')) && (ALT_RE.lastIndex = 0, true)
export const hasVariables = raw => VAR_RE.test(String(raw ?? '')) && (VAR_RE.lastIndex = 0, true)

/** שמות המשתנים שמופיעים בנוסח, לפי סדר הופעה, בלי כפילויות. */
export function varNamesIn(raw) {
  const out = []
  String(raw ?? '').replace(VAR_RE, (_m, n) => { if (!out.includes(n)) out.push(n); return '' })
  return out
}

/* ── החזרת ערכי הדוגמה למשתנים ────────────────────────────────────── */

/**
 * מחליף ערכי דוגמה בחזרה ל-{{שם}}.
 *
 * רק משתנים שהיו **בנוסח המקורי** מוחזרים. בלי התנאי הזה, עינב
 * שתכתוב "נגבה" בשדה שמעולם לא היה בו יישוב הייתה מקבלת תבנית
 * שמחליפה אותו לשם היישוב של כל לקוח.
 *
 * ההחלפה מהערך הארוך לקצר, כדי ש"לקוח1 ולקוח2" ייתפס לפני "לקוח1".
 */
export function detokenize(text, vars, allowedNames) {
  let out = String(text ?? '')
  const pairs = (allowedNames ?? Object.keys(vars ?? {}))
    .map(name => [name, vars?.[name]])
    .filter(([, v]) => isFilled(v))
    .map(([name, v]) => [name, String(v)])
    .sort((a, b) => b[1].length - a[1].length)

  for (const [name, value] of pairs) {
    out = out.split(value).join(`{{${name}}}`)
  }
  return out
}

/* ── הרכבת חלופות דקדוק ───────────────────────────────────────────── */

/** פיצול לאסימונים ששומר על רווחים, כדי שההרכבה תחזיר טקסט זהה. */
function tokenize(s) {
  return String(s ?? '').split(/(\s+)/).filter(t => t !== '')
}

/** LCS על אסימונים — בסיס ל"מה משותף ומה שונה". */
function lcsMatrix(a, b) {
  const m = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      m[i][j] = a[i] === b[j] ? m[i + 1][j + 1] + 1 : Math.max(m[i + 1][j], m[i][j + 1])
    }
  }
  return m
}

const FORBIDDEN = /[{}|]/

/**
 * מרכיב נוסח אחד עם חלופות {יחיד|רבים} משני ניסוחים.
 *
 * מקטעים זהים נשארים כמו שהם, ומקטעים שנבדלים נעטפים בחלופה.
 *
 * ⚠️ ה-resolver לא מרשה `{`, `}` או `|` בתוך חלופה, ולכן אם מקטע
 * שנבדל מכיל אחד מהם (למשל {{משתנה}} שנכנס רק לצד אחד) אי אפשר
 * לבנות חלופה תקינה. במקרה כזה מחזירים ok:false והקורא משאיר את
 * הנוסח המקורי — עדיף נוסח ישן מנוסח שבור.
 */
export function rebuildAlternates(singular, plural) {
  const a = tokenize(singular)
  const b = tokenize(plural)

  if (singular === plural) return { ok: true, raw: String(singular ?? '') }

  const m = lcsMatrix(a, b)
  const parts = []
  let i = 0, j = 0
  let da = [], db = []

  const flush = () => {
    if (!da.length && !db.length) return null
    const s = da.join(''), p = db.join('')
    if (FORBIDDEN.test(s) || FORBIDDEN.test(p)) {
      return `בנוסח הזה יש הבדל בין יחיד לרבים שנוגע במשתנה — לא ניתן לבנות ממנו חלופה`
    }
    parts.push(`{${s}|${p}}`)
    da = []; db = []
    return null
  }

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      const err = flush(); if (err) return { ok: false, reason: err }
      parts.push(a[i]); i++; j++
    } else if (m[i + 1][j] >= m[i][j + 1]) {
      da.push(a[i]); i++
    } else {
      db.push(b[j]); j++
    }
  }
  while (i < a.length) { da.push(a[i]); i++ }
  while (j < b.length) { db.push(b[j]); j++ }
  const err = flush(); if (err) return { ok: false, reason: err }

  return { ok: true, raw: parts.join('') }
}

/* ── החזרת קטעים מותנים ───────────────────────────────────────────── */

/**
 * עוטף בחזרה ב-[[ ]] כל קטע מותנה מהנוסח המקורי שנשאר זהה בטקסט
 * החדש. אחרי החזרת המשתנים הקטע חוזר להיות זהה תו-בתו למקור, ולכן
 * ההשוואה פשוטה.
 *
 * קטע שעינב ניסחה מחדש לא יזוהה — הוא פשוט יישאר טקסט רגיל, והשדה
 * יפסיק להיות מותנה. זה מדווח כאזהרה ולא נכשל בשקט.
 */
export function rewrapOptional(raw, originalRaw) {
  let out = String(raw ?? '')
  const lost = []
  const segments = []
  String(originalRaw ?? '').replace(OPT_RE, (_m, inner) => { segments.push(inner); return '' })

  for (const inner of segments) {
    if (!inner) continue
    if (out.includes(`[[${inner}]]`)) continue
    if (out.includes(inner)) out = out.replace(inner, `[[${inner}]]`)
    else lost.push(inner)
  }
  return { raw: out, lost }
}

/* ── ההמרה המלאה ──────────────────────────────────────────────────── */

/**
 * ממיר את מה שעינב רואה בחזרה לנוסח תבנית.
 *
 * @param {object}  a
 * @param {string}  a.originalRaw   הנוסח בתבנית לפני העריכה
 * @param {string}  a.singularText  הטקסט כפי שנערך, בלשון יחיד
 * @param {string}  [a.pluralText]  הטקסט כפי שנערך, בלשון רבים (רק לשדה דקדוקי)
 * @returns {{ raw: string, warnings: string[] }}
 */
export function toTemplateRaw({ originalRaw, singularText, pluralText }) {
  const warnings = []
  const names = varNamesIn(originalRaw)
  const vs = sampleVars(false)
  const vp = sampleVars(true)

  const s = detokenize(singularText, vs, names)
  const alt = hasAlternates(originalRaw)
  const p = alt ? detokenize(pluralText ?? singularText, vp, names) : s

  let raw
  if (alt) {
    const built = rebuildAlternates(s, p)
    if (!built.ok) {
      warnings.push(built.reason)
      return { raw: String(originalRaw ?? ''), warnings }
    }
    raw = built.raw
  } else {
    raw = s
  }

  const wrapped = rewrapOptional(raw, originalRaw)
  for (const seg of wrapped.lost) {
    warnings.push(`הקטע "${resolveText(seg, vs, 1).trim()}" היה מותנה בשדה רשות, ומעכשיו יופיע תמיד`)
  }
  return { raw: wrapped.raw, warnings }
}

/** שני הניסוחים שמוצגים בשדה דקדוקי — יחיד ורבים, פתורים. */
export function grammarBoxes(raw) {
  return {
    singular: resolveText(raw, sampleVars(false), 1),
    plural: resolveText(raw, sampleVars(true), 2),
  }
}

/* ── מה השתנה בתבנית ──────────────────────────────────────────────── */

const SEC_LABEL = {
  opening: 'פתיחה', scope: 'תכולת השירות', fee: 'המחיר',
  stages: 'השלבים', extras: 'שירותים משלימים', terms: 'התנאים', signing: 'חתימה',
}

const listOf = (sec) => sec?.type === 'terms'
  ? (sec.groups ?? []).flatMap(g => g.items ?? [])
  : (sec?.items ?? [])

const nameOf = (sec, it) => sec?.type === 'stages' ? (it.formalName || 'שלב ללא שם')
  : sec?.type === 'terms' ? (it.formalTitle || it.question || 'תנאי')
    : (it.title || 'פריט')

/** תיאור קצר וקריא של ההבדלים בין שתי תבניות, לדיאלוג האישור. */
export function describeTemplateDiff(before, after) {
  const out = []
  const bSec = new Map((before?.sections ?? []).map(s => [s.id, s]))
  const aSec = new Map((after?.sections ?? []).map(s => [s.id, s]))

  for (const [id, sec] of aSec) {
    const old = bSec.get(id)
    const label = SEC_LABEL[sec.type] ?? sec.type
    if (!old) { out.push(`נוסף סעיף: ${label}`); continue }

    const oldItems = new Map(listOf(old).map(i => [i.id, i]))
    const newItems = new Map(listOf(sec).map(i => [i.id, i]))
    for (const [iid, it] of newItems) {
      if (!oldItems.has(iid)) out.push(`נוסף ב${label}: ${nameOf(sec, it)}`)
      else if (JSON.stringify(oldItems.get(iid)) !== JSON.stringify(it)) out.push(`נערך ב${label}: ${nameOf(sec, it)}`)
    }
    for (const [iid, it] of oldItems) {
      if (!newItems.has(iid)) out.push(`הוסר מ${label}: ${nameOf(old, it)}`)
    }

    /* טקסטים ברמת הסעיף — בלי items/groups, שכבר נספרו למעלה. */
    const strip = (o) => {
      const c = { ...o }; delete c.items; delete c.groups; return JSON.stringify(c)
    }
    if (strip(old) !== strip(sec)) out.push(`נערך נוסח: ${label}`)
  }
  for (const [id, sec] of bSec) {
    if (!aSec.has(id)) out.push(`הוסר סעיף: ${SEC_LABEL[sec.type] ?? sec.type}`)
  }
  return out
}

/* ── בניית התבנית מתוך מצב העורך ──────────────────────────────────── */

/** מפתחות שהם נתוני הצעה ולא תבנית. */
const QUOTE_ONLY = ['clients', 'property', 'vars', 'totals', 'clientResponse', 'meta', 'evidence']

const TEXT_FIELDS_SKIP = new Set(['id', 'type', 'libraryId', 'enabled', 'pct'])

/**
 * בונה את תוכן התבנית החדש ממצב העורך.
 *
 * ⚠️ שדה שעינב **לא** נגעה בו מועתק כמו שהוא — הוא כבר מכיל את
 * נוסח התבנית המקורי על כל האסימונים שבו, ואין שום סיבה להעביר
 * אותו דרך המרה. רק שדות ערוכים עוברים המרה, ורק להם יש סיכון.
 *
 * @param {object} content      content_v2 כפי שהוא בעורך (עם נתוני דוגמה)
 * @param {object} meta         { edited: string[], origRaw: {}, plural: {} }
 * @returns {{ content: object, warnings: string[] }}
 */
export function buildTemplateFromEditor(content, meta) {
  const warnings = []
  const edited = new Set(meta?.edited ?? [])
  const origRaw = meta?.origRaw ?? {}
  const plural = meta?.plural ?? {}

  const convert = (ownerId, obj) => {
    const out = { ...obj }
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== 'string' || TEXT_FIELDS_SKIP.has(k)) continue
      const path = `${ownerId}.${k}`
      if (!edited.has(path)) continue
      const original = origRaw[path] ?? v
      const r = toTemplateRaw({
        originalRaw: original,
        singularText: v,
        pluralText: plural[path] ?? v,
      })
      out[k] = r.raw
      for (const w of r.warnings) warnings.push(`${path}: ${w}`)
    }
    return out
  }

  const sections = (content?.sections ?? []).map(sec => {
    const next = convert(sec.id, sec)
    if (Array.isArray(sec.items)) next.items = sec.items.map(it => convert(it.id, it))
    if (Array.isArray(sec.groups)) {
      next.groups = sec.groups.map(g => ({
        ...convert(g.id, g),
        items: (g.items ?? []).map(it => convert(it.id, it)),
      }))
    }
    return next
  })

  const out = { ...content, sections }
  for (const k of QUOTE_ONLY) delete out[k]
  return { content: out, warnings }
}
