import { useLocation } from 'react-router-dom'
import QuoteTowerV2 from '../../components/quoteV2/QuoteTowerV2'
import { useLabTemplate, useLabVars, readLabQuery } from './useLabTemplate'

/* ═══════════════════════════════════════════════════════════════════════
   /lab/quote-v2/print — הפן הכתוב בלבד, מוכן ל-Print → Save as PDF

   ⚠️ admin בלבד, לא מקושר משום תפריט, קריאה בלבד.

   פרמטרים (כולם רשות):
     ?clients=1   לקוח אחד במקום שניים
     &nohouse=1   בלי שטח בית
     &noplot=1    בלי שטח מגרש
     &nocity=1    בלי יישוב
   ═══════════════════════════════════════════════════════════════════════ */

/* ⚠️ ה-<style> הזה חייב להיות inline במסלול ולא בקובץ CSS, משתי סיבות
   שנלמדו בספייק (docs/quote-v2-design.md, B.3):

   1. @page אי אפשר לתחום בסלקטור. בבאנדל הבנוי יש כבר ארבעה כללי
      @page, והאחרון מנצח — כולל `@page { margin: 0 }` של
      QuoteBuilder.css. הצהרה כאן, אחרי כל הגיליונות, היא מה שמבטיח
      שהשוליים שלנו יחולו.

   2. index.css מגדיר html/body/#root עם height:100% ו-overflow:hidden.
      בהדפסה זה גוזר עמוד אחד ותו לא. הביטול חייב להיות מקומי למסלול
      ולא גלובלי, כדי לא לגעת במסכי ההדפסה הקיימים.

   השוליים הנדיבים למעלה ולמטה הם מקום לכותרת הרצה ולמספור העמודים
   שיגיעו מ-Puppeteer דרך displayHeaderFooter בשלב החתימה. */
const PRINT_STYLE = `
@page { size: A4 portrait; margin: 18mm 16mm 20mm; }

@media print {
  html, body, #root {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    display: block !important;
    background: #fff !important;
  }
  .qtp-screen {
    background: #fff !important;
    padding: 0 !important;
    overflow: visible !important;
    height: auto !important;
    display: block !important;
  }
  .qtp-bar { display: none !important; }
}
`

const SCREEN = {
  flex: 1, minHeight: 0, overflow: 'auto',
  background: '#e6e2db', padding: '24px 12px 60px',
}
const BAR = {
  position: 'fixed', insetInlineStart: 12, bottom: 12, zIndex: 9999,
  background: 'rgba(20,20,20,.92)', color: '#fff', borderRadius: 10,
  padding: '8px 12px', font: '13px/1.5 Heebo, sans-serif', direction: 'rtl',
  display: 'flex', gap: 10, alignItems: 'center',
  boxShadow: '0 8px 30px rgba(0,0,0,.45)',
}
const BTN = {
  border: '1px solid rgba(255,255,255,.3)', background: 'transparent',
  color: '#fff', borderRadius: 7, padding: '4px 10px', font: 'inherit', cursor: 'pointer',
}

export default function QuoteV2PrintLab() {
  const { search } = useLocation()
  const { state, error, content } = useLabTemplate()
  const opts = readLabQuery(search)
  const vars = useLabVars(opts)
  const clientCount = opts.twoClients ? 2 : 1

  if (state === 'checking' || state === 'loading') {
    return <div dir="rtl" style={{ padding: 40, fontFamily: 'Heebo, sans-serif' }}>טוען…</div>
  }
  if (state === 'error') {
    return (
      <div dir="rtl" style={{ padding: 40, fontFamily: 'Heebo, sans-serif', color: '#c0392b' }}>
        {error}
      </div>
    )
  }

  return (
    <>
      <style>{PRINT_STYLE}</style>
      <div className="qtp-screen" style={SCREEN}>
        <QuoteTowerV2 content={content} vars={vars} clientCount={clientCount} />
      </div>
      <div className="qtp-bar" style={BAR}>
        <span style={{ color: '#9aa', fontSize: 12 }}>
          {clientCount === 1 ? 'לקוח אחד' : 'שני לקוחות'}
          {opts.hasHouse ? '' : ' · בלי שטח בית'}
          {opts.hasPlot ? '' : ' · בלי שטח מגרש'}
          {opts.hasSettlement ? '' : ' · בלי יישוב'}
        </span>
        <button type="button" style={BTN} onClick={() => window.print()}>⎙ הדפסה</button>
      </div>
    </>
  )
}
