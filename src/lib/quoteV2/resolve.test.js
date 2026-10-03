/* ═══════════════════════════════════════════════════════════════════════
   בדיקות ל-resolve.js

   אין vitest בפרויקט, ולכן זה סקריפט node רגיל:

       node src/lib/quoteV2/resolve.test.js

   הבדיקות של ארבעת מצבי השטחים קוראות את **הטקסטים האמיתיים מהזריעה**
   (docs/sql/quote-v2-phaseA.sql) ולא העתק שלהם, כדי שעריכה של הזריעה
   תיתפס כאן ולא רק בעין.
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { resolveText, deriveFirstNames, isFilled } from './resolve.js'

const here = dirname(fileURLToPath(import.meta.url))
const SQL_PATH = resolvePath(here, '../../../docs/sql/quote-v2-phaseA.sql')

/* התבנית היא גוש ה-$json$ הראשון בקובץ. */
const template = JSON.parse(readFileSync(SQL_PATH, 'utf8').split('$json$')[1])
const section = type => template.sections.find(s => s.type === type)
const INTRO = section('opening').intro
const SCOPE = section('scope').body
const GREETING = section('opening').greeting

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (err) {
    failed++
    console.log('  ✗ ' + name)
    console.log('      ' + String(err.message).split('\n').join('\n      '))
  }
}

const BASE = {
  firstNames: 'דנה ויואב',
  settlement: 'כפר ורדים',
  houseArea: '200',
  plotArea: '490',
  fee: 120000,
}
/* רק המשפט הראשון — השאר ("גללו למטה…") אינו תלוי בשטחים. */
const firstSentence = t => t.split('.')[0] + '.'
const upToService = t => t.split('. השירות')[0] + '.'

console.log('\nresolve.js')

console.log('\n ארבעת מצבי השטחים — פתיחה שיווקית')
test('שניהם', () => {
  assert.equal(
    firstSentence(resolveText(INTRO, BASE, 2)),
    'בית מגורים של כ-200 מ״ר בכפר ורדים, עם פיתוח מגרש של כ-490 מ״ר.')
})
test('בית בלבד', () => {
  assert.equal(
    firstSentence(resolveText(INTRO, { ...BASE, plotArea: '' }, 2)),
    'בית מגורים של כ-200 מ״ר בכפר ורדים.')
})
test('מגרש בלבד', () => {
  assert.equal(
    firstSentence(resolveText(INTRO, { ...BASE, houseArea: '' }, 2)),
    'בית מגורים בכפר ורדים, עם פיתוח מגרש של כ-490 מ״ר.')
})
test('אף אחד', () => {
  assert.equal(
    firstSentence(resolveText(INTRO, { ...BASE, houseArea: '', plotArea: '' }, 2)),
    'בית מגורים בכפר ורדים.')
})

console.log('\n ארבעת מצבי השטחים — תכולת השירות')
test('שניהם', () => {
  assert.equal(
    upToService(resolveText(SCOPE, BASE, 2)),
    'תכנון אדריכלי, רישוי וליווי של פרויקט בניית בית מגורים (כ-200 מ״ר), לרבות פיתוח שטח המגרש (כ-490 מ״ר).')
})
test('בית בלבד', () => {
  assert.equal(
    upToService(resolveText(SCOPE, { ...BASE, plotArea: '' }, 2)),
    'תכנון אדריכלי, רישוי וליווי של פרויקט בניית בית מגורים (כ-200 מ״ר), לרבות פיתוח שטח המגרש.')
})
test('מגרש בלבד', () => {
  assert.equal(
    upToService(resolveText(SCOPE, { ...BASE, houseArea: '' }, 2)),
    'תכנון אדריכלי, רישוי וליווי של פרויקט בניית בית מגורים, לרבות פיתוח שטח המגרש (כ-490 מ״ר).')
})
test('אף אחד', () => {
  assert.equal(
    upToService(resolveText(SCOPE, { ...BASE, houseArea: '', plotArea: '' }, 2)),
    'תכנון אדריכלי, רישוי וליווי של פרויקט בניית בית מגורים, לרבות פיתוח שטח המגרש.')
})

console.log('\n יחיד מול רבים')
test('לקוח אחד', () => {
  assert.equal(
    resolveText(GREETING, { ...BASE, firstNames: 'דנה' }, 1),
    'דנה,\nבוא נבנה\nלך בית.')
})
test('שני לקוחות', () => {
  assert.equal(
    resolveText(GREETING, BASE, 2),
    'דנה ויואב,\nבואו נבנה\nלכם בית.')
})
test('שורות חדשות נשמרות', () => {
  assert.equal(resolveText(GREETING, BASE, 2).split('\n').length, 3)
})
test('clientCount שלא נמסר = יחיד', () => {
  assert.equal(resolveText('{בוא|בואו}', {}), 'בוא')
})

