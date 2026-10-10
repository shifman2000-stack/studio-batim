// api/template-assistant.js — Vercel Serverless Function
//
// העוזר של עינב לעריכת טופס הצעת המחיר. POST { messages, content }
// מחזיר { reply, edits }.
//
// ⚠️ שלושה כללי אבטחה שקובעים את המבנה כאן:
//
// 1. המפתח של Anthropic לא יוצא מהשרת לעולם, ולא נכתב ללוג. הלקוח
//    שולח רק את השיחה ואת התוכן; המפתח נקרא מ-ANTHROPIC_API_KEY.
// 2. האימות נעשה עם **מפתח ה-anon** והטוקן של המשתמשת, ולא עם
//    service-role. ב-Preview אין service-role, ועוזר שמסתמך עליו
//    פשוט לא עובד שם — וזו הסביבה שבה בודקים אותו.
// 3. המודל **לא כותב לתוכן**. הוא מציע פעולות ממוקדות-id, והלקוח
//    מאמת כל אחת מהן מול templateAssist לפני שהיא מוצגת. נוסח
//    שמאבד {{משתנה}} או שובר {יחיד|רבים} נזרק עוד לפני שעינב רואה
//    אותו.

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

/* הדגם: Sonnet הנוכחי. המשימה היא עריכת ניסוח קצרה ומובנית, לא
   חשיבה ארוכה — ולכן effort בינוני ומכסת טוקנים צנועה. */
const MODEL = 'claude-sonnet-5-5'
const MAX_TOKENS = 8000

/* הגבלת קצב פשוטה, בזיכרון התהליך. לא מושלם (Vercel מרים כמה
   מופעים), אבל חוסם לולאה של לחיצות מאותה משתמשת. */
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

const SYSTEM = `את/ה עוזר/ת עריכה של "סטודיו בתים" — סטודיו אדריכלות של עינב שיפמן.
עינב עורכת כאן את **טופס הצעת המחיר**: הנוסח שממנו נולדת כל הצעה חדשה ללקוח.

## המבנה
ההצעה היא מסמך אחד עם שני פנים:
· 📄 **הפן הכתוב** — המסמך המחייב משפטית שהלקוח חותם עליו.
· 📱 **הפן השיווקי** — מסע גלילה בטלפון.
שניהם נגזרים מאותו תוכן. לכל סעיף id יציב.

סוגי סעיפים: opening (פתיחה), scope (תכולת השירות), fee (המחיר),
stages (שלבי העבודה — items), extras (שירותים משלימים — items),
terms (תנאי ההתקשרות — groups ובתוכם items), signing (חתימה).

שדות 📄 מחייבים: scope.body · stage.formalName/process/output/trigger/duration ·
term.formalTitle/body · כל שדה שמתחיל ב-pdf · fee.feeLabel/tableIntro · signing.pdfText/closing.
שדות 📱 שיווקיים: stage.storyTitle/storyBody/storyDeliverable/shortLabel ·
term.question/marketingAnswer · opening.greeting/intro · extras.title/sub.

## שלושה מנגנוני תחביר — חובה לשמר אותם במדויק
1. **{{משתנה}}** — מוחלף בנתוני הלקוח. הקיימים: firstNames, settlement,
   houseArea, plotArea, fee. **אסור להשמיט משתנה שהיה בנוסח.**
2. **{יחיד|רבים}** — חלופת דקדוק לפי מספר הלקוחות. לדוגמה
   "{בוא|בואו} נבנה". אסור לשים בתוכה { } או |.
3. **[[קטע מותנה]]** — נעלם כששדה רשות ריק. חייב להכיל {{משתנה}}
   בתוכו, אחרת הוא לעולם לא ייעלם. לדוגמה "בית[[ של כ-{{houseArea}} מ״ר]]".

אם נוסח מכיל משתנה או חלופה — החזר/י אותם בנוסח החדש, באותו מקום הגיוני.

## איך לעבוד
· שנה/י **רק** את מה שהתבקש. עריכה מינימלית עדיפה תמיד.
· אל תיגע/י בסעיפים שלא קשורים לבקשה.
· אם הבקשה **עמומה** — שאל/י שאלת הבהרה אחת קצרה ואל תציע/י עריכות.
· שינוי בשדה 📄 מחייב — ציין/י זאת ב-reason.
· ענה/י תמיד בעברית, קצר וענייני.
· כשיש עריכות להציע, קרא/י לכלי propose_edits. אחרת ענה/י בטקסט בלבד.`

