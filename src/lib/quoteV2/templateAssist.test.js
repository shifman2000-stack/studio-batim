/* ═══════════════════════════════════════════════════════════════════════
   בדיקות לפעולות העריכה של העוזר

       node src/lib/quoteV2/templateAssist.test.js

   זו שכבת ההגנה בין מה שהמודל מציע לבין התבנית. כל בדיקה כאן היא
   נוסח שנראה תקין בעברית ושובר משהו בשקט — משתנה שאבד, חלופה
   פגומה, קטע מותנה בלי משתנה, או id שלא קיים.
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { sampleVars } from './templateEdit.js'
import { resolveText } from './resolve.js'
import * as ops from './editorOps.js'
import {
  syntaxOk, validateEdit, partitionEdits, applyEdit, applyEdits,
  isBindingField, previewOf, findOwner, EDIT_KINDS,
} from './templateAssist.js'

const here = dirname(fileURLToPath(import.meta.url))
const template = JSON.parse(
  readFileSync(resolvePath(here, '../../../docs/sql/quote-v2-phaseA.sql'), 'utf8').split('$json$')[1])

let passed = 0, failed = 0
const test = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message) }
}
const clone = o => JSON.parse(JSON.stringify(o))
const content = () => clone(template)
const stageId = (i = 0) => ops.sectionByType(template, 'stages').items[i].id
const termId = () => ops.sectionByType(template, 'terms').groups[0].items[0].id
const groupId = () => ops.sectionByType(template, 'terms').groups[0].id

console.log('')
console.log(' תחביר')
test('נוסח תקין', () => {
  assert.equal(syntaxOk('שלום {{firstNames}}'), true)
  assert.equal(syntaxOk('{בוא|בואו} נבנה'), true)
  assert.equal(syntaxOk('בית[[ של {{houseArea}} מ״ר]]'), true)
})
test('סוגריים יתומות נפסלות', () => {
  assert.equal(syntaxOk('שלום {{firstNames}'), false)
  assert.equal(syntaxOk('בית[[ של {{houseArea}} מ״ר'), false)
  assert.equal(syntaxOk('{בוא נבנה'), false)
})
test('קטע מותנה בלי משתנה נפסל — הוא לעולם לא ייעלם', () => {
  assert.equal(syntaxOk('בית[[ גדול]]'), false)
})
test('משתנה בתוך חלופה חוקי — המשתנים נפתרים לפני החלופות', () => {
  /* resolve.js מריץ קטע מותנה → משתנה → דקדוק, ולכן {{a}} כבר הוחלף
     בערך כשתורו של {יחיד|רבים} מגיע. אומת מול resolveText. */
  assert.equal(syntaxOk('{שלום {{a}}|היי לכולם}'), true)
  assert.equal(resolveText('{שלום {{a}}|היי לכולם}', { a: 'דנה' }, 1), 'שלום דנה')
  assert.equal(resolveText('{שלום {{a}}|היי לכולם}', { a: 'דנה' }, 2), 'היי לכולם')
})

