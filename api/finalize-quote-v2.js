// api/finalize-quote-v2.js — Vercel Serverless Function
//
// חתימה על הצעת v2. POST { token, clientResponse }
//
// ⚠️ קובץ נפרד במכוון. api/finalize-quote.js משרת את 15 ההצעות
// הקיימות ולא נגע — מסלול החתימה שלהן נשאר זהה בייט-בייט. המחיר
// הוא כפילות של השלד; התמורה היא שאי אפשר לשבור את v1 מכאן.
//
// הזרימה:
//   1. איתור הגרסה לפי הטוקן (service-role, עוקף RLS)
//   2. אימות שרתי: schema=2, לא נחתם כבר, צ׳קבוקס מסומן, כל החותמים חתמו
//   3. מיזוג clientResponse לתוך content וכתיבה — זה מה שיופיע ב-PDF
//   4. Puppeteer → /quote-tower-print/:token → PDF עם כותרת רצה
//   5. העלאה ל-quotes-files/signed/{version_id}.pdf
//   6. סימון הגרסה כחתומה + quotes.status = 'signed'
//   7. ראיות חתימה — best-effort, לעולם לא קטלני
//
// הלקוח **לא** שולח content. הוא שולח רק את תשובתו, והשרת ממזג
// אותה לתוך ה-content השמור. כך אי אפשר להחליף את גוף ההצעה בדרך.

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { renderTowerPdf } from './_quoteTowerPdf.js'

