// api/generate-finishing-pdf.js — Vercel Serverless Function
// Accepts POST { projectId }, navigates headless Chrome to /finishing-print/:projectId,
// and returns a PDF of the project's finishing materials report.
//
// Mirrors api/generate-pdf.js exactly — same Puppeteer setup, same page options,
// only the target route differs.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { projectId } = body || {}

  if (!projectId) {
    return res.status(400).json({ error: 'Missing required field: projectId' })
  }

  // Build the print URL from the incoming request's host so this works
  // identically on preview deployments, production, and local dev tunnels.
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host     = req.headers.host
  const printUrl = `${protocol}://${host}/finishing-print/${projectId}`

  let browser = null
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()

    // Navigate to the clean print route (no UI chrome)
    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 })

    // Switch to print media so @page rules take effect.
    await page.emulateMediaType('print')

    // Wait for web fonts (critical for Hebrew — Heebo)
    await page.evaluateHandle('document.fonts.ready')
    // Small extra buffer for slow font CDNs
    await new Promise(r => setTimeout(r, 500))

    // Generate PDF — same options as the quote PDF so layout/fonts/breaks behave identically.
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    })

    // puppeteer-core ≥24 returns Uint8Array — convert to Buffer
    const pdfBuffer = Buffer.from(pdfBytes)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', pdfBuffer.length)
    // No Content-Disposition — the client sets the download filename
    return res.status(200).end(pdfBuffer)
  } catch (err) {
    console.error('generate-finishing-pdf error:', err)
    return res.status(500).json({ error: 'PDF generation failed', detail: err.message })
  } finally {
    if (browser) await browser.close()
  }
}
