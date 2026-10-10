import { resolveText, isFilled } from './resolve.js'
import { varNamesIn, sampleVars } from './templateEdit.js'
import * as ops from './editorOps.js'

/* ═══════════════════════════════════════════════════════════════════════
   פעולות העריכה שהעוזר מציע — אימות והחלה

   ⚠️ שום הצעה של המודל לא נוגעת בתוכן לפני שהיא עוברת כאן. העוזר
   כותב טקסט חופשי, והטקסט הזה חייב לשמר את שלושת המנגנונים של
   content_v2: {{משתנה}}, {יחיד|רבים} ו-[[קטע מותנה]]. נוסח שמאבד
   משתנה ייראה תקין בעברית ויישבר אצל הלקוח הבא, שיקבל את השם של
   מישהו אחר או סוגריים גלויות.

   לכן: validateEdit מפיל כל הצעה שמאבדת משתנה שהיה בנוסח, שמשאירה
   תחביר שבור, או שמצביעה על id שלא קיים. applyEdits מחילה רק את מה
   שעבר, ותמיד דרך editorOps — אותן פונקציות טהורות שהעורך משתמש
   בהן, כדי שלא ייווצר מסלול כתיבה שני.
   ═══════════════════════════════════════════════════════════════════════ */

export const EDIT_KINDS = [
  'set_text', 'set_pct', 'add_item', 'remove_item', 'move_item',
  'add_group', 'rename_group', 'remove_group',
]

/* ── איתור ──────────────────────────────────────────────────────── */

export function findSection(content, sectionId) {
  return (content?.sections ?? []).find(s => s?.id === sectionId)
}

export function findOwner(content, { sectionId, groupId, itemId }) {
  const sec = findSection(content, sectionId)
  if (!sec) return null
  if (itemId) {
    if (groupId) {
      const g = (sec.groups ?? []).find(x => x?.id === groupId)
      return (g?.items ?? []).find(x => x?.id === itemId) ?? null
    }
    const inItems = (sec.items ?? []).find(x => x?.id === itemId)
    if (inItems) return inItems
    for (const g of sec.groups ?? []) {
      const hit = (g.items ?? []).find(x => x?.id === itemId)
      if (hit) return hit
    }
    return null
  }
  if (groupId) return (sec.groups ?? []).find(x => x?.id === groupId) ?? null
  return sec
}

/* ── שדות הנוסח המחייב ──────────────────────────────────────────── */

/** שדות שנכנסים למסמך הכתוב ומחייבים משפטית (החלטה 17). */
const BINDING = {
  scope: ['body', 'pdfTitle'],
  stages: ['formalName', 'process', 'output', 'trigger', 'duration'],
  terms: ['body', 'formalTitle', 'pdfTitle', 'pdfIntro'],
  fee: ['pdfTitle', 'feeLabel', 'vatNote', 'tableIntro'],
  signing: ['pdfTitle', 'pdfText', 'closing'],
  extras: ['pdfTitle', 'pdfBody', 'pdfEyebrow'],
}

export function isBindingField(sectionType, field) {
  return (BINDING[sectionType] ?? []).includes(field)
}

/* ── אימות ──────────────────────────────────────────────────────── */

const ALT_RE = /\{([^{}|]*)\|([^{}|]*)\}/g
const OPT_RE = /\[\[([^[\]]*)\]\]/g

/** האם התחביר עצמו שלם — בלי סוגריים יתומות. */
export function syntaxOk(raw) {
  const s = String(raw ?? '')
  if ((s.match(/\{\{/g) || []).length !== (s.match(/\}\}/g) || []).length) return false
  if ((s.match(/\[\[/g) || []).length !== (s.match(/\]\]/g) || []).length) return false
  /* כל { שאינו חלק מ-{{ חייב להיות חלופה תקינה */
  const stripped = s.replace(/\{\{\w+\}\}/g, '').replace(OPT_RE, '').replace(ALT_RE, '')
  if (/[{}]/.test(stripped)) return false
  /* קטע מותנה חייב להכיל משתנה, אחרת הוא לעולם לא ייעלם */
  let ok = true
  s.replace(OPT_RE, (_m, inner) => { if (!/\{\{\w+\}\}/.test(inner)) ok = false; return '' })
  return ok
}

