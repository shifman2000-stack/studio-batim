/* ═══════════════════════════════════════════════════════════════════════
   בדיקות לעורך — מקושר/קפוא, סנכרון תבנית, וצ׳קליסט השליחה

   אין vitest בפרויקט, ולכן זה סקריפט node רגיל:

       node src/lib/quoteV2/editor.test.js

   שתי הלוגיקות הראשונות הן המקום שבו שקט יכול להישבר: שדה שקופא
   בלי שעינב התכוונה, או עדכון תבנית שדורס את השם של הלקוח הקודם.
   שתיהן נבדקות כאן ולא בעין.
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict'
import {
  fieldPath, frozenPaths, isFrozen, freeze, unfreeze,
  displayValue, canRestore, findById, templateRawOf,
} from './linked.js'
import { buildTemplateUpdate, describeTemplateChanges } from './templateSync.js'
import { sendChecklist, canSend, pctSum, waNumber, waLink } from './validate.js'
import {
  patchById, sectionByType, setClient, removeSecondClient, setProperty, setFee,
  setStagePct, addStage, removeStage, moveStage, toggleExtra,
  addGroup, removeGroup, moveGroup, addTerm, removeTerm, moveTerm,
  applyPoolVariant, isPoolOn,
} from './editorOps.js'

let passed = 0
let failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message) }
}

/* ── נתוני בסיס ──────────────────────────────────────────────────── */

const TEMPLATE = {
  schema: 2,
  sections: [
    { id: 'sec_open', type: 'opening', enabled: true,
      greeting: '{{firstNames}}, {בוא|בואו} נבנה {לך|לכם} בית.',
      intro: 'בית מגורים[[ של כ-{{houseArea}} מ״ר]] ב{{settlement}}.' },
    { id: 'sec_scope', type: 'scope', enabled: true, pdfTitle: 'תכולת השירות', body: 'תכנון אדריכלי.' },
    { id: 'sec_stages', type: 'stages', enabled: true, pdfTitle: 'פירוט שלבי העבודה',
      items: [
        { id: 'st_1', formalName: 'איסוף מידע', pct: 60, trigger: 'עם חתימת החוזה',
          process: 'פגישת פרוגרמה.', output: 'סקיצות.', storyTitle: 'מקשיבים', storyBody: 'נשב יחד.',
          storyDeliverable: 'סקיצות.', shortLabel: 'מקשיבים' },
        { id: 'st_2', formalName: 'פיתוח', pct: 40, trigger: 'עם מסירת סקיצות',
          process: 'עיבוד.', output: 'תוכניות.', storyTitle: 'צורה', storyBody: 'נפתח.',
          storyDeliverable: 'תוכניות.', shortLabel: 'צורה' },
      ] },
    { id: 'sec_terms', type: 'terms', enabled: true, title: 'ומה אם…?',
      groups: [
        { id: 'grp_a', title: 'שינויים', items: [
          { id: 'tm_1', formalTitle: 'התאמה', body: 'הנוסח המחייב.', question: '…ישתנה?', marketingAnswer: '' },
        ] },
      ] },
  ],
}

const clone = o => JSON.parse(JSON.stringify(o))

function quoteFrom(template) {
  return {
    ...clone(template),
    meta: { createdAt: 'x', date: '1.1.26', frozen: [] },
    clients: [{ firstName: 'דנה', lastName: 'כהן' }],
    property: { settlement: 'נגבה', houseArea: '200', plotArea: '' },
    vars: { firstNames: 'דנה', settlement: 'נגבה', houseArea: '200', plotArea: '' },
    totals: { fee: 100000, currency: 'ILS', vatIncluded: false },
    clientResponse: { extrasSelected: [], consentChecked: false, signatures: [] },
  }
}

/* ── מקושר / קפוא ────────────────────────────────────────────────── */

console.log('\n מקושר / קפוא')

test('fieldPath', () => assert.equal(fieldPath('st_1', 'storyBody'), 'st_1.storyBody'))

test('ברירת מחדל: שום שדה לא קפוא', () => {
  const q = quoteFrom(TEMPLATE)
  assert.deepEqual(frozenPaths(q), [])
  assert.equal(isFrozen(q, 'sec_open', 'greeting'), false)
})

