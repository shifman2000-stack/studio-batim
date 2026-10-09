import { isFilled } from './resolve.js'

/* ═══════════════════════════════════════════════════════════════════════
   צ׳קליסט השליחה — מסמך התכנון, C.3

   רץ **בשליחה בלבד**, לא בזמן ההקלדה. אדום שמהבהב בזמן שעינב
   כותבת הוא רעש; אדום ברגע שהיא עוצרת לשלוח הוא מידע.

   היוצא מן הכלל היחיד הוא מד האחוזים, שגלוי תמיד מתחת לטבלת
   התשלומים — כי שם הוא בדיוק מה שצריך לתקן.

   מחזיר רשימה אחידה: { ok, text }. חוסמים הם כל מה שלא ok.
   ═══════════════════════════════════════════════════════════════════════ */

const sectionOf = (content, type) =>
  (content?.sections ?? []).find(s => s?.type === type && s?.enabled !== false)

export function stagesOf(content) {
  return (sectionOf(content, 'stages')?.items ?? []).filter(s => s?.enabled !== false)
}

export function termGroupsOf(content) {
  return sectionOf(content, 'terms')?.groups ?? []
}

export function pctSum(stages) {
  return stages.reduce((a, s) => a + (Number(s?.pct) || 0), 0)
}

/**
 * הצ׳קליסט שמוצג לפני השליחה.
 * @returns {{ok: boolean, text: string}[]}
 */
export function sendChecklist(content) {
  const out = []
  const clients = Array.isArray(content?.clients) ? content.clients : []
  const fee = Number(content?.totals?.fee) || 0
  const stages = stagesOf(content)
  const groups = termGroupsOf(content)
  const terms = groups.flatMap(g => g?.items ?? [])

  /* 1 — שם לקוח */
  const named = clients.filter(c => isFilled(c?.firstName) || isFilled(c?.lastName))
  out.push(named.length > 0
    ? { ok: true, text: `שם הלקוח: ${named.map(c => [c.firstName, c.lastName].filter(isFilled).join(' ')).join(' ו')}` }
    : { ok: false, text: 'חסר שם הלקוח' })

  /* 2 — שכר טרחה */
  out.push(fee > 0
    ? { ok: true, text: `מחיר: ${fee.toLocaleString('en-US')} ₪ בתוספת מע״מ` }
    : { ok: false, text: 'חסר שכר טרחה' })

  /* 3 — אחוזים */
  const sum = pctSum(stages)
  out.push(sum === 100
    ? { ok: true, text: 'חלוקת התשלומים: 100%' }
    : { ok: false, text: `חלוקת התשלומים: ${sum}% — צריך להגיע ל-100%` })

  /* 4 — לכל שלב שם ומועד תשלום */
  const noName = stages.filter(s => !isFilled(s?.formalName))
  const noTrigger = stages.filter(s => !isFilled(s?.trigger))
  if (stages.length === 0) {
    out.push({ ok: false, text: 'אין אף שלב בהצעה' })
  } else if (noName.length || noTrigger.length) {
    const parts = []
    if (noName.length) parts.push(`${noName.length} בלי שם`)
    if (noTrigger.length) parts.push(`${noTrigger.length} בלי מועד תשלום`)
    out.push({ ok: false, text: `שלבים: ${parts.join(', ')}` })
  } else {
    out.push({ ok: true, text: `${stages.length} שלבים, לכולם שם ומועד תשלום` })
  }

  /* 5 — נוסח מחייב בכל תנאי */
  const emptyBody = terms.filter(t => !isFilled(t?.body))
  if (terms.length === 0) {
    out.push({ ok: false, text: 'אין אף תנאי התקשרות' })
  } else if (emptyBody.length) {
    out.push({ ok: false, text: `${emptyBody.length} תנאים בלי נוסח מחייב` })
  } else {
    out.push({ ok: true, text: `${terms.length} תנאים, לכולם נוסח מחייב` })
  }

  return out
}

export function canSend(content) {
  return sendChecklist(content).every(c => c.ok)
}

/* ── קישור וואטסאפ ────────────────────────────────────────────────── */

/** רק ספרות; מספר ישראלי שמתחיל ב-0 מתורגם ל-972. */
export function waNumber(phone) {
  const d = String(phone ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('972')) return d
  if (d.startsWith('0')) return '972' + d.slice(1)
  return d
}

export function waLink(phone, firstNames, url) {
  const who = isFilled(firstNames) ? `${firstNames}, ` : ''
  const text = `${who}הצעת המחיר שלכם מסטודיו בתים מוכנה 🏠\n${url}`
  const n = waNumber(phone)
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`
}
