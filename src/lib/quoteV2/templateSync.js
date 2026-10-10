/* ═══════════════════════════════════════════════════════════════════════
   "לעדכן גם את התבנית לפעם הבאה?" — מסמך התכנון, C.4 (החלטה 35)

   ההתאמה היא **לפי ה-id** של הסעיף/הפריט, לא לפי מיקום ולא לפי
   libraryId. ה-id מועתק מהתבנית לתוך ההצעה ביצירה ואינו משתנה
   אחר כך, ולכן הוא מה שמחבר סעיף בהצעה לסעיף המקביל בתבנית.

   ⚠️ שני כללים שקובעים את ההתנהגות, ושווה לדעת עליהם:

   1. **נתוני ההצעה אף פעם לא נכנסים לתבנית.** clients, vars,
      property, totals, clientResponse, meta — כולם פר-הצעה. תבנית
      שתקלוט אותם תפתח את ההצעה הבאה עם השם והמחיר של הקודמת.

   2. **עדכון ותוספת, לעולם לא מחיקה.** סעיף או פריט שקיים בתבנית
      ואינו בהצעה — נשאר בתבנית. הסרת שלב בהצעה אחת היא כמעט תמיד
      החלטה פר-הצעה, ומחיקה שקטה מהתבנית היא נזק שקשה לגלות ועוד
      יותר קשה לבטל. מי שרוצה להוציא משהו מהתבנית — יעשה זאת במסך
      התבנית, במפורש.

   היקף ההשפעה (החלטה 14): עדכון תבנית משפיע על **הצעות חדשות
   בלבד**. טיוטות קיימות כבר העתיקו את התוכן אליהן ואינן זזות.
   ═══════════════════════════════════════════════════════════════════════ */

/** מפתחות ברמת ה-content ששייכים להצעה ולא לתבנית. */
const QUOTE_ONLY_KEYS = [
  'clients', 'property', 'vars', 'totals', 'clientResponse', 'meta', 'evidence',
]

/** מפתחות בתוך סעיף/פריט שאסור להעתיק לתבנית. */
const PER_QUOTE_FIELDS = ['libraryId']

/** מפתחות שמנוהלים כאילו היו מבנה ולא טקסט — מטופלים בנפרד. */
const STRUCTURAL = ['id', 'items', 'groups']

function isPlainValue(v) {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v)
}

/** מעתיק את שדות התוכן של src אל dst, בלי מבנה ובלי שדות פר-הצעה. */
function mergeFields(dst, src) {
  const out = { ...dst }
  for (const [k, v] of Object.entries(src)) {
    if (STRUCTURAL.includes(k) || PER_QUOTE_FIELDS.includes(k)) continue
    if (!isPlainValue(v)) continue
    out[k] = v
  }
  return out
}

/**
 * ממזג רשימת פריטים: פריט עם id מוכר מתעדכן, פריט חדש נוסף בסוף,
 * פריט שקיים רק בתבנית נשאר במקומו.
 */
function mergeItems(tplItems, quoteItems, mergeOne) {
  const tpl = Array.isArray(tplItems) ? tplItems : []
  const q = Array.isArray(quoteItems) ? quoteItems : []
  const byId = new Map(q.map(it => [it?.id, it]))

  const merged = tpl.map(it => {
    const from = byId.get(it?.id)
    return from ? mergeOne(it, from) : it
  })
  const known = new Set(tpl.map(it => it?.id))
  for (const it of q) {
    if (!known.has(it?.id)) merged.push(it)
  }
  return merged
}

function mergeGroup(tplGroup, quoteGroup) {
  return {
    ...mergeFields(tplGroup, quoteGroup),
    id: tplGroup.id,
    items: mergeItems(tplGroup.items, quoteGroup.items, (a, b) => ({ ...mergeFields(a, b), id: a.id })),
  }
}

function mergeSection(tplSec, quoteSec) {
  const out = { ...mergeFields(tplSec, quoteSec), id: tplSec.id }
  if (Array.isArray(tplSec.items) || Array.isArray(quoteSec.items)) {
    out.items = mergeItems(tplSec.items, quoteSec.items, (a, b) => ({ ...mergeFields(a, b), id: a.id }))
  }
  if (Array.isArray(tplSec.groups) || Array.isArray(quoteSec.groups)) {
    out.groups = mergeItems(tplSec.groups, quoteSec.groups, mergeGroup)
  }
  return out
}