console.log('')
console.log(' set_text')
test('שינוי ניסוח תקין עובר', () => {
  const r = validateEdit(content(), {
    kind: 'set_text', sectionId: 'sec_scope', field: 'body',
    newText: 'תכנון אדריכלי מלא[[ (כ-{{houseArea}} מ״ר)]], כולל פיתוח המגרש[[ (כ-{{plotArea}} מ״ר)]].',
  })
  assert.equal(r.ok, true, r.reason)
})
test('נוסח שמאבד משתנה נפסל', () => {
  const r = validateEdit(content(), {
    kind: 'set_text', sectionId: 'sec_open', field: 'greeting',
    newText: 'שלום לכם, בואו נבנה בית.',
  })
  assert.equal(r.ok, false)
  assert.match(r.reason, /firstNames/)
})
test('נוסח עם תחביר שבור נפסל', () => {
  const r = validateEdit(content(), {
    kind: 'set_text', sectionId: 'sec_open', field: 'greeting',
    newText: '{{firstNames}}, {בוא נבנה בית.',
  })
  assert.equal(r.ok, false)
})
test('שדה שלא קיים נפסל', () => {
  const r = validateEdit(content(), { kind: 'set_text', sectionId: 'sec_scope', field: 'nope', newText: 'x' })
  assert.equal(r.ok, false)
})
test('סעיף שלא קיים נפסל', () => {
  const r = validateEdit(content(), { kind: 'set_text', sectionId: 'sec_nope', field: 'body', newText: 'x' })
  assert.equal(r.ok, false)
})
test('טקסט בתוך שלב, לפי itemId', () => {
  const r = validateEdit(content(), {
    kind: 'set_text', sectionId: 'sec_stages', itemId: stageId(), field: 'process', newText: 'תהליך חדש.',
  })
  assert.equal(r.ok, true, r.reason)
})
test('טקסט בתוך תנאי, בלי groupId — נמצא בכל זאת', () => {
  const r = validateEdit(content(), {
    kind: 'set_text', sectionId: 'sec_terms', itemId: termId(), field: 'body', newText: 'נוסח מחייב חדש.',
  })
  assert.equal(r.ok, true, r.reason)
})

console.log('')
console.log(' שאר הפעולות')
test('set_pct בטווח', () => {
  assert.equal(validateEdit(content(), { kind: 'set_pct', sectionId: 'sec_stages', itemId: stageId(), pct: 25 }).ok, true)
  assert.equal(validateEdit(content(), { kind: 'set_pct', sectionId: 'sec_stages', itemId: stageId(), pct: 120 }).ok, false)
  assert.equal(validateEdit(content(), { kind: 'set_pct', sectionId: 'sec_stages', itemId: stageId(), pct: -1 }).ok, false)
})
test('remove/move על פריט קיים', () => {
  assert.equal(validateEdit(content(), { kind: 'remove_item', sectionId: 'sec_stages', itemId: stageId() }).ok, true)
  assert.equal(validateEdit(content(), { kind: 'move_item', sectionId: 'sec_stages', itemId: stageId(), direction: -1 }).ok, true)
  assert.equal(validateEdit(content(), { kind: 'move_item', sectionId: 'sec_stages', itemId: stageId(), direction: 5 }).ok, false)
})
test('add_item לשלבים, ולתנאים רק עם נושא קיים', () => {
  assert.equal(validateEdit(content(), { kind: 'add_item', sectionId: 'sec_stages', fields: { formalName: 'חדש' } }).ok, true)
  assert.equal(validateEdit(content(), { kind: 'add_item', sectionId: 'sec_terms', groupId: groupId(), fields: { body: 'ב' } }).ok, true)
  assert.equal(validateEdit(content(), { kind: 'add_item', sectionId: 'sec_terms', groupId: 'grp_nope', fields: {} }).ok, false)
})
test('add_item עם תחביר שבור בשדה נפסל', () => {
  const r = validateEdit(content(), { kind: 'add_item', sectionId: 'sec_stages', fields: { process: 'בית[[ של {{houseArea}}' } })
  assert.equal(r.ok, false)
})
test('נושאים', () => {
  assert.equal(validateEdit(content(), { kind: 'add_group', sectionId: 'sec_terms', newText: 'חדש' }).ok, true)
  assert.equal(validateEdit(content(), { kind: 'add_group', sectionId: 'sec_stages' }).ok, false)
  assert.equal(validateEdit(content(), { kind: 'rename_group', sectionId: 'sec_terms', groupId: groupId(), newText: 'שם' }).ok, true)
  assert.equal(validateEdit(content(), { kind: 'rename_group', sectionId: 'sec_terms', groupId: groupId(), newText: '  ' }).ok, false)
  assert.equal(validateEdit(content(), { kind: 'remove_group', sectionId: 'sec_terms', groupId: 'grp_nope' }).ok, false)
})
test('פעולה לא מוכרת נפסלת', () => {
  assert.equal(validateEdit(content(), { kind: 'drop_database', sectionId: 'sec_scope' }).ok, false)
  assert.equal(validateEdit(content(), null).ok, false)
})

