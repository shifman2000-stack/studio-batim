import { supabase } from '../../supabaseClient'
import { collectTextFields, applyTextFields, validateConversion } from './plural'

/* ═══════════════════════════════════════════════════════════════════════
   המרת הצעה ללקוח יחיד

   התבנית כתובה ברבים. הצעה עם מזמין אחד מומרת ליחיד פעם אחת,
   ביצירתה, ואחר כך הטקסט הוא טקסט רגיל שאפשר לערוך.

   ⚠️ ההמרה לעולם לא חוסמת פתיחת הצעה. כישלון מחזיר ok:false,
   ההצעה נשארת ברבים, והעורך מציג "נסה שוב".
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} content  content_v2 ברבים
 * @param {object} opts     { firstName, gender }
 * @returns {Promise<{ok:boolean, content?:object, gender?:string,
 *                     rejected?:Array, error?:string}>}
 */
export async function singularizeContent(content, { firstName, gender = null } = {}) {
  const fields = collectTextFields(content)
  if (!fields.length) return { ok: true, content, gender: gender ?? 'm', rejected: [] }

  let token = ''
  try {
    const { data: { session } } = await supabase.auth.getSession()
    token = session?.access_token ?? ''
  } catch { /* אין סשן — הקריאה תיפול על 401 ותטופל כמו כל כישלון */ }

  let res
  try {
    res = await fetch('/api/quote-singularize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields, firstName, gender }),
    })
  } catch (e) {
    return { ok: false, error: e?.message || 'השירות לא נענה' }
  }

  const out = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: out.error || `שגיאה ${res.status}` }
  if (!Array.isArray(out.fields)) return { ok: false, error: 'תשובה לא תקינה' }

  /* ⚠️ אימות שני, אצל הלקוח. השרת כבר סינן, אבל התוכן הזה נכנס
     ל-draft_content ומשם ל-PDF חתום — ושכבה שנייה כאן עולה
     כלום. שדה שנפסל פשוט לא נכתב ונשאר ברבים. */
  const before = new Map(fields.map(f => [f.path, f.text]))
  const safe = []
  const rejected = [...(out.rejected ?? [])]
  for (const f of out.fields) {
    const src = before.get(f.path)
    if (src === undefined) { rejected.push({ path: f.path, reason: 'path לא מוכר' }); continue }
    const why = validateConversion(src, f.text)
    if (why) { rejected.push({ path: f.path, reason: why }); continue }
    safe.push(f)
  }

  return {
    ok: true,
    content: applyTextFields(content, safe),
    gender: out.gender === 'f' ? 'f' : 'm',
    rejected,
  }
}

/**
 * ההמרה המלאה כפי שמשתמשים בה בשני המקומות — יצירת הצעה ומתג
 * המגדר בעורך. מחזירה content מוכן לשמירה, עם clientGender.
 *
 * ⚠️ ‎pluralSource הוא תמיד הנוסח **ברבים**, ולא התוכן הנוכחי:
 * המרה של טקסט שכבר הומר הייתה מצטברת על עצמה.
 */
export async function singularizeForClient(pluralSource, { firstName, gender = null } = {}) {
  const r = await singularizeContent(pluralSource, { firstName, gender })
  if (!r.ok) return r
  return {
    ...r,
    content: { ...r.content, clientGender: r.gender },
  }
}
