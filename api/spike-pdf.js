// api/spike-pdf.js — SPIKE, THROWAWAY. Branch spike/quote-flow-print.
//
// A copy of api/generate-pdf.js pointed at /spike/quote-flow. The production
// function is NOT touched. Differences, all of them deliberate experiments:
//
//   1. Real @page margins instead of margin:0, so there is somewhere for a
//      header and footer to be drawn at all.
//   2. mode=puppeteer  → displayHeaderFooter with headerTemplate /
//                        footerTemplate, which is the only way to get
//                        pageNumber / totalPages out of Chromium.
//      mode=css        → the page's own position:fixed elements repeat
//                        instead; Puppeteer still supplies the page number,
//                        because CSS cannot count pages in Chromium.
//   3. The header/footer templates render in an ISOLATED context: none of
//      the page's CSS and none of its web fonts reach them. The Hebrew font
//      is therefore fetched from the deployment and inlined as base64 into
//      the template itself. Testing whether that is actually necessary is
//      half the point of this endpoint.
//   4. Waits on <html data-spike-ready> (set after document.fonts.ready)
//      instead of a blind 500ms sleep.
//
// GET or POST: /api/spike-pdf?v=v1&mode=puppeteer

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

const CONTACT = 'סטודיו בתים · קיבוץ נגבה · 052-9593927 · einav.studiob@gmail.com'

/* Puppeteer's templates start at font-size 0 and inherit nothing, so every
   value here has to be stated. `-webkit-print-color-adjust` is needed for
   the rule colour to survive. */
const headerTpl = (fontCss) => `
<style>
  ${fontCss}
  #h { font-family:'HeeboEmbed', sans-serif; font-size:11px; letter-spacing:0.3em;
       color:#1a1a18; width:100%; text-align:center; direction:rtl;
       -webkit-print-color-adjust:exact; padding-top:9mm; }
</style>
<div id="h">סטודיו בתים</div>`

const footerTpl = (fontCss, withContact) => `
<style>
  ${fontCss}
  #f { font-family:'HeeboEmbed', sans-serif; color:#8a8680; width:100%;
       direction:rtl; text-align:center; -webkit-print-color-adjust:exact;
       padding-bottom:7mm; }
  #f .c { font-size:7.5px; letter-spacing:0.12em; }
  #f .p { font-size:8px; letter-spacing:0.18em; margin-top:2px; }
</style>
<div id="f">
  ${withContact ? `<div class="c">${CONTACT}</div>` : ''}
  <div class="p">עמוד <span class="pageNumber"></span> מתוך <span class="totalPages"></span></div>
</div>`

export default async function handler(req, res) {
  const q       = req.query || {}
  const variant = (q.v || 'v1').toString()
  const mode    = (q.mode || 'puppeteer').toString()      // puppeteer | css
  const noFont  = q.nofont === '1'                        // control: omit the embedded font

  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host     = req.headers.host
  const origin   = `${protocol}://${host}`
  const raw      = q.raw === '1' ? '&raw=1' : ''          // control: pagination rules off
  const pageUrl  = `${origin}/spike/quote-flow?v=${variant}&hf=${mode === 'css' ? 'css' : 'puppeteer'}${raw}`

  let browser = null
  const t0 = Date.now()
  const timing = {}

  try {
    /* The template runs isolated from the page, so the font has to travel
       WITH it. 12KB of Hebrew subset → ~16KB of base64. */
    let fontCss = ''
    if (!noFont) {
      const r = await fetch(`${origin}/fonts/heebo-hebrew.woff2`)
      if (r.ok) {
        const b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
        fontCss = `@font-face{font-family:'HeeboEmbed';src:url(data:font/woff2;base64,${b64}) format('woff2');font-weight:100 900;}`
        timing.fontBytes = b64.length
      }
    }
    timing.fontFetchMs = Date.now() - t0

    const tLaunch = Date.now()
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
    timing.launchMs = Date.now() - tLaunch

    const page = await browser.newPage()

    const tNav = Date.now()
    await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 30000 })
    await page.emulateMediaType('print')
    /* Deterministic readiness instead of a fixed sleep: the route sets this
       attribute from document.fonts.ready, and the fonts are same-origin. */
    await page.waitForSelector('html[data-spike-ready="1"]', { timeout: 15000 })
    timing.navMs = Date.now() - tNav

    /* What did the browser actually resolve the text to? Proves the
       self-hosted face is in use and no fallback crept in. */
    const fontCheck = await page.evaluate(() => {
      const el = document.querySelector('.sq-chapter-title') || document.body
      const loaded = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight)
      return {
        computed: getComputedStyle(el).fontFamily,
        loadedFaces: [...new Set(loaded)],
        heeboLocalLoaded: [...document.fonts].some(f => f.family === 'HeeboLocal' && f.status === 'loaded'),
      }
    })

    const usePuppeteerHF = mode !== 'css-only'
    const tPdf = Date.now()
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,          // honours @page { margin: 24mm 16mm 20mm }
      displayHeaderFooter: usePuppeteerHF,
      headerTemplate: mode === 'css' ? '<div></div>' : headerTpl(fontCss),
      footerTemplate: footerTpl(fontCss, mode !== 'css'),
    })
    timing.pdfMs = Date.now() - tPdf
    timing.totalMs = Date.now() - t0

    const pdfBuffer = Buffer.from(pdfBytes)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', pdfBuffer.length)
    res.setHeader('X-Spike-Timing', JSON.stringify(timing))
    res.setHeader('X-Spike-Font', JSON.stringify(fontCheck))
    res.setHeader('X-Spike-Url', pageUrl)
    return res.status(200).end(pdfBuffer)
  } catch (err) {
    console.error('spike-pdf error:', err)
    return res.status(500).json({ error: 'PDF generation failed', detail: err.message, timing })
  } finally {
    if (browser) await browser.close()
  }
}