/**
 * בודק הצעה בודדת מול התוכן הנוכחי.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateEdit(content, edit) {
  if (!edit || !EDIT_KINDS.includes(edit.kind)) {
    return { ok: false, reason: `פעולה לא מוכרת: ${edit?.kind}` }
  }
  const sec = findSection(content, edit.sectionId)
  if (!sec) return { ok: false, reason: `אין סעיף ${edit.sectionId}` }

  switch (edit.kind) {
    case 'set_text': {
      const owner = findOwner(content, edit)
      if (!owner) return { ok: false, reason: `לא נמצא ${edit.itemId || edit.groupId || edit.sectionId}` }
      if (typeof edit.newText !== 'string') return { ok: false, reason: 'אין טקסט חדש' }
      const before = owner[edit.field]
      if (typeof before !== 'string') return { ok: false, reason: `אין שדה ${edit.field}` }
      if (!syntaxOk(edit.newText)) return { ok: false, reason: 'התחביר בנוסח החדש שבור' }
      const lost = varNamesIn(before).filter(n => !varNamesIn(edit.newText).includes(n))
      if (lost.length) return { ok: false, reason: `הנוסח החדש איבד ${lost.map(n => `{{${n}}}`).join(', ')}` }
      /* הנוסח חייב להיפתר בלי להשאיר שרידי תחביר */
      for (const [vars, n] of [[sampleVars(false), 1], [sampleVars(true), 2]]) {
        const out = resolveText(edit.newText, vars, n)
        if (/[{}]|\[\[|\]\]/.test(out)) return { ok: false, reason: 'הנוסח לא נפתר נקי' }
      }
      /* ⚠️ שתי בדיקות התנהגותיות ולא תחביריות. נוסח יכול לשמר כל
         {{משתנה}} ועדיין לשטח את ההבדל בין יחיד לרבים, או להפוך
         קטע רשות לקבוע — שני דברים שנראים תקינים לגמרי בעברית
         ונשברים רק אצל הלקוח הבא. */
      const vp = sampleVars(true)
      /* ⚠️ אותם vars לשני מספרי הלקוחות. אם משווים vars של יחיד מול
         vars של רבים, {{firstNames}} לבדו כבר יוצר הבדל וכל נוסח
         "נראה" דקדוקי — הבדיקה הייתה עוברת תמיד. */
      const differsByCount = (t) => resolveText(t, vp, 1) !== resolveText(t, vp, 2)
      if (differsByCount(before) && !differsByCount(edit.newText)) {
        return { ok: false, reason: 'הנוסח החדש איבד את ההבדל בין לשון יחיד לרבים' }
      }
      /* קטע מותנה נספר מבנית. גם כאן השוואת פלטים לא עובדת: נוסח
         בלי [[ ]] עדיין "משתנה" כששדה הרשות מתרוקן — הוא פשוט
         מציג "כ- מ״ר" ריק, וזה בדיוק הפגם. */
      const segs = (t) => (String(t ?? '').match(/\[\[/g) || []).length
      if (segs(edit.newText) < segs(before)) {
        return { ok: false, reason: 'הנוסח החדש איבד קטע מותנה — הוא יופיע גם כששדה הרשות ריק' }
      }
      return { ok: true }
    }
    case 'set_pct': {
      const owner = findOwner(content, edit)
      if (!owner) return { ok: false, reason: `לא נמצא שלב ${edit.itemId}` }
      const n = Number(edit.pct)
      if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, reason: 'אחוז לא חוקי' }
      return { ok: true }
    }
    case 'remove_item': {
      if (!findOwner(content, edit)) return { ok: false, reason: `לא נמצא ${edit.itemId}` }
      return { ok: true }
    }
    case 'move_item': {
      if (!findOwner(content, edit)) return { ok: false, reason: `לא נמצא ${edit.itemId}` }
      if (![-1, 1].includes(Number(edit.direction))) return { ok: false, reason: 'כיוון לא חוקי' }
      return { ok: true }
    }
    case 'add_item': {
      if (!['stages', 'terms', 'extras'].includes(sec.type)) {
        return { ok: false, reason: `אי אפשר להוסיף פריט ל${sec.type}` }
      }
      if (sec.type === 'terms' && !(sec.groups ?? []).some(g => g.id === edit.groupId)) {
        return { ok: false, reason: 'צריך נושא קיים כדי להוסיף תנאי' }
      }
      for (const [k, v] of Object.entries(edit.fields ?? {})) {
        if (typeof v === 'string' && !syntaxOk(v)) return { ok: false, reason: `התחביר בשדה ${k} שבור` }
      }
      return { ok: true }
    }
    case 'add_group':
      return sec.type === 'terms' ? { ok: true } : { ok: false, reason: 'נושאים קיימים רק בתנאים' }
    case 'rename_group':
    case 'remove_group': {
      if (!(sec.groups ?? []).some(g => g.id === edit.groupId)) {
        return { ok: false, reason: `לא נמצא נושא ${edit.groupId}` }
      }
      if (edit.kind === 'rename_group' && !isFilled(edit.newText)) {
        return { ok: false, reason: 'שם נושא ריק' }
      }
      return { ok: true }
    }
    default:
      return { ok: false, reason: 'פעולה לא מוכרת' }
  }
}

/** מפריד הצעות תקינות מפסולות, בלי לשנות דבר. */
export function partitionEdits(content, edits) {
  const valid = [], invalid = []
  for (const e of edits ?? []) {
    const r = validateEdit(content, e)
    if (r.ok) valid.push(e)
    else invalid.push({ edit: e, reason: r.reason })
  }
  return { valid, invalid }
}

