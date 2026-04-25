// api/generate-pdf.js — Vercel Serverless Function
// Accepts POST { quoteId }, navigates headless Chrome to /quote-print/:quoteId,
// and returns a 4-page A4 PDF with the full quote design.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Vercel auto-parses JSON bodies; guard against string-encoded bodies just in case
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { quoteId } = body || {}

  if (!quoteId) {
    return res.status(400).json({ error: 'Missing required field: quoteId' })
  }

  // Build the print URL from the incoming request's host so this works
  // identically on preview deployments, production, and local dev tunnels.
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host     = req.headers.host
  const printUrl = `${protocol}://${host}/quote-print/${quoteId}`

  console.log('generate-pdf: navigating to', printUrl)

  let browser = null
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()

    // Navigate to the clean print route (all 4 A4 pages, no UI chrome)
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    // Wait for web fonts (critical for Hebrew — Heebo, Playfair Display)
    await page.evaluateHandle('document.fonts.ready')
    // Small extra buffer for slow font CDNs
    await new Promise(r => setTimeout(r, 500))

    // Generate PDF
    // - printBackground: true   → preserves background colours / cream pages
    // - margin: 0               → no Puppeteer-added margin; our pages have internal padding
    // - preferCSSPageSize: true → honour the @page { size: A4 portrait } rule injected
    //                             by QuotePrintView; combined with break-after:page on each
    //                             .page element this produces exactly 4 A4 pages
    // - page breaks are driven by .print-mode .qp-pages .page { break-after: page }
    //   (always-on, not @media print — Puppeteer renders in screen media)
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    })

    // puppeteer-core ≥24 returns Uint8Array — convert to Buffer so Express/Vercel
    // sends raw bytes instead of JSON-serialising the typed array
    const pdfBuffer = Buffer.from(pdfBytes)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', pdfBuffer.length)
    // No Content-Disposition — the client sets the download filename
    return res.status(200).end(pdfBuffer)
  } catch (err) {
    console.error('generate-pdf error:', err)
    return res.status(500).json({ error: 'PDF generation failed', detail: err.message })
  } finally {
    if (browser) await browser.close()
  }
}
