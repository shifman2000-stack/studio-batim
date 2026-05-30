// api/generate-contractor-spec-pdf.js — Vercel Serverless Function
// Accepts POST { projectId }, navigates headless Chrome to /contractor-spec-print/:projectId,
// and returns a PDF of the project's contractor-spec report.
//
// Mirrors api/generate-finishing-pdf.js exactly — same Puppeteer setup, same page options,
// only the target route and the readiness marker differ.

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

  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host     = req.headers.host
  const printUrl = `${protocol}://${host}/contractor-spec-print/${projectId}`

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

    // Synchronization fence — ContractorSpecPrintView only sets this attribute on its
    // success-path render, AFTER the RPC has resolved and ContractorSpecReport mounted.
    // Guards against networkidle0 firing before React mounts + dispatches the RPC.
    await page.waitForSelector('[data-contractor-spec-ready="true"]', { timeout: 30000 })

    // Switch to print media so @page rules take effect.
    await page.emulateMediaType('print')

    // Wait for web fonts (critical for Hebrew — Heebo)
    await page.evaluateHandle('document.fonts.ready')
    // Small extra buffer for slow font CDNs
    await new Promise(r => setTimeout(r, 500))

    // Generate PDF — same options as the finishing PDF so layout/fonts/breaks behave identically.
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: true,
    })

    const pdfBuffer = Buffer.from(pdfBytes)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', pdfBuffer.length)
    return res.status(200).end(pdfBuffer)
  } catch (err) {
    console.error('generate-contractor-spec-pdf error:', err)
    return res.status(500).json({ error: 'PDF generation failed', detail: err.message })
  } finally {
    if (browser) await browser.close()
  }
}
