// api/quote-singularize.js — Vercel Serverless Function
//
// ממיר נוסחי הצעה מפנייה ברבים לפנייה ליחיד, בזכר או בנקבה.
// POST { fields: [{path, text}], firstName, gender: 'm'|'f'|null }
// מחזיר { gender, fields: [{path, text}], rejected: [{path, reason}] }.
//
// ⚠️ אותם שלושה כללי אבטחה של api/template-assistant.js:
// 1. ANTHROPIC_API_KEY לא יוצא מהשרת ולא נכתב ללוג.
// 2. האימות עם מפתח ה-anon והטוקן של המשתמש/ת — לא service-role,
//    שלא קיים ב-Preview, וזו הסביבה שבה בודקים.
// 3. המודל לא כותב לתוכן. הוא מחזיר נוסחים, וכל אחד מהם מאומת
//    כאן מול המקור; נוסח שאיבד {{משתנה}} או [[קטע מותנה]] נדחה
//    והשדה נשאר ברבים.
//
// ⚠️ ההבדל היחיד מהעוזר: כאן **כל אנשי הצוות** מורשים, לא רק
// admin. יצירת הצעה היא פעולה יומיומית של הצוות, והמרה שנכשלת
// על הרשאה הייתה משאירה הצעה ברבים ללקוח יחיד בלי שאיש יבין למה.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const MODEL = 'claude-sonnet-5-5'
const MAX_TOKENS = 16000

/* אותה הגבלת קצב של העוזר: חלון שעה, בזיכרון התהליך. */
const RATE = { windowMs: 60 * 60 * 1000, max: 30 }
const hits = new Map()

function rateLimited(userId) {
  const now = Date.now()
  const arr = (hits.get(userId) ?? []).filter(t => now - t < RATE.windowMs)
  if (arr.length >= RATE.max) return true
  arr.push(now)
  hits.set(userId, arr)
  return false
}

/* ── אימות הנוסח שחוזר ──────────────────────────────────────────
   ⚠️ משוכפל מ-src/lib/quoteV2/plural.js בכוונה. פונקציות ה-api
   של Vercel נארזות בנפרד מה-bundle של הלקוח, וייבוא מתוך src/
   עובד בפיתוח ונשבר בפריסה. שתי הבדיקות זהות ושתיהן מכוסות
   בבדיקות; אם אחת משתנה, השנייה חייבת להשתנות איתה. */
const VAR_RE = /\{\{(\w+)\}\}/g
const OPT_RE = /\[\[([^[\]]*)\]\]/g
const ALT_RE = /\{([^{}|]*)\|([^{}|]*)\}/g

const varsIn = (raw) => {
  const out = []
  String(raw ?? '').replace(VAR_RE, (_m, n) => { out.push(n); return '' })
  return out.sort()
}
const countOptionals = (raw) => {
  let n = 0
  String(raw ?? '').replace(OPT_RE, () => { n++; return '' })
  return n
}
function validateConversion(before, after) {
  if (typeof after !== 'string' || after.trim() === '') return 'הנוסח חזר ריק'
  const a = varsIn(before), b = varsIn(after)
  if (a.join('|') !== b.join('|')) return 'המשתנים השתנו'
  if (countOptionals(before) !== countOptionals(after)) return 'מספר הקטעים המותנים השתנה'
  ALT_RE.lastIndex = 0
  if (ALT_RE.test(after)) return 'הנוסח חזר עם חלופת {יחיד|רבים}'
  return null
}

const SYSTEM = `את/ה ממיר/ה נוסחים של הצעת מחיר מסטודיו אדריכלות.

הנוסחים כתובים בפנייה **ללקוחות רבים** ("בואו נבנה לכם בית").
המשימה: להמיר אותם לפנייה **ללקוח יחיד**, במגדר שיימסר לך.

## מה מותר לשנות
אך ורק את המספר והמגדר של הפנייה בגוף שני: פעלים, כינויי גוף,
כינויי שייכות וסיומות. "בואו" → "בוא"/"בואי". "לכם" → "לך".
"שאתם שואלים" → "שאתה שואל"/"שאת שואלת".

## מה אסור לשנות — אף תו
1. **הניסוח עצמו.** אותן מילים, אותו סדר, אותו סגנון. אל תשפר/י,
   אל תקצר/י ואל תחליף/י מילים נרדפות.
2. **פיסוק, רווחים ושורות חדשות.** ‎\\n נשאר בדיוק במקומו.
3. **{{משתנה}}** — כל משתנה חייב לחזור, מאויית בדיוק אותו דבר
   ובאותו מקום. הקיימים: firstNames, settlement, houseArea,
   plotArea, fee.
4. **[[קטע מותנה]]** — הסוגריים הכפולים נשארים בדיוק במקומם,
   ומספרם זהה. את תוכן הקטע מותר להמיר לפנייה ביחיד.
5. אין להוסיף **{יחיד|רבים}** — התחביר הזה בוטל.

## גוף שלישי
משפט שאינו פונה ללקוח ("הסטודיו מחויב…", "התשלום יהיה בש״ח")
חוזר כמות שהוא, מילה במילה.

## פלט
קרא/י לכלי convert עם כל השדות שקיבלת, לפי אותו path בדיוק.`

