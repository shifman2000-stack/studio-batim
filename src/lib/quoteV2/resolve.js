/* ═══════════════════════════════════════════════════════════════════════
   content_v2 — פתרון טקסט
   מסמך התכנון: docs/quote-v2-design.md — פרקים A.6 (דקדוק) ו-A.7 (שדות רשות)

   שלושה מנגנונים, בסדר הזה בדיוק:

     1. [[קטע מותנה]]  — נמחק כולו אם משתנה כלשהו שבתוכו ריק
     2. {{משתנה}}      — מוחלף בערך
     3. {יחיד|רבים}    — נבחר לפי מספר הלקוחות

   ⚠️ הסדר אינו עניין של טעם. אם המשתנים היו נפתרים ראשונים,
   `[[ של כ-{{houseArea}} מ״ר]]` היה הופך ל-`[[ של כ- מ״ר]]` ולא היה
   נשאר שום מידע על כך שהשדה היה ריק מלכתחילה.

   הפונקציות כאן טהורות: בלי React, בלי DOM, בלי גישה ל-DB.
   ═══════════════════════════════════════════════════════════════════════ */

/** ריק = null / undefined / מחרוזת שכולה רווחים. 0 אינו ריק. */
export function isFilled(value) {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  return true
}

/**
 * פותר טקסט אחד של content_v2.
 *
 * @param {string}  raw          הטקסט הגולמי, עם או בלי תחביר
 * @param {object}  vars         { firstNames, settlement, houseArea, plotArea, … }
 * @param {number}  clientCount  1 = לקוח אחד · 2+ = לשון רבים
 * @returns {string}
 *
 * עמיד בפני: טקסט בלי תחביר כלל, שורות חדשות, וטקסט שנראה כמו JSON
 * (`{"a": 1}` לא מכיל `|` ולכן אינו חלופה, ונשאר כמו שהוא).
 */
export function resolveText(raw, vars = {}, clientCount = 1) {
  if (raw === null || raw === undefined) return ''
  let text = String(raw)

  // ── 1. קטעים מותנים. מחלקות התווים תופסות גם \n, ולכן קטע
  //       שנפרש על כמה שורות עדיין נתפס. אין קינון: [^\[\]] עוצר
  //       בסוגר הראשון, וקטע מקונן פשוט יישאר כמו שהוא (נחסם
  //       בוולידציה של העורך, לא כאן).
  text = text.replace(/\[\[([^[\]]*)\]\]/g, (_match, inner) => {
    const names = []
    inner.replace(/\{\{(\w+)\}\}/g, (_m, name) => { names.push(name); return '' })
    // קטע בלי משתנה בפנים לעולם לא יימחק — הוא תמיד טעות הקלדה,
    // אבל הפותר לא מפיל כלום: הוא פשוט מסיר את הסוגריים.
    if (names.length === 0) return inner
    return names.every(name => isFilled(vars[name])) ? inner : ''
  })

  // ── 2. משתנים. משתנה חסר נמחק ולא מודפס כ-undefined.
  text = text.replace(/\{\{(\w+)\}\}/g, (_match, name) =>
    isFilled(vars[name]) ? String(vars[name]) : '')

  // ── 3. חלופות דקדוק. בדיוק קו אנכי אחד, בלי סוגריים בפנים —
  //       ולכן `{"a": 1}` ו-`{}` אינם נתפסים.
  text = text.replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_match, one, many) =>
    clientCount > 1 ? many : one)

  return text
}

/**
 * "דנה" · "דנה ויואב" — מה שמוזרק ל-{{firstNames}}.
 * שמות ריקים נופלים החוצה, כדי ששדה לקוח שני ריק לא ייצור "דנה ו".
 */
export function deriveFirstNames(names = []) {
  const clean = names.filter(isFilled).map(n => String(n).trim())
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  return clean.slice(0, -1).join(', ') + ' ו' + clean[clean.length - 1]
}

/** עזר לרכיבים: האם להציג תווית שתלויה במשתנה אחד. */
export function labelIfFilled(vars, name, build) {
  return isFilled(vars?.[name]) ? build(vars[name]) : null
}