console.log('')
console.log(' הפרדה והחלה')
test('partitionEdits מפריד תקין מפסול', () => {
  const { valid, invalid } = partitionEdits(content(), [
    { kind: 'set_pct', sectionId: 'sec_stages', itemId: stageId(), pct: 30 },
    { kind: 'set_text', sectionId: 'sec_open', field: 'greeting', newText: 'בלי משתנה' },
  ])
  assert.equal(valid.length, 1)
  assert.equal(invalid.length, 1)
  assert.match(invalid[0].reason, /firstNames/)
})

test('applyEdit לא נוגע בקלט', () => {
  const c = content()
  const before = JSON.stringify(c)
  applyEdit(c, { kind: 'set_pct', sectionId: 'sec_stages', itemId: stageId(), pct: 44 })
  assert.equal(JSON.stringify(c), before)
})

test('set_text מוחל ומדווח על הנתיב שנערך', () => {
  const c = content()
  const r = applyEdit(c, {
    kind: 'set_text', sectionId: 'sec_stages', itemId: stageId(), field: 'process', newText: 'תהליך חדש.',
  })
  assert.equal(findOwner(r.content, { sectionId: 'sec_stages', itemId: stageId() }).process, 'תהליך חדש.')
  assert.equal(r.touched[0].ownerId, stageId())
  assert.equal(r.touched[0].field, 'process')
  assert.ok(r.touched[0].before.length > 0, 'לא נשמר הנוסח הקודם')
})

test('applyEdits מחיל רצף ומדלג על מה שכבר לא תקף', () => {
  const c = content()
  const id = stageId()
  const r = applyEdits(c, [
    { kind: 'remove_item', sectionId: 'sec_stages', itemId: id },
    { kind: 'set_pct', sectionId: 'sec_stages', itemId: id, pct: 10 },   // כבר לא קיים
  ])
  assert.equal(ops.sectionByType(r.content, 'stages').items.length, 5)
  assert.equal(r.skipped.length, 1)
})

test('add_item מחזיר את ה-id החדש', () => {
  const r = applyEdit(content(), { kind: 'add_item', sectionId: 'sec_stages', fields: { formalName: 'ליווי תאורה', pct: 0 } })
  assert.ok(r.newId)
  const added = ops.sectionByType(r.content, 'stages').items.find(s => s.id === r.newId)
  assert.equal(added.formalName, 'ליווי תאורה')
})

test('רצף מעורב: ניסוח, אחוז, הוספה ומחיקה', () => {
  const c = content()
  const g = groupId()
  const r = applyEdits(c, [
    { kind: 'set_text', sectionId: 'sec_scope', field: 'body', newText: 'תכנון[[ (כ-{{houseArea}} מ״ר)]] ופיתוח[[ (כ-{{plotArea}} מ״ר)]].' },
    { kind: 'set_pct', sectionId: 'sec_stages', itemId: stageId(1), pct: 25 },
    { kind: 'add_item', sectionId: 'sec_terms', groupId: g, fields: { formalTitle: 'תנאי חדש', body: 'נוסח.', question: 'שאלה?' } },
    { kind: 'remove_item', sectionId: 'sec_terms', itemId: termId() },
  ])
  assert.equal(r.skipped.length, 0)
  assert.match(ops.sectionByType(r.content, 'scope').body, /\{\{plotArea\}\}/)
  assert.equal(findOwner(r.content, { sectionId: 'sec_stages', itemId: stageId(1) }).pct, 25)
  const terms = ops.sectionByType(r.content, 'terms').groups.find(x => x.id === g).items
  assert.ok(terms.some(t => t.formalTitle === 'תנאי חדש'))
  assert.ok(!terms.some(t => t.id === termId()))
})

