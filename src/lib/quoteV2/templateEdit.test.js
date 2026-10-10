/* ═══════════════════════════════════════════════════════════════════════
   בדיקות להמרה חזרה לנוסח תבנית

       node src/lib/quoteV2/templateEdit.test.js

   זו הלוגיקה שבה טעות שקטה הכי יקרה: תבנית שנשמרה עם "לקוח1" או
   "נגבה" בתוכה תוליד מעכשיו כל הצעה חדשה עם שם הלקוח הלא נכון.
   לכן הבדיקות רצות גם על **הטקסטים האמיתיים מהזריעה** ולא רק על
   דוגמאות מומצאות, ובודקות הלוך-ושוב מלא: נוסח → פתירה → המרה
   חזרה → אותו נוסח.
   ═══════════════════════════════════════════════════════════════════════ */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { resolveText } from './resolve.js'
import {
  SAMPLE, sampleVars, sampleClients, varNamesIn, hasAlternates, hasVariables,
  detokenize, rebuildAlternates, rewrapOptional, toTemplateRaw, grammarBoxes,
  describeTemplateDiff, buildTemplateFromEditor,
} from './templateEdit.js'

const here = dirname(fileURLToPath(import.meta.url))
const SQL = resolvePath(here, '../../../docs/sql/quote-v2-phaseA.sql')
const template = JSON.parse(readFileSync(SQL, 'utf8').split('$json$')[1])

let passed = 0, failed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n      ' + e.message) }
}

const VS = sampleVars(false)
const VP = sampleVars(true)

/* ── נתוני הדוגמה ────────────────────────────────────────────────── */

console.log('\n נתוני הדוגמה')
test('שני לקוחות / לקוח אחד', () => {
  assert.equal(sampleVars(true).firstNames, 'לקוח1 ולקוח2')
  assert.equal(sampleVars(false).firstNames, 'לקוח1')
  assert.equal(sampleClients(true).length, 2)
  assert.equal(sampleClients(false).length, 1)
})
test('יישוב ושטחים', () => {
  assert.equal(VS.settlement, 'נגבה')
  assert.equal(VS.houseArea, '200')
  assert.equal(VS.plotArea, '500')
  assert.equal(VS.fee, 120000)
})

/* ── זיהוי ── */

console.log('\n זיהוי מנגנונים')
test('varNamesIn', () => {
  assert.deepEqual(varNamesIn('בית של כ-{{houseArea}} מ״ר ב{{settlement}}'), ['houseArea', 'settlement'])
  assert.deepEqual(varNamesIn('בלי משתנים'), [])
  assert.deepEqual(varNamesIn('{{a}} {{a}} {{b}}'), ['a', 'b'])
})
test('hasAlternates / hasVariables', () => {
  assert.equal(hasAlternates('{בוא|בואו} נבנה'), true)
  assert.equal(hasAlternates('בלי חלופות'), false)
  assert.equal(hasVariables('{{x}}'), true)
  assert.equal(hasVariables('{a|b}'), false)
})

/* ── החזרת משתנים ── */

console.log('\n החזרת ערכי דוגמה למשתנים')
test('ערך בודד', () => {
  assert.equal(detokenize('בית בנגבה', VS, ['settlement']), 'בית ב{{settlement}}')
})
test('הארוך קודם — "לקוח1 ולקוח2" לפני "לקוח1"', () => {
  const out = detokenize('לקוח1 ולקוח2, שלום', VP, ['firstNames'])
  assert.equal(out, '{{firstNames}}, שלום')
})
test('משתנה שלא היה בנוסח המקורי לא מוחזר', () => {
  /* עינב הקלידה "נגבה" בשדה שמעולם לא היה בו יישוב */
  assert.equal(detokenize('מתאים לנגבה בלבד', VS, ['houseArea']), 'מתאים לנגבה בלבד')
})
test('שטחים', () => {
  assert.equal(detokenize('בית 200 מ״ר, מגרש 500 מ״ר', VS, ['houseArea', 'plotArea']),
    'בית {{houseArea}} מ״ר, מגרש {{plotArea}} מ״ר')
})
test('ערך ריק לא מוחזר', () => {
  assert.equal(detokenize('טקסט', { settlement: '' }, ['settlement']), 'טקסט')
})

/* ── הרכבת חלופות ── */