test('freeze מוסיף נתיב ולא משנה את הקלט', () => {
  const q = quoteFrom(TEMPLATE)
  const after = freeze(q, 'sec_open', 'greeting')
  assert.equal(isFrozen(after, 'sec_open', 'greeting'), true)
  assert.equal(isFrozen(q, 'sec_open', 'greeting'), false, 'הקלט השתנה')
})

test('freeze פעמיים לא מכפיל', () => {
  let q = quoteFrom(TEMPLATE)
  q = freeze(q, 'st_1', 'storyBody')
  q = freeze(q, 'st_1', 'storyBody')
  assert.equal(frozenPaths(q).length, 1)
})

test('unfreeze מסיר', () => {
  let q = freeze(quoteFrom(TEMPLATE), 'st_1', 'storyBody')
  q = unfreeze(q, 'st_1', 'storyBody')
  assert.deepEqual(frozenPaths(q), [])
})

test('unfreeze על שדה שאינו קפוא לא עושה כלום', () => {
  const q = quoteFrom(TEMPLATE)
  assert.equal(unfreeze(q, 'st_1', 'x'), q)
})

test('שדה מקושר מוצג פתור — יחיד', () => {
  assert.equal(
    displayValue({ raw: TEMPLATE.sections[0].greeting, frozen: false, vars: { firstNames: 'דנה' }, clientCount: 1 }),
    'דנה, בוא נבנה לך בית.')
})

test('שדה מקושר מוצג פתור — רבים', () => {
  assert.equal(
    displayValue({ raw: TEMPLATE.sections[0].greeting, frozen: false, vars: { firstNames: 'דנה ויואב' }, clientCount: 2 }),
    'דנה ויואב, בואו נבנה לכם בית.')
})

test('קטע מותנה נעלם כששטח ריק', () => {
  const raw = TEMPLATE.sections[0].intro
  assert.equal(displayValue({ raw, frozen: false, vars: { settlement: 'נגבה', houseArea: '200' }, clientCount: 1 }),
    'בית מגורים של כ-200 מ״ר בנגבה.')
  assert.equal(displayValue({ raw, frozen: false, vars: { settlement: 'נגבה', houseArea: '' }, clientCount: 1 }),
    'בית מגורים בנגבה.')
})

test('שדה קפוא מוצג מילה במילה — בלי פתירה', () => {
  assert.equal(
    displayValue({ raw: 'דנה, בואי נבנה לך בית. {לא|יפתר}', frozen: true, vars: {}, clientCount: 2 }),
    'דנה, בואי נבנה לך בית. {לא|יפתר}')
})

test('שדה קפוא לא מתעדכן עם מספר הלקוחות — תופעת הלוואי המתועדת', () => {
  const typed = 'דנה, בואי נבנה לך בית.'
  assert.equal(displayValue({ raw: typed, frozen: true, vars: { firstNames: 'דנה ויואב' }, clientCount: 2 }), typed)
})

test('canRestore רק כשקפוא ויש מקור בתבנית', () => {
  assert.equal(canRestore({ frozen: true, templateRaw: 'x' }), true)
  assert.equal(canRestore({ frozen: false, templateRaw: 'x' }), false)
  assert.equal(canRestore({ frozen: true, templateRaw: undefined }), false, 'שלב חדש — אין נוסח אוטומטי')
})

test('findById מוצא סעיף, שלב, קבוצה ותנאי', () => {
  assert.equal(findById(TEMPLATE, 'sec_open')?.type, 'opening')
  assert.equal(findById(TEMPLATE, 'st_2')?.formalName, 'פיתוח')
  assert.equal(findById(TEMPLATE, 'grp_a')?.title, 'שינויים')
  assert.equal(findById(TEMPLATE, 'tm_1')?.formalTitle, 'התאמה')
  assert.equal(findById(TEMPLATE, 'nope'), undefined)
})

test('templateRawOf מחזיר את הגולמי, ו-undefined כשאין', () => {
  assert.equal(templateRawOf(TEMPLATE, 'st_1', 'storyBody'), 'נשב יחד.')
  assert.equal(templateRawOf(TEMPLATE, 'st_1', 'noSuchField'), undefined)
  assert.equal(templateRawOf(TEMPLATE, 'st_99', 'storyBody'), undefined)
})

test('הנתיב שורד סידור מחדש של שלבים', () => {
  let q = quoteFrom(TEMPLATE)
  q = freeze(q, 'st_2', 'storyBody')
  const stages = q.sections.find(s => s.type === 'stages')
  stages.items.reverse()
  assert.equal(isFrozen(q, 'st_2', 'storyBody'), true)
  assert.equal(stages.items[0].id, 'st_2')
})

