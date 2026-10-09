import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuoteTowerV2 from '../components/quoteV2/QuoteTowerV2'

/* ═══════════════════════════════════════════════════════════════════════
   /quote-tower-print/:token — הפן הכתוב, ציבורי, לפי טוקן

   אליו מנווט Puppeteer גם בהורדה שלפני החתימה (api/quote-pdf) וגם
   ביצירת ה-PDF החתום (api/finalize-quote-v2). **אותה שורת
   quote_versions בשני המקרים** — מה שמבטיח שהמסמך החתום זהה למה
   שהלקוח קרא לפני שחתם.

   ההבדל היחיד ביניהם הוא מה שכבר כתוב ב-content: לפני החתימה
   clientResponse.signatures ריק והמגדל מדפיס שורות ריקות; אחריה
   הוא מלא והמגדל מדפיס את השם, ת.ז. והתמונה.

   אין כאן בדיקת הרשאה — get_quote_by_token הוא SECURITY DEFINER
   ומורשה ל-anon, בדיוק כמו /quote-print-signed/:token של היום.
   ═══════════════════════════════════════════════════════════════════════ */

/* ⚠️ ה-<style> הזה inline ולא בקובץ CSS, משתי סיבות שנלמדו בספייק:
   @page אי אפשר לתחום בסלקטור, ובבאנדל יש כבר ארבעה כללי @page
   שהאחרון בהם מנצח (כולל margin:0 של QuoteBuilder.css); ו-index.css
   נועל את html/body/#root ל-overflow:hidden, מה שגוזר עמוד אחד.

   השוליים 18/16/20 מ״מ הם גם המקום שבו Puppeteer מצייר את הכותרת
   הרצה ואת מספור העמודים דרך displayHeaderFooter. */
export const TOWER_PRINT_STYLE = `
@page { size: A4 portrait; margin: 18mm 16mm 20mm; }

html, body, #root {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
  display: block !important;
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
}
.qtp-print { background: #fff; }
.qtp-print .qt-doc { width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; }

@media print {
  .qt-doc, .qt-doc * { visibility: visible !important; }
}
`

export default function QuoteTowerPrint() {
  const { token } = useParams()
  const [content, setContent] = useState(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase.rpc('get_quote_by_token', { p_token: token })
      const ver = Array.isArray(data) && data.length > 0 ? data[0] : null
      if (!cancelled && !error && ver?.content) setContent(ver.content)
    }
    load()
    return () => { cancelled = true }
  }, [token])

  /* null עד שהנתונים מגיעים — networkidle0 של Puppeteer מטפל בתזמון,
     ו-data-ready מאפשר המתנה מפורשת במקום להסתמך רק עליו. */
  if (!content) return null

  return (
    <div className="qtp-print" data-ready="1">
      <style>{TOWER_PRINT_STYLE}</style>
      <QuoteTowerV2 content={content} />
    </div>
  )
}
