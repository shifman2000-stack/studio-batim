/* ═══════════════════════════════════════════════════════════════════════
   node src/lib/quoteV2/plural.test.js

   שתי יחידות שעליהן נשען המעבר לתבנית ברבים:
   · pluralOf — ההחלפה שגם ה-SQL של ההגירה עושה. הבדיקות כאן הן
     גם הבדיקות של אותו ביטוי רגולרי.
   · validateConversion — השומר על נוסח שחוזר ממודל.
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import {
  pluralOf, pluralizeContent, hasAlternatesAnywhere,
  collectTextFields, applyTextFields, validateConversion, varsIn, countOptionals,
} from './plural.js'

const here = dirname(fileURLToPath(import.meta.url))
const SQL = resolvePath(here, '../../../docs/sql/quote-v2-phaseA.sql')
const template = JSON.parse(readFileSync(SQL, 'utf8').split('$json$')[1])

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name); console.log('    ' + (e.message || e)) }
}

console.log('\n pluralOf')

test('חלופה פשוטה — נשאר צד הרבים', () => {
  assert.equal(pluralOf('{בוא|בואו} נבנה'), 'בואו נבנה')
})

test('כמה חלופות באותו נוסח', () => {
  assert.equal(pluralOf('{בוא|בואו} נבנה {לך|לכם} בית.'), 'בואו נבנה לכם בית.')
})

test('⚠️ {{משתנה}} לא נוגע', () => {
  assert.equal(pluralOf('שלום {{firstNames}}, {בוא|בואו}.'), 'שלום {{firstNames}}, בואו.')
  assert.equal(pluralOf('{{firstNames}} ו{{settlement}}'), '{{firstNames}} ו{{settlement}}')
})

test('⚠️ [[קטע מותנה]] לא נוגע', () => {
  assert.equal(
    pluralOf('בית[[ של כ-{{houseArea}} מ״ר]], {בוא|בואו}.'),
    'בית[[ של כ-{{houseArea}} מ״ר]], בואו.')
})

test('חלופה עם כמה מילים בכל צד', () => {
  assert.equal(
    pluralOf('{מה אתה צריך|מה אתם צריכים}, ו{איך אתה חי|איך אתם חיים}'),
    'מה אתם צריכים, ואיך אתם חיים')
})

test('צד רבים ריק', () => {
  assert.equal(pluralOf('הבית של{ה|} הלקוח'), 'הבית של הלקוח')
})

test('טקסט בלי חלופות לא משתנה', () => {
  const t = 'בית מגורים ב{{settlement}}. התשלום בש״ח.'
  assert.equal(pluralOf(t), t)
})

test('שורות חדשות ופיסוק נשמרים', () => {
  assert.equal(pluralOf('{{firstNames}},\n{בוא|בואו} נבנה\n{לך|לכם} בית.'),
    '{{firstNames}},\nבואו נבנה\nלכם בית.')
})

test('לא-מחרוזת חוזר כמו שהוא', () => {
  assert.equal(pluralOf(7), 7)
  assert.equal(pluralOf(null), null)
})

console.log('\n הגירת התבנית כולה')

test('התבנית האמיתית — אחרי ההמרה אין חלופות', () => {
  assert.equal(hasAlternatesAnywhere(template), true, 'התבנית לבדיקה חייבת להכיל חלופות')
  const out = pluralizeContent(template)
  assert.equal(hasAlternatesAnywhere(out), false)
})

test('התבנית האמיתית — מספר המשתנים והקטעים המותנים לא משתנה', () => {
  const out = pluralizeContent(template)
  const count = (c, re) => JSON.stringify(c.sections).match(re)?.length ?? 0
  assert.equal(count(out, /\{\{\w+\}\}/g), count(template, /\{\{\w+\}\}/g))
  assert.equal(count(out, /\[\[[^[\]]*\]\]/g), count(template, /\[\[[^[\]]*\]\]/g))
})

test('מבנה התבנית נשמר — אותם סעיפים, פריטים ומזהים', () => {
  const out = pluralizeContent(template)
  assert.deepEqual(out.sections.map(s => s.id), template.sections.map(s => s.id))
  const st = (c) => c.sections.find(s => s.type === 'stages').items.map(i => i.id)
  assert.deepEqual(st(out), st(template))
  const pct = (c) => c.sections.find(s => s.type === 'stages').items.map(i => i.pct)
  assert.deepEqual(pct(out), pct(template))
})

console.log('\n איסוף וכתיבה של שדות טקסט')

test('collectTextFields — מדלג על id/type/pct ועל שדות ריקים', () => {
  const fields = collectTextFields(template)
  assert.equal(fields.some(f => f.path.endsWith('.id')), false)
  assert.equal(fields.some(f => f.path.endsWith('.type')), false)
  assert.equal(fields.some(f => f.path.endsWith('.pct')), false)
  assert.equal(fields.every(f => f.text.trim() !== ''), true)
  assert.ok(fields.length > 40, 'צפויים עשרות שדות, התקבלו ' + fields.length)
})

test('collectTextFields — מגיע לשלבים, לקבוצות ולפריטים שבתוכן', () => {
  const paths = collectTextFields(template).map(f => f.path)
  assert.ok(paths.includes('st_1.process'), 'שדה של שלב')
  assert.ok(paths.includes('sec_open.greeting'), 'שדה של סעיף')
  assert.ok(paths.some(p => p.startsWith('grp_')), 'שם קבוצת תנאים')
  assert.ok(paths.some(p => p.startsWith('tm_')), 'פריט תנאי')
})

test('applyTextFields — כותב רק את מה שנשלח', () => {
  const out = applyTextFields(template, [{ path: 'sec_open.greeting', text: 'שלום' }])
  const open = out.sections.find(s => s.type === 'opening')
  assert.equal(open.greeting, 'שלום')
  assert.equal(open.intro, template.sections.find(s => s.type === 'opening').intro)
})

test('applyTextFields — הלוך ושוב מלא מחזיר את אותו תוכן', () => {
  const out = applyTextFields(template, collectTextFields(template))
  assert.equal(JSON.stringify(out.sections), JSON.stringify(template.sections))
})

console.log('\n אימות המרה')

test('המרה תקינה עוברת', () => {
  assert.equal(validateConversion('בואו נבנה לכם בית.', 'בוא נבנה לך בית.'), null)
})

test('⚠️ משתנה שנעלם נפסל', () => {
  assert.ok(validateConversion('שלום {{firstNames}}, בואו.', 'שלום, בוא.'))
})

test('⚠️ משתנה שהוחלף בשם אחר נפסל', () => {
  assert.ok(validateConversion('ב{{settlement}}', 'ב{{city}}'))
})

test('⚠️ משתנה שנוסף נפסל', () => {
  assert.ok(validateConversion('שלום.', 'שלום {{firstNames}}.'))
})

test('משתנה שזז במשפט — מותר', () => {
  assert.equal(validateConversion('{{firstNames}}, בואו.', 'בוא, {{firstNames}}.'), null)
})

test('⚠️ קטע מותנה שנעלם נפסל', () => {
  assert.ok(validateConversion('בית[[ של {{houseArea}}]].', 'בית של {{houseArea}}.'))
})

test('⚠️ קטע מותנה שנוסף נפסל', () => {
  assert.ok(validateConversion('בית {{houseArea}}.', 'בית[[ {{houseArea}}]].'))
})

test('⚠️ נוסח שחזר עם {יחיד|רבים} נפסל', () => {
  assert.ok(validateConversion('בואו נבנה.', '{בוא|בואו} נבנה.'))
})

test('⚠️ נוסח ריק נפסל', () => {
  assert.ok(validateConversion('בואו נבנה.', ''))
  assert.ok(validateConversion('בואו נבנה.', '   '))
  assert.ok(validateConversion('בואו נבנה.', undefined))
})

test('varsIn / countOptionals', () => {
  assert.deepEqual(varsIn('{{b}} ו{{a}}'), ['a', 'b'])
  assert.equal(countOptionals('א[[ב]]ג[[ד]]'), 2)
  assert.equal(countOptionals('בלי'), 0)
})

test('כל שדות התבנית אחרי ההמרה לרבים עוברים אימות מול עצמם', () => {
  const out = pluralizeContent(template)
  for (const f of collectTextFields(out)) {
    assert.equal(validateConversion(f.text, f.text), null, f.path)
  }
})

console.log('\n' + (failed === 0
  ? `✅  ${passed} בדיקות עברו`
  : `❌  ${failed} נכשלו, ${passed} עברו`) + '\n')
process.exit(failed === 0 ? 0 : 1)