console.log('\n הרכבת חלופות דקדוק')
test('מילה אחת שונה', () => {
  const r = rebuildAlternates('בוא נבנה לך בית.', 'בואו נבנה לכם בית.')
  assert.equal(r.ok, true)
  assert.equal(r.raw, '{בוא|בואו} נבנה {לך|לכם} בית.')
})
test('טקסט זהה — בלי חלופות', () => {
  const r = rebuildAlternates('אותו דבר', 'אותו דבר')
  assert.equal(r.raw, 'אותו דבר')
})
test('הלוך ושוב: ההרכבה נפתרת חזרה לשני הניסוחים', () => {
  const r = rebuildAlternates('מה אתה צריך, איך אתה חי', 'מה אתם צריכים, איך אתם חיים')
  assert.equal(r.ok, true)
  assert.equal(resolveText(r.raw, {}, 1), 'מה אתה צריך, איך אתה חי')
  assert.equal(resolveText(r.raw, {}, 2), 'מה אתם צריכים, איך אתם חיים')
})
test('תוספת מילה רק ברבים', () => {
  const r = rebuildAlternates('שלום', 'שלום לכולם')
  assert.equal(r.ok, true)
  assert.equal(resolveText(r.raw, {}, 1), 'שלום')
  assert.equal(resolveText(r.raw, {}, 2), 'שלום לכולם')
})
test('משתנה בתוך מקטע שנבדל — נכשל בבירור ולא בשקט', () => {
  const r = rebuildAlternates('של {{firstNames}}', 'של כולם')
  assert.equal(r.ok, false)
  assert.match(r.reason, /משתנה/)
})

/* ── קטעים מותנים ── */

console.log('\n קטעים מותנים')
test('קטע שנשאר זהה נעטף בחזרה', () => {
  const orig = 'בית מגורים[[ של כ-{{houseArea}} מ״ר]] ב{{settlement}}.'
  const edited = 'בית מגורים של כ-{{houseArea}} מ״ר ב{{settlement}}.'
  const r = rewrapOptional(edited, orig)
  assert.equal(r.raw, orig)
  assert.deepEqual(r.lost, [])
})
test('קטע שנוסח מחדש מדווח כאבוד', () => {
  const orig = 'בית[[ של {{houseArea}} מ״ר]] בעיר'
  const r = rewrapOptional('בית גדול בעיר', orig)
  assert.deepEqual(r.lost, [' של {{houseArea}} מ״ר'])
})

/* ── ההמרה המלאה ── */

console.log('\n ההמרה המלאה')

test('שורת הפתיחה האמיתית — הלוך ושוב מדויק', () => {
  const orig = template.sections.find(s => s.type === 'opening').greeting
  const boxes = grammarBoxes(orig)
  const { raw, warnings } = toTemplateRaw({ originalRaw: orig, singularText: boxes.singular, pluralText: boxes.plural })
  assert.deepEqual(warnings, [])
  assert.equal(resolveText(raw, VS, 1), resolveText(orig, VS, 1))
  assert.equal(resolveText(raw, VP, 2), resolveText(orig, VP, 2))
  assert.ok(raw.includes('{{firstNames}}'), 'המשתנה אבד: ' + raw)
})