function collectEvidence(req, pdfBuffer, content) {
  const safe = (fn) => { try { const v = fn(); return v === undefined ? null : v } catch { return null } }
  const h = (req && req.headers) || {}
  const ip = safe(() => {
    const raw = h['x-forwarded-for'] || h['x-vercel-forwarded-for'] || h['x-real-ip'] || ''
    return String(raw).split(',')[0].trim() || null
  })
  return {
    serverSignedAt: safe(() => new Date().toISOString()),
    ip,
    userAgent: safe(() => h['user-agent'] || null),
    pdfSha256: safe(() => crypto.createHash('sha256').update(pdfBuffer).digest('hex')),
    pdfBytes: safe(() => pdfBuffer.length),
    contentSha256: safe(() =>
      crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex')),
    consentChecked: safe(() => {
      const c = content?.clientResponse?.consentChecked
      return typeof c === 'boolean' ? c : null
    }),
    consentCheckedAt: safe(() => content?.clientResponse?.consentCheckedAt ?? null),
    extrasSelected: safe(() => content?.clientResponse?.extrasSelected ?? []),
    schema: safe(() => content?.schema ?? null),
    recordedBy: 'finalize-quote-v2',
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { token, clientResponse } = body || {}
  if (!token || !clientResponse) {
    return res.status(400).json({ error: 'Missing required fields: token, clientResponse' })
  }

  try {
    // ── 0. אימות סביבה. בתוך ה-try בכוונה: supabase-js זורק כשחסר
    //    מפתח, ומחוץ ל-try זה יוצא FUNCTION_INVOCATION_FAILED עירום
    //    בלי שום רמז. זה בדיוק מה שקורה בכל דיפלוימנט Preview.
    if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const missing = [
        !process.env.VITE_SUPABASE_URL && 'VITE_SUPABASE_URL',
        !process.env.SUPABASE_SERVICE_ROLE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
      ].filter(Boolean)
      console.error('finalize-quote-v2: missing env:', missing.join(', '))
      return res.status(500).json({
        error: 'Server not configured',
        detail: `Missing environment variable(s): ${missing.join(', ')}`,
      })
    }

    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    )

    // ── 1. הגרסה לפי הטוקן ────────────────────────────────────────────
    const { data: version, error: versionError } = await supabase
      .from('quote_versions')
      .select('id, quote_id, content, is_signed')
      .eq('form_token', token)
      .eq('is_archived', false)
      .maybeSingle()

    if (versionError || !version) {
      return res.status(404).json({ error: 'Quote version not found' })
    }

    // ── 2. אימות שרתי ─────────────────────────────────────────────────
    // הכפתור בלקוח כבר בודק את זה, אבל אפשר לקרוא ל-API ישירות (D.2).
    const stored = version.content
    if (stored?.schema !== 2) {
      return res.status(400).json({ error: 'Not a v2 quote' })
    }
    if (version.is_signed) {
      return res.status(409).json({ error: 'Quote already signed' })
    }
    if (clientResponse.consentChecked !== true) {
      return res.status(400).json({ error: 'Consent not given' })
    }
    const expected = Math.max(1, stored?.clients?.length || 1)
    const sigs = Array.isArray(clientResponse.signatures) ? clientResponse.signatures : []
    const complete = Array.from({ length: expected }).every((_, i) =>
      typeof sigs[i]?.image === 'string' && sigs[i].image.startsWith('data:image') &&
      typeof sigs[i]?.name === 'string' && sigs[i].name.trim() !== '')
    if (!complete) {
      return res.status(400).json({ error: `Expected ${expected} complete signature(s)` })
    }

    // ── 3. מיזוג וכתיבה ───────────────────────────────────────────────
    // רק clientResponse מתעדכן. גוף ההצעה הוא מה שכבר שמור.
    const content = {
      ...stored,
      clientResponse: {
        extrasSelected: Array.isArray(clientResponse.extrasSelected) ? clientResponse.extrasSelected : [],
        consentChecked: true,
        consentCheckedAt: clientResponse.consentCheckedAt ?? new Date().toISOString(),
        signatures: sigs.slice(0, expected).map((sg, i) => ({
          clientIndex: i,
          name: String(sg.name ?? '').trim(),
          idNumber: String(sg.idNumber ?? '').trim(),
          image: sg.image,
          signedAtClient: sg.signedAtClient ?? new Date().toISOString(),
        })),
      },
    }

    const { error: contentErr } = await supabase
      .from('quote_versions').update({ content }).eq('id', version.id)
    if (contentErr) {
      console.error('finalize-quote-v2: content update error:', contentErr)
      return res.status(500).json({ error: 'Failed to save signed content' })
    }

    // ── 4. שם המשפחה לשם הקובץ ────────────────────────────────────────
    let lastName = stored?.clients?.[0]?.lastName || 'לקוח'
    const { data: quoteRow } = await supabase
      .from('quotes').select('inquiry_id').eq('id', version.quote_id).maybeSingle()
    if (quoteRow?.inquiry_id) {
      const { data: inq } = await supabase
        .from('inquiries').select('last_name').eq('id', quoteRow.inquiry_id).maybeSingle()
      if (inq?.last_name) lastName = inq.last_name
    }

    // ── 5. PDF ────────────────────────────────────────────────────────
    // אותו מסלול ואותו טוקן כמו ההורדה שלפני החתימה, ולכן אותה
    // גרסה בדיוק — ההבדל היחיד הוא שהחתימות כבר בתוך ה-content.
    const pdfBuffer = await renderTowerPdf({ req, token, title: 'נחתם' })

    // ── 6. העלאה ל-Storage ────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10)
    const downloadName = `הצעת מחיר - משפחת ${lastName} - ${today}.pdf`
    const filePath = `signed/${version.id}.pdf`

    const { error: uploadError } = await supabase
      .storage.from('quotes-files')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
        contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      })
    if (uploadError) {
      console.error('finalize-quote-v2: upload error:', uploadError)
      return res.status(500).json({ error: 'Failed to upload PDF' })
    }
    const { data: { publicUrl } } = supabase
      .storage.from('quotes-files').getPublicUrl(filePath)

    // ── 7. סימון חתום ─────────────────────────────────────────────────
    const { error: signErr } = await supabase
      .from('quote_versions')
      .update({ is_signed: true, signed_at: new Date().toISOString(), signed_file_url: publicUrl })
      .eq('id', version.id)
    if (signErr) {
      console.error('finalize-quote-v2: sign update error:', signErr)
      return res.status(500).json({ error: 'Failed to mark version as signed' })
    }

    const { error: quoteErr } = await supabase
      .from('quotes').update({ status: 'signed', viewed_by_admin: false })
      .eq('id', version.quote_id)
    if (quoteErr) {
      console.error('finalize-quote-v2: quote update error:', quoteErr)
      return res.status(500).json({ error: 'Failed to update quote status' })
    }

    // ── 8. ראיות — אחרי שההצעה כבר חתומה, ולא קטלניות ─────────────────
    try {
      const { error: evErr } = await supabase
        .from('quote_versions')
        .update({ signature_evidence: collectEvidence(req, pdfBuffer, content) })
        .eq('id', version.id)
      if (evErr) console.warn('finalize-quote-v2: evidence not recorded:', evErr.message)
    } catch (evCatch) {
      console.warn('finalize-quote-v2: evidence collection failed:', evCatch?.message)
    }

    return res.status(200).json({ success: true, file_url: publicUrl })

  } catch (err) {
    console.error('finalize-quote-v2 error:', err)
    return res.status(500).json({ error: 'Internal server error', detail: err.message })
  }
}