/* ── סנכרון תבנית ────────────────────────────────────────────────── */

console.log('\n עדכון התבנית')

test('שינוי ניסוח בסעיף נכנס לתבנית', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.id === 'sec_scope').body = 'נוסח חדש.'
  const out = buildTemplateUpdate(TEMPLATE, q)
  assert.equal(out.sections.find(s => s.id === 'sec_scope').body, 'נוסח חדש.')
})

test('נתוני ההצעה לא נכנסים לתבנית', () => {
  const q = quoteFrom(TEMPLATE)
  const out = buildTemplateUpdate(TEMPLATE, q)
  for (const k of ['clients', 'property', 'vars', 'totals', 'clientResponse', 'meta']) {
    assert.equal(k in out, false, `${k} דלף לתבנית`)
  }
})

test('התבנית המקורית לא משתנה', () => {
  const before = JSON.stringify(TEMPLATE)
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.id === 'sec_scope').body = 'אחר'
  buildTemplateUpdate(TEMPLATE, q)
  assert.equal(JSON.stringify(TEMPLATE), before)
})

test('שלב מתעדכן לפי id ולא לפי מיקום', () => {
  const q = quoteFrom(TEMPLATE)
  const stages = q.sections.find(s => s.type === 'stages')
  stages.items.reverse()                       // st_2 ראשון עכשיו
  stages.items.find(s => s.id === 'st_1').process = 'תהליך מעודכן.'
  const out = buildTemplateUpdate(TEMPLATE, q)
  const tplStages = out.sections.find(s => s.type === 'stages').items
  assert.equal(tplStages.find(s => s.id === 'st_1').process, 'תהליך מעודכן.')
  assert.equal(tplStages.find(s => s.id === 'st_2').process, 'עיבוד.', 'שלב אחר נדרס')
})

test('שלב חדש נוסף לתבנית', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'stages').items.push({ id: 'st_new', formalName: 'חדש', pct: 0 })
  const out = buildTemplateUpdate(TEMPLATE, q)
  const ids = out.sections.find(s => s.type === 'stages').items.map(s => s.id)
  assert.deepEqual(ids, ['st_1', 'st_2', 'st_new'])
})

test('שלב שהוסר מההצעה נשאר בתבנית — עדכון ותוספת, לא מחיקה', () => {
  const q = quoteFrom(TEMPLATE)
  const stages = q.sections.find(s => s.type === 'stages')
  stages.items = stages.items.filter(s => s.id !== 'st_2')
  const out = buildTemplateUpdate(TEMPLATE, q)
  const ids = out.sections.find(s => s.type === 'stages').items.map(s => s.id)
  assert.deepEqual(ids, ['st_1', 'st_2'])
})

test('תנאי בתוך קבוצה מתעדכן לפי id', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'terms').groups[0].items[0].body = 'נוסח מחייב חדש.'
  const out = buildTemplateUpdate(TEMPLATE, q)
  assert.equal(out.sections.find(s => s.type === 'terms').groups[0].items[0].body, 'נוסח מחייב חדש.')
})

test('קבוצה חדשה עם תנאי חדש נוספת', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'terms').groups.push({
    id: 'grp_b', title: 'חדש', items: [{ id: 'tm_9', formalTitle: 'ת', body: 'ב', question: 'ש', marketingAnswer: '' }],
  })
  const out = buildTemplateUpdate(TEMPLATE, q)
  const groups = out.sections.find(s => s.type === 'terms').groups
  assert.equal(groups.length, 2)
  assert.equal(groups[1].items[0].id, 'tm_9')
})

test('שם קבוצה מתעדכן', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'terms').groups[0].title = 'שינויים ותוספות'
  const out = buildTemplateUpdate(TEMPLATE, q)
  assert.equal(out.sections.find(s => s.type === 'terms').groups[0].title, 'שינויים ותוספות')
})

test('pct לא נחשב שינוי ניסוח ב-describe', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'stages').items[0].pct = 70
  assert.deepEqual(describeTemplateChanges(TEMPLATE, q), [])
})

