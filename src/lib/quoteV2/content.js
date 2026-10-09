/* סיומת מפורשת: Vite לא צריך אותה, אבל node כן, וה-content.test.js
   לידו רץ ב-node רגיל בלי bundler. */
import { deriveFirstNames, isFilled } from './resolve.js'

/* ═══════════════════════════════════════════════════════════════════════
   content_v2 — בנייה והקפאה
   מסמך התכנון: docs/quote-v2-design.md — A.2

   העיקרון: ברגע שנוצרת טיוטה, כל מה שההצעה צריכה כדי לרנדר את עצמה
   **מועתק פנימה**. אחרי זה היא לא קוראת מהפנייה ולא מהתבנית לעולם.

   למה זה קריטי דווקא כאן: ה-PDF החתום נוצר אחרי החתימה, ולפעמים
   ימים אחריה. אם הוא היה נגזר מהפנייה החיה, תיקון טלפון או שם
   בפנייה היה משנה מסמך חתום. השדות clients/property/vars הם צילום
   מצב, ו-quote_versions.content הוא ההקפאה הסופית.
   ═══════════════════════════════════════════════════════════════════════ */

/** d.M.yy — הפורמט שמופיע בהצעת 29.9 ובמוקאפים. */
export function formatQuoteDate(d = new Date()) {
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`
}

/**
 * בונה content_v2 שלם מתבנית + פנייה.
 *
 * @param {object} template  quote_templates.content — { schema, drawingVariant, sections }
 * @param {object} inquiry   שורת inquiries
 * @param {object} extra     { fee, houseArea, plotArea, date } — מה שעינב ממלאת
 */
export function buildQuoteV2Content(template, inquiry = {}, extra = {}) {
  if (!template?.sections) throw new Error('buildQuoteV2Content: תבנית ללא sections')

  const clients = []
  if (isFilled(inquiry.first_name) || isFilled(inquiry.last_name)) {
    clients.push({
      firstName: inquiry.first_name ?? '',
      lastName: inquiry.last_name ?? '',
      phone: inquiry.phone ?? '',
      email: inquiry.email ?? '',
    })
  }
  if (isFilled(inquiry.contact2_name)) {
    /* בפנייה יש שם מלא אחד ללקוח השני, בלי פיצול. מפצלים על הרווח
       הראשון: "נועה זיו" → נועה / זיו. שם יחיד נשאר שם פרטי. */
    const parts = String(inquiry.contact2_name).trim().split(/\s+/)
    clients.push({
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      phone: inquiry.contact2_phone ?? '',
      email: inquiry.contact2_email ?? '',
    })
  }

  const property = {
    settlement: inquiry.city ?? '',
    houseArea: extra.houseArea ?? '',
    plotArea: extra.plotArea ?? '',
  }

  const fee = Number(extra.fee) || 0
  const date = extra.date || formatQuoteDate()

  return {
    schema: 2,
    drawingVariant: template.drawingVariant ?? 'newHouse',
    meta: {
      createdAt: new Date().toISOString(),
      date,
    },
    clients,
    property,
    /* vars נשמר מפורשות ולא נגזר מחדש בזמן רינדור — כך מסמך ישן
       מרונדר נכון גם אם לוגיקת הגזירה תשתנה בעתיד. */
    vars: {
      firstNames: deriveFirstNames(clients.map(c => c.firstName)),
      settlement: property.settlement,
      houseArea: property.houseArea,
      plotArea: property.plotArea,
      fee,
      date,
      clientPhone: clients[0]?.phone ?? '',
      clientEmail: clients[0]?.email ?? '',
    },
    totals: { fee, currency: 'ILS', vatIncluded: false },
    sections: template.sections,
    /* נכתב רק ע״י הלקוח, בזמן החתימה. */
    clientResponse: {
      extrasSelected: [],
      consentChecked: false,
      signatures: [],
    },
  }
}

/** מספר הלקוחות שעליו נשען הדקדוק. תמיד לפחות 1. */
export function clientCountOf(content) {
  return Math.max(1, content?.clients?.length || 1)
}

/** ה-vars הקפואים. נפילה ל-{} ולא לחישוב מחדש — בכוונה. */
export function varsOf(content) {
  return content?.vars ?? {}
}

/** האם זו הצעת v2. זו הבדיקה היחידה שמפרידה בין המסלולים. */
export function isV2(content) {
  return content?.schema === 2
}

/** החתימות שנרשמו, אם נחתם. */
export function signaturesOf(content) {
  const list = content?.clientResponse?.signatures
  return Array.isArray(list) ? list : []
}

/** האם ההצעה חתומה — לפחות חותם אחד עם תמונת חתימה. */
export function isSignedContent(content) {
  return signaturesOf(content).some(sg => isFilled(sg?.image))
}

/**
 * שורת חותם אחת לכל מזמין, באורך clientCountOf.
 *
 * ⚠️ זה המקור היחיד לשמות ולת.ז. במסמך הכתוב — גם בבלוק "המזמינים"
 * שבשער וגם בבלוק אישור ההצעה. שניהם חייבים להראות בדיוק אותו דבר:
 * מסמך חתום שבשער שלו שם אחד ובחתימה שם אחר הוא מסמך שבור.
 *
 * מה שהלקוח הקליד בחתימה גובר על שם הפנייה — הוא זה שחתם, והשם
 * שהוא הקליד הוא מה שמחייב. לפני החתימה חוזר שם הפנייה ות.ז. ריקה.
 *
 * @param {number} [count] דריסה מפורשת למספר המזמינים (המעבדה מעבירה
 *   clientCount ב-prop על תבנית שאין בה clients בכלל).
 */
export function signersOf(content, count) {
  const clients = Array.isArray(content?.clients) ? content.clients : []
  const sigs = signaturesOf(content)
  const n = Math.max(1, Number(count) || clientCountOf(content))
  return Array.from({ length: n }, (_, i) => {
    /* התאמה לפי clientIndex ולא לפי מקום במערך — השרת כותב אותו
       במפורש, ומערך חלקי לא יזיז חותם למקום של אחר. */
    const sg = sigs.find(s => Number(s?.clientIndex) === i) ?? sigs[i] ?? {}
    const fromQuote = [clients[i]?.firstName, clients[i]?.lastName]
      .filter(isFilled).join(' ')
    return {
      name: isFilled(sg.name) ? String(sg.name).trim() : fromQuote,
      idNumber: isFilled(sg.idNumber) ? String(sg.idNumber).trim() : '',
      image: isFilled(sg.image) ? sg.image : '',
      signedAtClient: sg.signedAtClient ?? '',
      signed: isFilled(sg.image),
    }
  })
}