console.log('')
console.log(' נוסח מחייב ותצוגה')
test('isBindingField', () => {
  assert.equal(isBindingField('terms', 'body'), true)
  assert.equal(isBindingField('terms', 'question'), false)
  assert.equal(isBindingField('stages', 'process'), true)
  assert.equal(isBindingField('stages', 'storyBody'), false)
  assert.equal(isBindingField('scope', 'body'), true)
})
test('previewOf מחזיר טקסט פתור, בלי תחביר', () => {
  const p = previewOf(content(), {
    kind: 'set_text', sectionId: 'sec_open', field: 'greeting',
    newText: '{{firstNames}}, {בוא|בואו} נתכנן {לך|לכם} בית.',
  }, true)
  assert.equal(p.after, 'לקוח1 ולקוח2, בואו נתכנן לכם בית.')
  assert.ok(!/[{}]/.test(p.before), p.before)
  assert.equal(p.binding, false)
})
test('previewOf מסמן נוסח מחייב', () => {
  const p = previewOf(content(), { kind: 'set_text', sectionId: 'sec_terms', itemId: termId(), field: 'body', newText: 'נוסח.' })
  assert.equal(p.binding, true)
})
test('previewOf להסרה ולהוספה', () => {
  const rm = previewOf(content(), { kind: 'remove_item', sectionId: 'sec_stages', itemId: stageId() })
  assert.match(rm.after, /יוסר/)
  const add = previewOf(content(), { kind: 'add_item', sectionId: 'sec_stages', fields: { formalName: 'חדש' } })
  assert.equal(add.after, 'חדש')
})

console.log('')
console.log(' שימור דקדוק וקטעים מותנים')

test('נוסח ששיטח יחיד/רבים נפסל, גם כשכל המשתנים נשמרו', () => {
  const c = content()
  const open = ops.sectionByType(c, 'opening')
  /* הנוסח המקורי מבחין בין יחיד לרבים; החדש שומר את {{firstNames}}
     אבל מנסח אחיד — וזה בדיוק מה שנראה תקין ונשבר אצל לקוח יחיד. */
  const r = validateEdit(c, {
    kind: 'set_text', sectionId: open.id, field: 'greeting',
    newText: '{{firstNames}}, נתכנן יחד בית.',
  })
  assert.equal(r.ok, false)
  assert.match(r.reason, /יחיד/)
})

test('נוסח ששומר את ההבדל בניסוח אחר — עובר', () => {
  const c = content()
  const open = ops.sectionByType(c, 'opening')
  const r = validateEdit(c, {
    kind: 'set_text', sectionId: open.id, field: 'greeting',
    newText: '{{firstNames}}, {בוא|בואו} נתכנן {לך|לכם} בית.',
  })
  assert.equal(r.ok, true, r.reason)
})

test('נוסח שאיבד קטע מותנה נפסל', () => {
  const c = content()
  /* תכולת השירות מזכירה שטחים בתוך [[ ]]; נוסח שמשאיר את המשתנה
     בלי הסוגריים יציג "(כ- מ״ר)" ריק כששדה הרשות ריק. */
  const r = validateEdit(c, {
    kind: 'set_text', sectionId: 'sec_scope', field: 'body',
    newText: 'תכנון של בית כ-{{houseArea}} מ״ר ומגרש כ-{{plotArea}} מ״ר.',
  })
  assert.equal(r.ok, false)
  assert.match(r.reason, /מותנה/)
})

test('נוסח ששומר את הקטעים המותנים — עובר', () => {
  const c = content()
  const r = validateEdit(c, {
    kind: 'set_text', sectionId: 'sec_scope', field: 'body',
    newText: 'תכנון של בית[[ כ-{{houseArea}} מ״ר]] ומגרש[[ כ-{{plotArea}} מ״ר]].',
  })
  assert.equal(r.ok, true, r.reason)
})