test('describeTemplateChanges מזהה שינוי ומאחד שדות לפריט אחד', () => {
  const q = quoteFrom(TEMPLATE)
  const st = q.sections.find(s => s.type === 'stages').items[0]
  st.process = 'אחר'
  st.output = 'גם אחר'
  const ch = describeTemplateChanges(TEMPLATE, q)
  assert.equal(ch.length, 1)
  assert.match(ch[0].label, /איסוף מידע/)
})

test('בלי שינויים — רשימה ריקה', () => {
  assert.deepEqual(describeTemplateChanges(TEMPLATE, quoteFrom(TEMPLATE)), [])
})

test('buildTemplateUpdate על תבנית בלי sections זורק', () => {
  assert.throws(() => buildTemplateUpdate({}, quoteFrom(TEMPLATE)))
})

/* ── צ׳קליסט השליחה ──────────────────────────────────────────────── */

console.log('\n צ׳קליסט השליחה')

test('הצעה תקינה עוברת', () => {
  const q = quoteFrom(TEMPLATE)
  assert.equal(canSend(q), true, JSON.stringify(sendChecklist(q).filter(c => !c.ok)))
})

test('pctSum', () => assert.equal(pctSum([{ pct: 60 }, { pct: 40 }]), 100))

test('אחוזים שאינם 100 חוסמים', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'stages').items[0].pct = 50
  const bad = sendChecklist(q).filter(c => !c.ok)
  assert.equal(bad.length, 1)
  assert.match(bad[0].text, /90%/)
})

test('בלי שכר טרחה חוסם', () => {
  const q = quoteFrom(TEMPLATE)
  q.totals.fee = 0
  assert.equal(canSend(q), false)
})

test('בלי שם לקוח חוסם', () => {
  const q = quoteFrom(TEMPLATE)
  q.clients = []
  assert.match(sendChecklist(q).find(c => !c.ok).text, /שם הלקוח/)
})

test('שלב בלי שם או בלי מועד תשלום חוסם', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'stages').items[0].formalName = ''
  assert.match(sendChecklist(q).find(c => !c.ok).text, /בלי שם/)
  const q2 = quoteFrom(TEMPLATE)
  q2.sections.find(s => s.type === 'stages').items[1].trigger = '   '
  assert.match(sendChecklist(q2).find(c => !c.ok).text, /מועד תשלום/)
})

test('תנאי בלי נוסח מחייב חוסם', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'terms').groups[0].items[0].body = ''
  assert.match(sendChecklist(q).find(c => !c.ok).text, /נוסח מחייב/)
})

test('בלי תנאים בכלל חוסם', () => {
  const q = quoteFrom(TEMPLATE)
  q.sections.find(s => s.type === 'terms').groups = []
  assert.equal(canSend(q), false)
})

test('שלב כבוי לא נספר באחוזים', () => {
  const q = quoteFrom(TEMPLATE)
  const items = q.sections.find(s => s.type === 'stages').items
  items[0].pct = 100
  items[1].enabled = false
  assert.equal(canSend(q), true)
})

test('שטחים ריקים חוקיים', () => {
  const q = quoteFrom(TEMPLATE)
  q.property.houseArea = ''
  q.property.plotArea = ''
  q.vars.houseArea = ''
  q.vars.plotArea = ''
  assert.equal(canSend(q), true)
})

console.log('\n וואטסאפ')
test('waNumber מנרמל מספר ישראלי', () => {
  assert.equal(waNumber('050-491-2244'), '972504912244')
  assert.equal(waNumber('972504912244'), '972504912244')
  assert.equal(waNumber(''), '')
  assert.equal(waNumber(null), '')
})
test('waLink מכיל את הקישור ואת השם', () => {
  const l = waLink('0504912244', 'דנה', 'https://x.test/quote/abc')
  assert.match(l, /^https:\/\/wa\.me\/972504912244\?text=/)
  assert.match(decodeURIComponent(l), /דנה/)
  assert.match(decodeURIComponent(l), /https:\/\/x\.test\/quote\/abc/)
})

/* ── פעולות העורך ────────────────────────────────────────────────── */

console.log('\n פעולות העורך')

test('patchById לא נוגע בקלט', () => {
  const q = quoteFrom(TEMPLATE)
  const before = JSON.stringify(q)
  patchById(q, 'st_1', { formalName: 'אחר' })
  assert.equal(JSON.stringify(q), before)
})