const TOOL = {
  name: 'propose_edits',
  description: 'מציע עריכות ממוקדות לטופס הצעת המחיר. כל עריכה מצביעה על id קיים.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['edits'],
    properties: {
      edits: {
        type: 'array',
        description: 'רשימת העריכות המוצעות, לפי הסדר שבו יש להחיל אותן.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'sectionId', 'reason'],
          properties: {
            kind: {
              type: 'string',
              enum: ['set_text', 'set_pct', 'add_item', 'remove_item', 'move_item',
                'add_group', 'rename_group', 'remove_group'],
            },
            sectionId: { type: 'string', description: 'ה-id של הסעיף' },
            groupId: { type: 'string', description: 'ה-id של נושא התנאים, כשרלוונטי' },
            itemId: { type: 'string', description: 'ה-id של השלב/התנאי/התוספת, כשרלוונטי' },
            field: { type: 'string', description: 'שם השדה ל-set_text ול-rename_group' },
            newText: { type: 'string', description: 'הנוסח החדש, עם כל התחביר שהיה בו' },
            pct: { type: 'number', description: 'אחוז חדש ל-set_pct, 0..100' },
            direction: { type: 'number', description: '1- למעלה, 1 למטה, ל-move_item' },
            fields: {
              type: 'object',
              additionalProperties: true,
              description: 'שדות הפריט החדש ל-add_item',
            },
            reason: { type: 'string', description: 'שורה אחת בעברית: למה השינוי הזה' },
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
    if (!process.env.ANTHROPIC_API_KEY) {
      return bad(res, 503, 'העוזר לא מוגדר.')
    }
    if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) {
      return bad(res, 500, 'השרת לא מוגדר: חסרים פרטי Supabase.')
    }

    /* ── אימות המשתמשת ── */
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

    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
    if (profile?.role !== 'admin') return bad(res, 403, 'אין הרשאה.')

    if (rateLimited(userData.user.id)) {
      return bad(res, 429, 'יותר מדי בקשות לעוזר בשעה האחרונה. כדאי לנסות עוד קצת.')
    }

    /* ── קלט ── */
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const { messages, content } = body || {}
    if (!Array.isArray(messages) || !messages.length) return bad(res, 400, 'אין הודעות.')
    if (!content?.sections) return bad(res, 400, 'אין תוכן תבנית.')

    const history = messages.slice(-20).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? '').slice(0, 8000),
    }))

    /* ── הקריאה ──────────────────────────────────────────────────
       שני breakpoints של מטמון: הפרומפט הקבוע, ואחריו התוכן. התוכן
       משתנה רק כשעינב עורכת, ולכן ברצף שאלות על אותו נוסח שתיהן
       נקראות מהמטמון. ⚠️ tool_choice "any"/"tool" מוחזר כ-400
       בדגם הזה — ולכן auto, עם ההנחיה לקרוא לכלי בתוך הפרומפט
       ו-strict שמבטיח ארגומנטים תקינים לסכימה. */
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        {
          type: 'text',
          text: 'תוכן הטופס הנוכחי, כולל עריכות שטרם נשמרו:\n\n'
            + JSON.stringify(content.sections),
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [TOOL],
      tool_choice: { type: 'auto' },
      messages: history,
    })

    if (response.stop_reason === 'refusal') {
      return bad(res, 400, 'העוזר לא יכול לטפל בבקשה הזו.')
    }

    let reply = ''
    let edits = []
    for (const block of response.content) {
      if (block.type === 'text') reply += block.text
      else if (block.type === 'tool_use' && block.name === 'propose_edits') {
        const input = block.input
        if (Array.isArray(input?.edits)) edits = input.edits
      }
    }

    return res.status(200).json({
      reply: reply.trim(),
      edits,
      usage: {
        input: response.usage?.input_tokens ?? 0,
        output: response.usage?.output_tokens ?? 0,
        cacheRead: response.usage?.cache_read_input_tokens ?? 0,
      },
    })
  } catch (err) {
    /* לעולם לא מחזירים את גוף השגיאה של הספק — הוא עלול להכיל
       פרטי בקשה. ללוג נכנסת רק הכותרת. */
    console.error('template-assistant:', err?.name, err?.status)
    if (err instanceof Anthropic.AuthenticationError) return bad(res, 503, 'העוזר לא מוגדר נכון.')
    if (err instanceof Anthropic.RateLimitError) return bad(res, 429, 'העוזר עמוס כרגע. כדאי לנסות שוב בעוד רגע.')
    if (err instanceof Anthropic.APIError) return bad(res, 502, 'העוזר לא זמין כרגע.')
    return bad(res, 500, 'שגיאה בעוזר.')
  }
}