/* ── תצוגה ──────────────────────────────────────────────────────── */

/** לפני/אחרי, פתור עם לקוח הדוגמה — עינב לא רואה תחביר. */
export function previewOf(content, edit, twoClients = true) {
  const vars = sampleVars(twoClients)
  const n = twoClients ? 2 : 1
  const sec = findSection(content, edit.sectionId)
  const owner = findOwner(content, edit)
  const label = sec?.type ?? ''

  if (edit.kind === 'set_text') {
    return {
      before: resolveText(owner?.[edit.field] ?? '', vars, n),
      after: resolveText(edit.newText ?? '', vars, n),
      binding: isBindingField(label, edit.field),
    }
  }
  if (edit.kind === 'set_pct') {
    return { before: `${owner?.pct ?? 0}%`, after: `${edit.pct}%`, binding: false }
  }
  if (edit.kind === 'rename_group') {
    return { before: owner?.title ?? '', after: edit.newText ?? '', binding: false }
  }
  if (edit.kind === 'remove_item' || edit.kind === 'remove_group') {
    const name = owner?.formalName ?? owner?.formalTitle ?? owner?.title ?? owner?.question ?? ''
    return { before: resolveText(name, vars, n), after: '— יוסר —', binding: label === 'terms' || label === 'stages' }
  }
  if (edit.kind === 'add_item' || edit.kind === 'add_group') {
    const f = edit.fields ?? {}
    const name = f.formalName ?? f.formalTitle ?? f.title ?? edit.newText ?? 'חדש'
    return { before: '—', after: resolveText(name, vars, n), binding: label === 'terms' || label === 'stages' }
  }
  if (edit.kind === 'move_item') {
    const name = owner?.formalName ?? owner?.formalTitle ?? owner?.title ?? ''
    return { before: resolveText(name, vars, n), after: Number(edit.direction) < 0 ? '↑ למעלה' : '↓ למטה', binding: false }
  }
  return { before: '', after: '', binding: false }
}

/* ── החלה ───────────────────────────────────────────────────────── */

/**
 * מחילה הצעה אחת. תמיד דרך editorOps — אותו מסלול כתיבה של העורך.
 * מחזירה גם את הנתיב שנערך, כדי שהעורך יסמן אותו כ"נערך" ויידע
 * להמיר אותו חזרה לנוסח תבנית בשמירה.
 */
export function applyEdit(content, edit) {
  const sec = findSection(content, edit.sectionId)
  const touched = []

  switch (edit.kind) {
    case 'set_text': {
      const id = edit.itemId || edit.groupId || edit.sectionId
      touched.push({ ownerId: id, field: edit.field, before: findOwner(content, edit)?.[edit.field] ?? '' })
      return { content: ops.patchById(content, id, { [edit.field]: edit.newText }), touched }
    }
    case 'set_pct':
      return { content: ops.setStagePct(content, edit.itemId, edit.pct), touched }
    case 'remove_item':
      return {
        content: sec.type === 'stages' ? ops.removeStage(content, edit.itemId)
          : sec.type === 'extras' ? ops.removeExtra(content, edit.itemId)
            : ops.removeTerm(content, edit.itemId),
        touched,
      }
    case 'move_item':
      return {
        content: sec.type === 'stages'
          ? ops.moveStage(content, edit.itemId, Number(edit.direction))
          : ops.moveTerm(content, edit.itemId, Number(edit.direction)),
        touched,
      }
    case 'add_item': {
      if (sec.type === 'stages') {
        const r = ops.addStage(content, edit.fields ?? {})
        return { content: r.content, touched, newId: r.id }
      }
      if (sec.type === 'extras') {
        return { content: ops.addExtra(content, edit.fields ?? {}), touched }
      }
      const r = ops.addTerm(content, edit.groupId, edit.fields ?? {})
      return { content: r.content, touched, newId: r.id }
    }
    case 'add_group': {
      const r = ops.addGroup(content, edit.newText || 'נושא חדש')
      return { content: r.content, touched, newId: r.id }
    }
    case 'rename_group':
      touched.push({ ownerId: edit.groupId, field: 'title', before: findOwner(content, edit)?.title ?? '' })
      return { content: ops.patchById(content, edit.groupId, { title: edit.newText }), touched }
    case 'remove_group':
      return { content: ops.removeGroup(content, edit.groupId), touched }
    default:
      return { content, touched }
  }
}

/** מחילה רשימה לפי הסדר, ומדלגת על מה שכבר לא תקף. */
export function applyEdits(content, edits) {
  let next = content
  const touched = []
  const skipped = []
  for (const e of edits ?? []) {
    const check = validateEdit(next, e)
    if (!check.ok) { skipped.push({ edit: e, reason: check.reason }); continue }
    const r = applyEdit(next, e)
    next = r.content
    touched.push(...r.touched)
  }
  return { content: next, touched, skipped }
}
