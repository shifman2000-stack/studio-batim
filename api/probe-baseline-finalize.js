// api/finalize-quote.js — Vercel Serverless Function
//
// Accepts POST { token, content }
//   token   — the form_token stored on the quote_version row
//   content — the full quote data object (from localData in QuotePublic),
//             including sig1.signature / sig2.signature as base64 data-URLs
//
// Flow:
//   1. Find the quote_version row by token (service-role client → bypasses RLS)
//   2. Resolve last_name for the PDF filename
//   3. Write signed content back to quote_versions.content (needed so the
//      /quote-print-signed/:token route can fetch & render it with signatures)
//   4. Launch Puppeteer → navigate to /quote-print-signed/:token
//   5. Generate A4 PDF (identical approach to api/generate-pdf.js)
//   6. Upload PDF to Supabase Storage bucket 'quotes-files'
//   7. Mark quote_version as signed (is_signed, signed_at, signed_file_url)
//   8. Update quotes.status = 'signed', viewed_by_admin = false
//
// On any error after step 3, the content is already written but the quote is
// not yet marked signed — safe, the token still works, the client can retry.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Vercel auto-parses JSON bodies; guard against string-encoded bodies
  const body    = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { token, content } = body || {}

  if (!token || !content) {
    return res.status(400).json({ error: 'Missing required fields: token, content' })
  }

  // Admin client — service role key bypasses RLS for all DB operations
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  )

  let browser = null
  try {
    // ── 1. Find version by token ──────────────────────────────────────────
    const { data: version, error: versionError } = await supabase
      .from('quote_versions')
      .select('id, quote_id')
      .eq('form_token', token)
      .eq('is_archived', false)
      .maybeSingle()

    if (versionError || !version) {
      return res.status(404).json({ error: 'Quote version not found' })
    }

    // ── 2. Resolve last_name for the PDF filename ─────────────────────────
    let lastName = 'לקוח'
    const { data: quoteRow } = await supabase
      .from('quotes')
      .select('inquiry_id')
      .eq('id', version.quote_id)
      .maybeSingle()

    if (quoteRow?.inquiry_id) {
      const { data: inq } = await supabase
        .from('inquiries')
        .select('last_name')
        .eq('id', quoteRow.inquiry_id)
        .maybeSingle()
      if (inq?.last_name) lastName = inq.last_name
    }

    // ── 3. Persist signed content so the print route can read it ──────────
    // The /quote-print-signed/:token page fetches via get_quote_by_token RPC
    // which reads from quote_versions.content.  We write it now so the
    // Puppeteer navigation (step 4) sees the full content with signature images.
    const { error: contentErr } = await supabase
      .from('quote_versions')
      .update({ content })
      .eq('id', version.id)

    if (contentErr) {
      console.error('finalize-quote: content update error:', contentErr)
      return res.status(500).json({ error: 'Failed to save signed content' })
    }

    // ── 4 & 5. Generate PDF with Puppeteer ────────────────────────────────
    // Navigate to the dedicated signed-print route which passes
    // editableFields={['sig1.signature','sig2.signature']} to QuotePreview,
    // causing it to render the <img> branch for each signature.
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const host     = req.headers.host
    const printUrl = `${protocol}://${host}/quote-print-signed/${token}`

    console.log('finalize-quote: navigating to', printUrl)

    browser = await puppeteer.launch({
      args:             chromium.args,
      defaultViewport:  chromium.defaultViewport,
      executablePath:   await chromium.executablePath(),
      headless:         chromium.headless,
    })

    const page = await browser.newPage()

    // networkidle0 waits for the Supabase RPC + React render to complete
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    // Switch to print media so @page rules and break-after:page take effect
    await page.emulateMediaType('print')

    // Wait for Hebrew web fonts (Heebo, Playfair Display)
    await page.evaluateHandle('document.fonts.ready')
    await new Promise(r => setTimeout(r, 500))

    const pdfBytes = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin:          { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    })

    // puppeteer-core ≥24 returns Uint8Array; Buffer.from() converts for upload
    const pdfBuffer = Buffer.from(pdfBytes)

    // ── 6. Upload to Supabase Storage ─────────────────────────────────────
    // Use a safe ASCII path — Supabase rejects non-ASCII characters in keys.
    // The Hebrew download name is delivered via RFC 5987 contentDisposition
    // so the browser still saves the file with the correct Hebrew filename.
    const today        = new Date().toISOString().slice(0, 10)
    const downloadName = `הצעת מחיר - משפחת ${lastName} - ${today}.pdf`
    const encodedName  = encodeURIComponent(downloadName)
    const filePath     = `signed/${version.id}.pdf`

    const { error: uploadError } = await supabase
      .storage
      .from('quotes-files')
      .upload(filePath, pdfBuffer, {
        contentType:        'application/pdf',
        upsert:             true,   // allow retry after a failed previous attempt
        contentDisposition: `attachment; filename*=UTF-8''${encodedName}`,
      })

    if (uploadError) {
      console.error('finalize-quote: upload error:', uploadError)
      return res.status(500).json({ error: 'Failed to upload PDF' })
    }

    const { data: { publicUrl } } = supabase
      .storage
      .from('quotes-files')
      .getPublicUrl(filePath)

    // ── 7. Mark version as signed ─────────────────────────────────────────
    const { error: signErr } = await supabase
      .from('quote_versions')
      .update({
        is_signed:       true,
        signed_at:       new Date().toISOString(),
        signed_file_url: publicUrl,
      })
      .eq('id', version.id)

    if (signErr) {
      console.error('finalize-quote: sign update error:', signErr)
      return res.status(500).json({ error: 'Failed to mark version as signed' })
    }

    // ── 8. Update quotes table ────────────────────────────────────────────
    const { error: quoteErr } = await supabase
      .from('quotes')
      .update({
        status:          'signed',
        viewed_by_admin: false,
      })
      .eq('id', version.quote_id)

    if (quoteErr) {
      console.error('finalize-quote: quote update error:', quoteErr)
      return res.status(500).json({ error: 'Failed to update quote status' })
    }

    return res.status(200).json({ success: true, file_url: publicUrl })

  } catch (err) {
    console.error('finalize-quote error:', err)
    return res.status(500).json({ error: 'Internal server error', detail: err.message })
  } finally {
    if (browser) await browser.close()
  }
}