const TOOL = {
  name: 'convert',
  description: 'מחזיר את הנוסחים אחרי ההמרה ליחיד.',
  input_schema: {
    type: 'object',
    required: ['gender', 'fields'],
    properties: {
      gender: {
        type: 'string',
        enum: ['m', 'f'],
        description: 'המגדר שבו הומרו הנוסחים. אם נמסר מגדר — אותו מגדר; '
          + 'אם לא נמסר — המגדר שנגזר מהשם הפרטי.',
      },
      fields: {
        type: 'array',
        description: 'שדה לכל path שהתקבל, באותו סדר.',
        items: {
          type: 'object',
          required: ['path', 'text'],
          properties: {
            path: { type: 'string', description: 'אותו path שהתקבל, מילה במילה' },
            text: { type: 'string', description: 'הנוסח אחרי ההמרה ליחיד' },
          },
        },
      },
    },
  },
}

const bad = (res, code, message) => res.status(code).json({ error: message })

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return bad(res, 405, 'Method not allowed')
  }

  try {
    if (!process.env.ANTHROPIC_API_KEY) return bad(res, 503, 'ההמרה לא מוגדרת.')
    if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
      return bad(res, 500, 'השרת לא מוגדר: חסרים פרטי Supabase.')
    }

    /* ── אימות המשתמש/ת ── */
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return bad(res, 401, 'חסר אימות. יש להתחבר מחדש.')

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.VITE_SUPABASE_ANON_KEY,
      { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } }
    )
    const { data: userData, error: userErr } = await supabase.auth.getUser(token)
    if (userErr || !userData?.user) return bad(res, 401, 'האימות נכשל. יש להתחבר מחדש.')

    /* ⚠️ כל משתמש/ת עם פרופיל — לא רק admin. */
    const { data: profile } = await supabase
      .from('profiles').select('id').eq('id', userData.user.id).maybeSingle()
    if (!profile) return bad(res, 403, 'אין הרשאה.')

    if (rateLimited(userData.user.id)) {
      return bad(res, 429, 'יותר מדי המרות בשעה האחרונה. כדאי לנסות עוד קצת.')
    }

    /* ── קלט ── */
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const { fields, firstName, gender } = body || {}
    if (!Array.isArray(fields) || !fields.length) return bad(res, 400, 'אין שדות להמרה.')
    if (fields.length > 400) return bad(res, 400, 'יותר מדי שדות.')
    const wanted = gender === 'm' || gender === 'f' ? gender : null

    const ask = wanted
      ? `המגדר: ${wanted === 'f' ? 'נקבה' : 'זכר'}. החזר/י אותו ב-gender.`
      : `המגדר לא נמסר. גזור/י אותו מהשם הפרטי "${String(firstName ?? '').slice(0, 60)}" `
        + `— ואם אינו חד-משמעי, בחר/י זכר. החזר/י את מה שבחרת ב-gender.`

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: `${ask}\n\nהשדות להמרה:\n\n`
          + JSON.stringify(fields.map(f => ({ path: f.path, text: String(f.text ?? '') }))),
      }],
    })

    if (response.stop_reason === 'refusal') return bad(res, 400, 'ההמרה נדחתה.')

    let out = null
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'convert') out = block.input
    }
    if (!out || !Array.isArray(out.fields)) return bad(res, 502, 'ההמרה חזרה ריקה.')

    /* ── אימות שדה-שדה ── */
    const byPath = new Map(out.fields.map(f => [f.path, f.text]))
    const kept = []
    const rejected = []
    for (const f of fields) {
      const after = byPath.get(f.path)
      const why = after === undefined ? 'השדה לא חזר' : validateConversion(f.text, after)
      if (why) { rejected.push({ path: f.path, reason: why }); continue }
      kept.push({ path: f.path, text: after })
    }

    return res.status(200).json({
      gender: out.gender === 'f' ? 'f' : 'm',
      fields: kept,
      rejected,
      usage: {
        input: response.usage?.input_tokens ?? 0,
        output: response.usage?.output_tokens ?? 0,
      },
    })
  } catch (err) {
    console.error('quote-singularize:', err?.name, err?.status, err?.message)
    if (err instanceof Anthropic.AuthenticationError) return bad(res, 503, 'ההמרה לא מוגדרת נכון.')
    if (err instanceof Anthropic.RateLimitError) return bad(res, 429, 'השירות עמוס כרגע. כדאי לנסות שוב בעוד רגע.')
    if (err instanceof Anthropic.APIError) return bad(res, 502, 'שירות ההמרה לא זמין כרגע.')
    return bad(res, 500, 'שגיאה בהמרה.')
  }
}