/**
 * התוכן החדש של התבנית, אחרי קליטת ההצעה.
 *
 * @param {object} template  quote_templates.content הנוכחי
 * @param {object} quote     content_v2 של ההצעה
 * @returns {object} תוכן תבנית חדש — הקלט לא משתנה
 */
export function buildTemplateUpdate(template, quote) {
  if (!template?.sections) throw new Error('buildTemplateUpdate: תבנית ללא sections')
  const quoteSections = Array.isArray(quote?.sections) ? quote.sections : []
  const bySecId = new Map(quoteSections.map(s => [s?.id, s]))

  const sections = template.sections.map(sec => {
    const from = bySecId.get(sec?.id)
    return from ? mergeSection(sec, from) : sec
  })
  const known = new Set(template.sections.map(s => s?.id))
  for (const s of quoteSections) {
    if (!known.has(s?.id)) sections.push(s)
  }

  const out = { ...template, sections }
  for (const k of QUOTE_ONLY_KEYS) delete out[k]
  return out
}

/* ── מה השתנה לעומת התבנית ────────────────────────────────────────── */

/** שדות שלא נחשבים "שינוי ניסוח" לצורך התצוגה. */
const IGNORED_IN_DIFF = new Set(['id', 'libraryId', 'enabled', 'pct'])

function diffFields(tplObj, quoteObj, label, out) {
  for (const [k, v] of Object.entries(quoteObj)) {
    if (IGNORED_IN_DIFF.has(k) || STRUCTURAL.includes(k)) continue
    if (!isPlainValue(v)) continue
    if (tplObj[k] !== v) out.push({ label, field: k, id: quoteObj.id })
  }
}

/**
 * רשימה קצרה של מה שונה בהצעה לעומת התבנית — לשורת ההסבר בדיאלוג
 * השליחה. מחזירה פריטים, לא שדות בודדים, כדי שהמשפט יישאר קריא.
 */
export function describeTemplateChanges(template, quote) {
  const out = []
  const bySecId = new Map((template?.sections ?? []).map(s => [s?.id, s]))

  for (const sec of quote?.sections ?? []) {
    const tplSec = bySecId.get(sec?.id)
    if (!tplSec) { out.push({ label: 'סעיף חדש', field: '', id: sec?.id }); continue }
    diffFields(tplSec, sec, sectionLabel(sec), out)

    const tplItems = new Map((tplSec.items ?? []).map(i => [i?.id, i]))
    for (const it of sec.items ?? []) {
      const t = tplItems.get(it?.id)
      if (!t) { out.push({ label: itemLabel(sec, it), field: 'חדש', id: it?.id }); continue }
      diffFields(t, it, itemLabel(sec, it), out)
    }

    const tplGroups = new Map((tplSec.groups ?? []).map(g => [g?.id, g]))
    for (const g of sec.groups ?? []) {
      const tg = tplGroups.get(g?.id)
      if (!tg) { out.push({ label: `נושא: ${g?.title ?? ''}`, field: 'חדש', id: g?.id }); continue }
      diffFields(tg, g, `נושא: ${g?.title ?? ''}`, out)
      const tplTerms = new Map((tg.items ?? []).map(i => [i?.id, i]))
      for (const it of g.items ?? []) {
        const t = tplTerms.get(it?.id)
        if (!t) { out.push({ label: `תנאי: ${it?.formalTitle || it?.question || ''}`, field: 'חדש', id: it?.id }); continue }
        diffFields(t, it, `תנאי: ${it?.formalTitle || it?.question || ''}`, out)
      }
    }
  }

  /* פריט אחד עם שלושה שדות שונים הוא שינוי אחד בעיני עינב. */
  const seen = new Set()
  return out.filter(c => {
    const key = c.id + '|' + c.label
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function sectionLabel(sec) {
  return ({
    opening: 'פתיחה', scope: 'תכולת השירות', fee: 'המחיר',
    stages: 'השלבים', extras: 'שירותים משלימים', terms: 'התנאים', signing: 'חתימה',
  })[sec?.type] ?? (sec?.type ?? 'סעיף')
}

function itemLabel(sec, it) {
  if (sec?.type === 'stages') return `שלב: ${it?.formalName ?? ''}`
  if (sec?.type === 'extras') return `תוספת: ${it?.title ?? ''}`
  return it?.title ?? it?.formalTitle ?? 'פריט'
}