test('patchById על סעיף, שלב, קבוצה ותנאי', () => {
  let q = quoteFrom(TEMPLATE)
  q = patchById(q, 'sec_scope', { body: 'א' })
  q = patchById(q, 'st_2', { process: 'ב' })
  q = patchById(q, 'grp_a', { title: 'ג' })
  q = patchById(q, 'tm_1', { body: 'ד' })
  assert.equal(findById(q, 'sec_scope').body, 'א')
  assert.equal(findById(q, 'st_2').process, 'ב')
  assert.equal(findById(q, 'grp_a').title, 'ג')
  assert.equal(findById(q, 'tm_1').body, 'ד')
})

test('לקוח שני מעביר את הדקדוק לרבים', () => {
  let q = quoteFrom(TEMPLATE)
  assert.equal(q.vars.firstNames, 'דנה')
  q = setClient(q, 1, { firstName: 'יואב', lastName: 'כהן' })
  assert.equal(q.clients.length, 2)
  assert.equal(q.vars.firstNames, 'דנה ויואב')
  assert.equal(
    displayValue({ raw: findById(q, 'sec_open').greeting, frozen: false, vars: q.vars, clientCount: q.clients.length }),
    'דנה ויואב, בואו נבנה לכם בית.')
})

test('הסרת הלקוח השני מחזירה ליחיד', () => {
  let q = setClient(quoteFrom(TEMPLATE), 1, { firstName: 'יואב' })
  q = removeSecondClient(q)
  assert.equal(q.clients.length, 1)
  assert.equal(q.vars.firstNames, 'דנה')
})

test('ריקון שטח הבית מקצר את המשפט', () => {
  let q = setProperty(quoteFrom(TEMPLATE), { houseArea: '' })
  assert.equal(q.vars.houseArea, '')
  assert.equal(
    displayValue({ raw: findById(q, 'sec_open').intro, frozen: false, vars: q.vars, clientCount: 1 }),
    'בית מגורים בנגבה.')
})

test('setFee מעדכן גם totals וגם vars', () => {
  const q = setFee(quoteFrom(TEMPLATE), '250000')
  assert.equal(q.totals.fee, 250000)
  assert.equal(q.vars.fee, 250000)
})

test('setStagePct מנקה תווים ומגביל ל-0..100', () => {
  let q = quoteFrom(TEMPLATE)
  q = setStagePct(q, 'st_1', '45%')
  assert.equal(findById(q, 'st_1').pct, 45)
  q = setStagePct(q, 'st_1', '900')
  assert.equal(findById(q, 'st_1').pct, 100)
  q = setStagePct(q, 'st_1', 'אבג')
  assert.equal(findById(q, 'st_1').pct, 0)
})

test('addStage מוסיף בסוף ומחזיר id', () => {
  const { content, id } = addStage(quoteFrom(TEMPLATE), { formalName: 'חדש' })
  const items = sectionByType(content, 'stages').items
  assert.equal(items.length, 3)
  assert.equal(items[2].id, id)
  assert.equal(items[2].formalName, 'חדש')
  assert.equal(items[2].pct, 0)
})

test('removeStage', () => {
  const q = removeStage(quoteFrom(TEMPLATE), 'st_1')
  assert.deepEqual(sectionByType(q, 'stages').items.map(s => s.id), ['st_2'])
})

test('moveStage למעלה ולמטה, וחסימה בקצוות', () => {
  const q = quoteFrom(TEMPLATE)
  assert.deepEqual(sectionByType(moveStage(q, 'st_2', -1), 'stages').items.map(s => s.id), ['st_2', 'st_1'])
  assert.deepEqual(sectionByType(moveStage(q, 'st_1', 1), 'stages').items.map(s => s.id), ['st_2', 'st_1'])
  assert.equal(moveStage(q, 'st_1', -1), q, 'הראשון למעלה — בלי שינוי')
  assert.equal(moveStage(q, 'st_2', 1), q, 'האחרון למטה — בלי שינוי')
})

test('קבוצות ותנאים — הוספה, מחיקה, סידור', () => {
  let q = quoteFrom(TEMPLATE)
  const g = addGroup(q, 'לוחות זמנים'); q = g.content
  assert.equal(sectionByType(q, 'terms').groups.length, 2)

  const t = addTerm(q, g.id, { body: 'נוסח' }); q = t.content
  assert.equal(findById(q, t.id).body, 'נוסח')

  const t2 = addTerm(q, g.id, { body: 'שני' }); q = t2.content
  q = moveTerm(q, t2.id, -1)
  assert.deepEqual(sectionByType(q, 'terms').groups[1].items.map(i => i.id), [t2.id, t.id])

  q = moveGroup(q, g.id, -1)
  assert.equal(sectionByType(q, 'terms').groups[0].id, g.id)

  q = removeTerm(q, t2.id)
  assert.equal(sectionByType(q, 'terms').groups[0].items.length, 1)

  q = removeGroup(q, g.id)
  assert.equal(sectionByType(q, 'terms').groups.length, 1)
})