test('פסקת הפתיחה האמיתית — משתנים וקטעים מותנים שורדים', () => {
  const orig = template.sections.find(s => s.type === 'opening').intro
  const boxes = grammarBoxes(orig)
  const { raw } = toTemplateRaw({ originalRaw: orig, singularText: boxes.singular, pluralText: boxes.plural })
  for (const n of varNamesIn(orig)) {
    assert.ok(raw.includes(`{{${n}}}`), `${n} אבד`)
  }
  assert.equal((raw.match(/\[\[/g) || []).length, (orig.match(/\[\[/g) || []).length, 'קטע מותנה אבד')
  assert.equal(resolveText(raw, VS, 1), resolveText(orig, VS, 1))
  assert.equal(resolveText(raw, VP, 2), resolveText(orig, VP, 2))
})

test('כל שדות הטקסט בתבנית — הלוך ושוב בלי אובדן', () => {
  const fails = []
  const walk = (obj, path) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (typeof v === 'string' && (v.includes('{{') || v.includes('{') || v.includes('[['))) {
        const boxes = grammarBoxes(v)
        const { raw } = toTemplateRaw({ originalRaw: v, singularText: boxes.singular, pluralText: boxes.plural })
        if (resolveText(raw, VS, 1) !== resolveText(v, VS, 1)) fails.push(`${path}.${k} יחיד`)
        if (resolveText(raw, VP, 2) !== resolveText(v, VP, 2)) fails.push(`${path}.${k} רבים`)
        for (const n of varNamesIn(v)) if (!raw.includes(`{{${n}}}`)) fails.push(`${path}.${k} איבד {{${n}}}`)
      } else if (v && typeof v === 'object') {
        walk(v, `${path}.${k}`)
      }
    }
  }
  walk(template, 'tpl')
  assert.deepEqual(fails, [])
})

test('עריכה אמיתית: עינב משנה את שורת הפתיחה בשני המצבים', () => {
  const orig = template.sections.find(s => s.type === 'opening').greeting
  const { raw, warnings } = toTemplateRaw({
    originalRaw: orig,
    singularText: 'לקוח1, בוא נתכנן לך בית.',
    pluralText: 'לקוח1 ולקוח2, בואו נתכנן לכם בית.',
  })
  assert.deepEqual(warnings, [])
  assert.ok(raw.includes('{{firstNames}}'), raw)
  assert.ok(!raw.includes('לקוח1'), 'שם הדוגמה נשאר בתבנית: ' + raw)
  /* ולקוח אמיתי אחר מקבל את השם שלו */
  assert.equal(resolveText(raw, { firstNames: 'דנה' }, 1), 'דנה, בוא נתכנן לך בית.')
  assert.equal(resolveText(raw, { firstNames: 'דנה ויואב' }, 2), 'דנה ויואב, בואו נתכנן לכם בית.')
})

test('עריכה של שדה עם שטחים — הערכים חוזרים להיות משתנים', () => {
  const orig = 'תכנון בית של כ-{{houseArea}} מ״ר ב{{settlement}}.'
  const { raw } = toTemplateRaw({
    originalRaw: orig,
    singularText: 'תכנון מלא לבית של כ-200 מ״ר בנגבה.',
  })
  assert.equal(raw, 'תכנון מלא לבית של כ-{{houseArea}} מ״ר ב{{settlement}}.')
  assert.equal(resolveText(raw, { houseArea: '350', settlement: 'להב' }, 1),
    'תכנון מלא לבית של כ-350 מ״ר בלהב.')
})

test('שדה בלי מנגנונים נשמר כמו שהוא', () => {
  const { raw, warnings } = toTemplateRaw({ originalRaw: 'טקסט פשוט', singularText: 'טקסט חדש' })
  assert.equal(raw, 'טקסט חדש')
  assert.deepEqual(warnings, [])
})

test('כשלון בהרכבת חלופה משאיר את הנוסח המקורי', () => {
  const orig = '{{firstNames}} {בוא|בואו}'
  const { raw, warnings } = toTemplateRaw({
    originalRaw: orig,
    singularText: 'לקוח1 בוא',
    pluralText: 'כולם בואו',      // firstNames נעלם רק מצד אחד
  })
  assert.equal(raw, orig, 'הנוסח המקורי לא נשמר')
  assert.equal(warnings.length, 1)
})

/* ── תיאור השינויים ── */

console.log('\n תיאור השינויים')
const clone = o => JSON.parse(JSON.stringify(o))

test('בלי שינוי — רשימה ריקה', () => {
  assert.deepEqual(describeTemplateDiff(template, clone(template)), [])
})
test('עריכת שלב', () => {
  const after = clone(template)
  after.sections.find(s => s.type === 'stages').items[0].process = 'אחר'
  const d = describeTemplateDiff(template, after)
  assert.equal(d.length, 1)
  assert.match(d[0], /^נערך בהשלבים/)
})
test('הוספה והסרה של שלב', () => {
  const after = clone(template)
  const st = after.sections.find(s => s.type === 'stages')
  st.items.push({ id: 'st_new', formalName: 'שלב חדש', pct: 0 })
  st.items.shift()
  const d = describeTemplateDiff(template, after)
  assert.ok(d.some(x => /נוסף/.test(x) && /שלב חדש/.test(x)), d.join(' | '))
  assert.ok(d.some(x => /הוסר/.test(x)), d.join(' | '))
})
test('הסרת תנאי', () => {
  const after = clone(template)
  const terms = after.sections.find(s => s.type === 'terms')
  terms.groups[0].items.pop()
  const d = describeTemplateDiff(template, after)
  assert.ok(d.some(x => /הוסר מהתנאים/.test(x)), d.join(' | '))
})
test('עריכת נוסח ברמת הסעיף', () => {
  const after = clone(template)
  after.sections.find(s => s.type === 'scope').body = 'נוסח חדש'
  assert.deepEqual(describeTemplateDiff(template, after), ['נערך נוסח: תכולת השירות'])
})

/* ── בניית התבנית ממצב העורך ─────────────────────────────────────── */

console.log('')
console.log(' בניית התבנית ממצב העורך')

/** מדמה את מה שהעורך מחזיק: תוכן עם נתוני דוגמה. */
function editorContent() {
  const c = clone(template)
  c.clients = sampleClients(true)
  c.property = { settlement: SAMPLE.settlement, houseArea: SAMPLE.houseArea, plotArea: SAMPLE.plotArea }
  c.vars = sampleVars(true)
  c.totals = { fee: SAMPLE.fee, currency: 'ILS', vatIncluded: false }
  c.clientResponse = { extrasSelected: [], consentChecked: false, signatures: [] }
  c.meta = { frozen: [] }
  return c
}

test('בלי עריכות — התבנית יוצאת זהה למקור', () => {
  const { content, warnings } = buildTemplateFromEditor(editorContent(), { edited: [] })
  assert.deepEqual(warnings, [])
  assert.equal(JSON.stringify(content.sections), JSON.stringify(template.sections))
})

test('נתוני ההצעה לא דולפים לתבנית', () => {
  const { content } = buildTemplateFromEditor(editorContent(), { edited: [] })
  for (const k of ['clients', 'property', 'vars', 'totals', 'clientResponse', 'meta']) {
    assert.equal(k in content, false, k + ' דלף')
  }
})

test('שדה ערוך מומר, שכנו לא נוגע', () => {
  const c = editorContent()
  const open = c.sections.find(s => s.type === 'opening')
  const origGreeting = open.greeting
  const origIntro = open.intro
  open.greeting = 'לקוח1, בוא נתכנן לך בית.'
  const { content, warnings } = buildTemplateFromEditor(c, {
    edited: ['sec_open.greeting'],
    origRaw: { 'sec_open.greeting': origGreeting },
    plural: { 'sec_open.greeting': 'לקוח1 ולקוח2, בואו נתכנן לכם בית.' },
  })
  assert.deepEqual(warnings, [])
  const outOpen = content.sections.find(s => s.type === 'opening')
  assert.ok(outOpen.greeting.includes('{{firstNames}}'), outOpen.greeting)
  assert.ok(!outOpen.greeting.includes('לקוח1'), outOpen.greeting)
  assert.equal(outOpen.intro, origIntro, 'שדה שלא נערך השתנה')
  assert.equal(resolveText(outOpen.greeting, { firstNames: 'דנה' }, 1), 'דנה, בוא נתכנן לך בית.')
  assert.equal(resolveText(outOpen.greeting, { firstNames: 'דנה ויואב' }, 2), 'דנה ויואב, בואו נתכנן לכם בית.')
})

test('"נגבה" בשדה שלא היה בו יישוב נשאר טקסט', () => {
  const c = editorContent()
  const st = c.sections.find(s => s.type === 'stages').items[0]
  const orig = st.process
  st.process = 'פגישה אחת בנגבה, ואז סקיצות.'
  const { content } = buildTemplateFromEditor(c, {
    edited: [st.id + '.process'],
    origRaw: { [st.id + '.process']: orig },
  })
  const out = content.sections.find(s => s.type === 'stages').items[0]
  assert.equal(out.process, 'פגישה אחת בנגבה, ואז סקיצות.')
})

test('pct ו-id לא עוברים המרה', () => {
  const c = editorContent()
  const st = c.sections.find(s => s.type === 'stages').items[0]
  const { content } = buildTemplateFromEditor(c, { edited: [st.id + '.pct', st.id + '.id'] })
  const out = content.sections.find(s => s.type === 'stages').items[0]
  assert.equal(out.pct, st.pct)
  assert.equal(out.id, st.id)
})

test('מבנה ערוך — שלב שנמחק ושלב שנוסף שורדים', () => {
  const c = editorContent()
  const st = c.sections.find(s => s.type === 'stages')
  st.items = st.items.slice(1)
  st.items.push({ id: 'st_x', formalName: 'חדש', pct: 0, process: '', output: '' })
  const { content } = buildTemplateFromEditor(c, { edited: [] })
  const ids = content.sections.find(s => s.type === 'stages').items.map(i => i.id)
  assert.equal(ids.includes('st_x'), true)
  assert.equal(ids.length, st.items.length)
})

console.log('\n' + (failed === 0
  ? `✅  ${passed} בדיקות עברו`
  : `❌  ${failed} נכשלו, ${passed} עברו`) + '\n')
process.exit(failed === 0 ? 0 : 1)