console.log('\n יישוב ריק')
test('היישוב נעלם עם המילית שלו', () => {
  assert.equal(
    firstSentence(resolveText(INTRO, { ...BASE, settlement: '' }, 2)),
    'בית מגורים של כ-200 מ״ר, עם פיתוח מגרש של כ-490 מ״ר.')
})
test('הכול ריק — המשפט עדיין שלם', () => {
  assert.equal(
    firstSentence(resolveText(INTRO, { firstNames: 'דנה' }, 1)),
    'בית מגורים.')
})

console.log('\n טקסט בלי תחביר (שדה "קפוא")')
test('מחרוזת רגילה חוזרת כמו שהיא', () => {
  const plain = 'דנה ויואב, בואו נבנה לכם בית בכפר ורדים.'
  assert.equal(resolveText(plain, BASE, 2), plain)
})
test('טקסט ארוך בלי אף טוקן', () => {
  const body = section('terms').groups[0].items[0].body
  assert.equal(resolveText(body, BASE, 2), body)
})

console.log('\n קלט שעלול לשבור')
test('טקסט שנראה כמו JSON לא נוגעים בו', () => {
  const json = 'הערה: {"a": 1, "b": [2,3]} — כולל סוגריים.'
  assert.equal(resolveText(json, BASE, 2), json)
})
test('סוגריים מסולסלים ריקים', () => {
  assert.equal(resolveText('לפני {} אחרי', BASE, 2), 'לפני {} אחרי')
})
test('null ו-undefined מחזירים מחרוזת ריקה', () => {
  assert.equal(resolveText(null, BASE, 2), '')
  assert.equal(resolveText(undefined, BASE, 2), '')
})
test('מחרוזת ריקה', () => {
  assert.equal(resolveText('', BASE, 2), '')
})
test('משתנה שלא קיים נמחק ולא מודפס כ-undefined', () => {
  assert.equal(resolveText('א {{nope}} ב', BASE, 2), 'א  ב')
})
test('קטע מותנה בלי משתנה בפנים — הסוגריים יורדים, הטקסט נשאר', () => {
  assert.equal(resolveText('א [[ב]] ג', BASE, 2), 'א ב ג')
})
test('קטע מותנה עם שני משתנים נמחק אם אחד ריק', () => {
  const t = 'בית[[ של כ-{{houseArea}} מ״ר ב{{settlement}}]].'
  assert.equal(resolveText(t, BASE, 2), 'בית של כ-200 מ״ר בכפר ורדים.')
  assert.equal(resolveText(t, { ...BASE, settlement: '' }, 2), 'בית.')
})
test('רווחים בלבד נחשבים ריק', () => {
  assert.equal(resolveText('בית[[ של כ-{{houseArea}} מ״ר]].', { houseArea: '   ' }, 1), 'בית.')
})
test('0 אינו ריק', () => {
  assert.equal(resolveText('[[{{n}} מ״ר]]', { n: 0 }, 1), '0 מ״ר')
})
test('קריאות חוזרות יציבות (אין lastIndex דביק)', () => {
  const t = '{א|ב} {{settlement}} [[כ-{{houseArea}}]]'
  const first = resolveText(t, BASE, 2)
  assert.equal(resolveText(t, BASE, 2), first)
  assert.equal(resolveText(t, BASE, 2), first)
})

console.log('\n deriveFirstNames / isFilled')
test('שם אחד', () => assert.equal(deriveFirstNames(['דנה']), 'דנה'))
test('שני שמות', () => assert.equal(deriveFirstNames(['דנה', 'יואב']), 'דנה ויואב'))
test('שם שני ריק נופל', () => assert.equal(deriveFirstNames(['דנה', '  ']), 'דנה'))
test('בלי שמות', () => assert.equal(deriveFirstNames([]), ''))
test('isFilled', () => {
  assert.equal(isFilled(''), false)
  assert.equal(isFilled('  '), false)
  assert.equal(isFilled(null), false)
  assert.equal(isFilled(undefined), false)
  assert.equal(isFilled(0), true)
  assert.equal(isFilled('200'), true)
})

console.log('\n' + (failed === 0
  ? `✅  ${passed} בדיקות עברו`
  : `❌  ${failed} נכשלו, ${passed} עברו`) + '\n')
process.exit(failed === 0 ? 0 : 1)
