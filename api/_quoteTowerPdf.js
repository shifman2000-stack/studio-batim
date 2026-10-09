// api/_quoteTowerPdf.js — משותף ל-quote-pdf ול-finalize-quote-v2.
//
// הקובץ מתחיל ב-_ ולכן Vercel אינו מגיש אותו כנקודת קצה; הוא נארז
// יחד עם הפונקציות שמייבאות אותו.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { HEADER_FONT_CSS } from '../src/lib/quoteV2/headerFont.js'

/* ── כותרת רצה ותחתית ──────────────────────────────────────────────
   displayHeaderFooter מרנדר את התבניות האלה **במסמך נפרד**, בלי
   גישה לפונטים של הדף ובלי רשת. פונט חיצוני פשוט לא ייטען והעברית
   תצא כריבועים, ולכן Heebo מוטמע כאן כ-base64 (B.3 כלל 5).

   .pageNumber ו-.totalPages הן מחלקות ש-Puppeteer ממלא בעצמו. */
function headerTemplate(title) {
  return `<style>${HEADER_FONT_CSS}
    #h{font-family:'HeeboHF',sans-serif;font-size:7pt;color:#8a8680;
       width:100%;padding:0 16mm;display:flex;justify-content:space-between;
       direction:rtl;-webkit-print-color-adjust:exact}
  </style>
  <div id="h"><span>סטודיו בתים · הצעת מחיר</span><span>${title}</span></div>`
}

function footerTemplate() {
  return `<style>${HEADER_FONT_CSS}
    #f{font-family:'HeeboHF',sans-serif;font-size:7pt;color:#8a8680;
       width:100%;padding:0 16mm;display:flex;justify-content:space-between;
       direction:rtl;-webkit-print-color-adjust:exact}
  </style>
  <div id="f">
    <span>סטודיו בתים · קיבוץ נגבה · 052-9593927</span>
    <span>עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></span>
  </div>`
}

/** המקור שאליו Puppeteer מנווט — תמיד הדיפלוימנט שמריץ את הפונקציה. */
export function originOf(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  return `${protocol}://${req.headers.host}`
}

/**
 * מרנדר את /quote-tower-print/:token ל-PDF ומחזיר Buffer.
 *
 * @param {object} opts.req     בקשת ה-handler — ממנה נגזרים המקור והעוגיות
 * @param {string} opts.token   form_token של הגרסה
 * @param {string} opts.title   מה שמופיע בצד שמאל של הכותרת הרצה
 */
export async function renderTowerPdf({ req, token, title = '' }) {
  const url = `${originOf(req)}/quote-tower-print/${token}`
  let browser = null
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
    const page = await browser.newPage()

    /* ⚠️ Vercel Deployment Protection: בדיפלוימנט מוגן, בקשה לא
       מאומתת לכתובת הציבורית מקבלת מסך התחברות — כולל בקשה שיוצאת
       מהפונקציה אל עצמה. העברת העוגיות של הקורא פותרת את זה בלי
       לגעת בהגדרות Vercel: אם המשתמש כבר עבר את מסך ההגנה, Puppeteer
       נוסע עם אותה הרשאה. בייצור אין עוגייה כזו וזה פשוט לא רלוונטי. */
    const cookie = req.headers.cookie
    if (cookie) await page.setExtraHTTPHeaders({ cookie })

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
    await page.waitForSelector('[data-ready="1"]', { timeout: 20000 })
    await page.emulateMediaType('print')
    await page.evaluateHandle('document.fonts.ready')
    await new Promise(r => setTimeout(r, 500))

    const bytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,     // השוליים מגיעים מ-@page שבמסלול
      displayHeaderFooter: true,
      headerTemplate: headerTemplate(title),
      footerTemplate: footerTemplate(),
    })
    return Buffer.from(bytes)
  } finally {
    if (browser) await browser.close()
  }
}
