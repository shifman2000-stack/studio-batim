// api/quote-pdf.js — Vercel Serverless Function
//
// ההצעה הכתובה המלאה, **לפני** החתימה (החלטה 25).
// POST { token } → בייטים של PDF בחזרה.
//
// שלוש תכונות שהופכות אותו לנקודת הקצה הבטוחה ביותר כאן:
//   · אין בו שום כתיבה — לא ל-DB ולא ל-Storage.
//   · אין בו שימוש ב-SUPABASE_SERVICE_ROLE_KEY. הדף שהוא מרנדר קורא
//     את התוכן בעצמו דרך get_quote_by_token (SECURITY DEFINER, anon).
//     לכן הוא **עובד גם בדיפלוימנט Preview**, שבו המפתח הזה חסר —
//     וזה מה שמאפשר לבדוק את כל מסלול ה-PDF בלי לגעת בייצור.
//   · הוא מקבל token ולא quoteId, ולכן הוא מרנדר בהכרח את אותה שורת
//     quote_versions שתיחתם אחר כך.

import { renderTowerPdf } from './_quoteTowerPdf.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { token } = body || {}
  if (!token) return res.status(400).json({ error: 'Missing required field: token' })

  try {
    const pdfBuffer = await renderTowerPdf({ req, token, title: 'טיוטה לעיון' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', pdfBuffer.length)
    // בלי Content-Disposition — הלקוח קובע את שם הקובץ
    return res.status(200).end(pdfBuffer)
  } catch (err) {
    console.error('quote-pdf error:', err)
    return res.status(500).json({ error: 'PDF generation failed', detail: err.message })
  }
}
