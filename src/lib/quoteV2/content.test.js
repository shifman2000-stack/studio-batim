/* ═══════════════════════════════════════════════════════════════════════
   בדיקות ל-content.js — signersOf ושאר העוזרים

   אין vitest בפרויקט, ולכן זה סקריפט node רגיל:

       node src/lib/quoteV2/content.test.js

   signersOf הוא המקור היחיד לשמות ולת.ז. במסמך הכתוב — גם בשער וגם
   בבלוק אישור ההצעה. אם הוא ישתנה בלי כוונה, מסמך חתום יציג שם אחד
   בשער ושם אחר ליד החתימה. לכן הוא נבדק כאן ולא רק בעין.
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict'
import {
  signersOf, signaturesOf, isSignedContent, clientCountOf, varsOf, isV2,
} from './content.js'

let passed = 0
let failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message) }
}

const img = i => `data:image/png;base64,FAKE${i}`

const two = {
  schema: 2,
  clients: [
    { firstName: 'דנה', lastName: 'כהן' },
    { firstName: 'יואב', lastName: 'לוי' },
  ],
  clientResponse: { signatures: [] },
}
const twoSigned = {
  ...two,
  clientResponse: {
    consentChecked: true,
    signatures: [
      { clientIndex: 0, name: 'דנה כהן לוי', idNumber: '039182746', image: img(0) },
      { clientIndex: 1, name: 'יואב כהן לוי', idNumber: '027465183', image: img(1) },
    ],
  },
}

console.log('\n signersOf — לפני חתימה')
test('אורך לפי מספר המזמינים', () => assert.equal(signersOf(two).length, 2))
test('שם מהפנייה', () => assert.equal(signersOf(two)[1].name, 'יואב לוי'))
test('ת.ז. ריקה', () => assert.equal(signersOf(two)[0].idNumber, ''))
test('signed=false', () => assert.equal(signersOf(two)[0].signed, false))

console.log('\n signersOf — אחרי חתימה')
test('השם שהוקלד גובר על שם הפנייה', () => {
  assert.equal(signersOf(twoSigned)[0].name, 'דנה כהן לוי')
  assert.equal(signersOf(twoSigned)[1].name, 'יואב כהן לוי')
})
test('ת.ז. שהוקלדה', () => assert.equal(signersOf(twoSigned)[1].idNumber, '027465183'))
test('signed=true לשניהם', () =>
  assert.deepEqual(signersOf(twoSigned).map(s => s.signed), [true, true]))

console.log('\n signersOf — מקרי קצה')
test('התאמה לפי clientIndex ולא לפי מקום במערך', () => {
  const reversed = {
    ...two,
    clientResponse: {
      signatures: [
        { clientIndex: 1, name: 'יואב', idNumber: '2', image: img(1) },
        { clientIndex: 0, name: 'דנה', idNumber: '1', image: img(0) },
      ],
    },
  }
  assert.equal(signersOf(reversed)[0].name, 'דנה')
  assert.equal(signersOf(reversed)[1].name, 'יואב')
})
test('שם ריק בחתימה נופל לשם הפנייה', () => {
  const blank = {
    ...two,
    clientResponse: { signatures: [{ clientIndex: 0, name: '   ', image: img(0) }] },
  }
  assert.equal(signersOf(blank)[0].name, 'דנה כהן')
})
test('count מפורש גובר (המעבדה מרנדרת תבנית בלי clients)', () => {
  const template = { schema: 2, sections: [] }
  assert.equal(signersOf(template).length, 1)
  assert.equal(signersOf(template, 2).length, 2)
})
test('content ריק לא מפיל', () => assert.equal(signersOf(null).length, 1))

console.log('\n עוזרים')
test('clientCountOf', () => {
  assert.equal(clientCountOf(two), 2)
  assert.equal(clientCountOf({}), 1)
  assert.equal(clientCountOf(null), 1)
})
test('isSignedContent', () => {
  assert.equal(isSignedContent(two), false)
  assert.equal(isSignedContent(twoSigned), true)
})
test('signaturesOf תמיד מערך', () => {
  assert.deepEqual(signaturesOf(null), [])
  assert.equal(signaturesOf(twoSigned).length, 2)
})
test('isV2', () => {
  assert.equal(isV2(two), true)
  assert.equal(isV2({ schema: 1 }), false)
})
test('varsOf נופל ל-{}', () => assert.deepEqual(varsOf(null), {}))

console.log('\n' + (failed === 0
  ? `✅  ${passed} בדיקות עברו`
  : `❌  ${failed} נכשלו, ${passed} עברו`) + '\n')
process.exit(failed === 0 ? 0 : 1)
