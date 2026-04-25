// api/generate-pdf.js — Vercel Serverless Function
// Step 1: Infrastructure smoke-test — returns a hardcoded Hebrew PDF.
// Steps 2-3 will replace the hardcoded HTML with the real quote markup.

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let browser = null
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })

    const page = await browser.newPage()

    await page.setContent(
      `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: sans-serif; direction: rtl; padding: 40px; }
    h1   { font-size: 28px; }
    p    { font-size: 16px; }
  </style>
</head>
<body>
  <h1>בדיקה — שרת PDF עובד</h1>
  <p>אם אתם רואים את זה ב-PDF, השלב הראשון הצליח.</p>
</body>
</html>`,
      { waitUntil: 'networkidle0' }
    )

    // puppeteer-core ≥24 returns Uint8Array, not Buffer.
    // res.send(Uint8Array) on Vercel/Express JSON-serialises it {"0":37,"1":80,...}
    // Buffer.from() converts it to a true Node.js Buffer so the bytes are sent raw.
    const pdfBytes  = await page.pdf({ format: 'A4' })
    const pdfBuffer = Buffer.from(pdfBytes)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="test.pdf"')
    res.setHeader('Content-Length', pdfBuffer.length)
    return res.status(200).end(pdfBuffer)
  } catch (err) {
    console.error('generate-pdf error:', err)
    return res.status(500).json({ error: 'PDF generation failed', detail: err.message })
  } finally {
    if (browser) await browser.close()
  }
}