test('שדה שלא היה בו דקדוק — ניסוח אחיד מותר', () => {
  const c = content()
  const st = ops.sectionByType(c, 'stages').items[0]
  const r = validateEdit(c, {
    kind: 'set_text', sectionId: 'sec_stages', itemId: st.id, field: 'output',
    newText: 'סקיצות ראשונות לבחינה משותפת.',
  })
  assert.equal(r.ok, true, r.reason)
})

console.log('')
console.log(' הגנה מקצה לקצה')
test('הצעה שעוברת — הנוסח נפתר נקי לשני מספרי לקוחות', () => {
  const edit = {
    kind: 'set_text', sectionId: 'sec_open', field: 'greeting',
    newText: '{{firstNames}}, {בוא|בואו} נתכנן {לך|לכם} בית.',
  }
  assert.equal(validateEdit(content(), edit).ok, true)
  const r = applyEdit(content(), edit)
  const raw = ops.sectionByType(r.content, 'opening').greeting
  assert.equal(resolveText(raw, { firstNames: 'דנה' }, 1), 'דנה, בוא נתכנן לך בית.')
  assert.equal(resolveText(raw, { firstNames: 'דנה ויואב' }, 2), 'דנה ויואב, בואו נתכנן לכם בית.')
})
test('כל שדות התבנית עוברים אימות כשהם מוצעים כמו שהם', () => {
  const c = content()
  const bad = []
  for (const sec of c.sections) {
    for (const [k, v] of Object.entries(sec)) {
      if (typeof v !== 'string' || ['id', 'type'].includes(k)) continue
      const r = validateEdit(c, { kind: 'set_text', sectionId: sec.id, field: k, newText: v })
      if (!r.ok) bad.push(`${sec.id}.${k}: ${r.reason}`)
    }
  }
  assert.deepEqual(bad, [])
})

console.log('')
console.log(' סכימת הכלי')

const { TOOL } = await import('../../../api/template-assistant.js')

/* ⚠️ הבדיקה הזו נולדה מ-400 אמיתי: הסכימה הכילה
   additionalProperties: true תחת strict, ו-Anthropic דחה את הבקשה
   כולה. בלוג של Vercel זה נראה רק כ-"Error 400". */
test('כל פעולה בסכימה מוכרת גם ל-validateEdit', () => {
  const kinds = TOOL.input_schema.properties.edits.items.properties.kind.enum
  assert.deepEqual([...kinds].sort(), [...EDIT_KINDS].sort())
})

test('הסכימה היא JSON תקין ויש לה edits', () => {
  assert.ok(JSON.stringify(TOOL))
  assert.equal(TOOL.input_schema.type, 'object')
  assert.deepEqual(TOOL.input_schema.required, ['edits'])
})

test('additionalProperties לא מופיע עם ערך שאינו false', () => {
  const bad = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
      bad.push(path + ' = ' + node.additionalProperties)
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, path + '.' + k)
  }
  walk(TOOL.input_schema, 'schema')
  assert.deepEqual(bad, [])
})

test('אם strict יידלק — הסכימה חייבת לקיים את תת-הקבוצה שלו', () => {
  if (!TOOL.strict) return                 // כרגע כבוי במכוון
  const bad = []
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'object' && node.additionalProperties !== false) {
      bad.push(path + ': additionalProperties חייב להיות false')
    }
    if (node.type === 'object' && !node.properties) {
      bad.push(path + ': אובייקט בלי properties אינו ניתן להידור')
    }
    for (const [k, v] of Object.entries(node)) if (v && typeof v === 'object') walk(v, path + '.' + k)
  }
  walk(TOOL.input_schema, 'schema')
  assert.deepEqual(bad, [])
})

console.log('\n' + (failed === 0
  ? `✅  ${passed} בדיקות עברו`
  : `❌  ${failed} נכשלו, ${passed} עברו`) + '\n')
process.exit(failed === 0 ? 0 : 1)