test('moveTerm לא מעביר בין קבוצות', () => {
  let q = quoteFrom(TEMPLATE)
  const g = addGroup(q, 'שנייה'); q = g.content
  const t = addTerm(q, g.id, { body: 'ב' }); q = t.content
  const same = moveTerm(q, t.id, -1)     // ראשון בקבוצה שלו
  assert.equal(same, q)
})

test('toggleExtra מכבה ומדליק', () => {
  let q = quoteFrom(TEMPLATE)
  q.sections.push({ id: 'sec_extras', type: 'extras', enabled: true, items: [{ id: 'ex_1', title: 'נגרות' }] })
  q = toggleExtra(q, 'ex_1')
  assert.equal(findById(q, 'ex_1').enabled, false)
  q = toggleExtra(q, 'ex_1')
  assert.equal(findById(q, 'ex_1').enabled, true)
})

/* ── וריאנט הבריכה ───────────────────────────────────────────────── */

console.log('\n וריאנט הבריכה')

const LIB = [
  { type: 'scope', tags: ['בית מגורים'], archived: false, payload: { body: 'תכנון אדריכלי.' } },
  { type: 'scope', tags: ['בית מגורים', 'בריכה'], archived: false, payload: { body: 'תכנון אדריכלי, כולל בריכה.' } },
  { type: 'stage', tags: ['שלב'], archived: false, payload: { formalName: 'איסוף מידע', process: 'פגישת פרוגרמה.', pct: 15 } },
  { type: 'stage', tags: ['שלב', 'בריכה'], archived: false, payload: { formalName: 'איסוף מידע', process: 'פגישת פרוגרמה, כולל בריכה.', pct: 15 } },
]

test('הוספת בריכה מחליפה תכולה ושלב', () => {
  const q = applyPoolVariant(quoteFrom(TEMPLATE), LIB, true)
  assert.equal(findById(q, 'sec_scope').body, 'תכנון אדריכלי, כולל בריכה.')
  assert.equal(findById(q, 'st_1').process, 'פגישת פרוגרמה, כולל בריכה.')
  assert.equal(findById(q, 'st_2').process, 'עיבוד.', 'שלב שאינו בווריאנט נדרס')
})

test('הסרת בריכה מחזירה את ברירת המחדל', () => {
  let q = applyPoolVariant(quoteFrom(TEMPLATE), LIB, true)
  q = applyPoolVariant(q, LIB, false)
  assert.equal(findById(q, 'sec_scope').body, 'תכנון אדריכלי.')
  assert.equal(findById(q, 'st_1').process, 'פגישת פרוגרמה.')
})

test('הבריכה לא דורסת אחוזים שעינב שינתה', () => {
  let q = setStagePct(quoteFrom(TEMPLATE), 'st_1', 33)
  q = applyPoolVariant(q, LIB, true)
  assert.equal(findById(q, 'st_1').pct, 33)
})

test('הבריכה שומרת על ה-id של השלב', () => {
  const q = applyPoolVariant(quoteFrom(TEMPLATE), LIB, true)
  assert.deepEqual(sectionByType(q, 'stages').items.map(s => s.id), ['st_1', 'st_2'])
})

test('isPoolOn', () => {
  const q = quoteFrom(TEMPLATE)
  assert.equal(isPoolOn(q, LIB), false)
  assert.equal(isPoolOn(applyPoolVariant(q, LIB, true), LIB), true)
})

test('ספרייה ריקה לא מפילה', () => {
  const q = quoteFrom(TEMPLATE)
  assert.equal(applyPoolVariant(q, [], true).sections.length, q.sections.length)
  assert.equal(isPoolOn(q, []), false)
})

console.log('\n' + (failed === 0
  ? `✅  ${passed} בדיקות עברו`
  : `❌  ${failed} נכשלו, ${passed} עברו`) + '\n')
process.exit(failed === 0 ? 0 : 1)
