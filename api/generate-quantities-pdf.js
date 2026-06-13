// api/generate-quantities-pdf.js — Vercel Serverless Function
//
// SECURED endpoint. The caller MUST send:
//   Authorization: Bearer <supabase_access_token>
//   body: { projectId: <uuid> }
//
// Pipeline:
//   1. Method check (POST only).
//   2. Extract Bearer token; reject 401 if missing.
//   3. Build a Supabase server client with the ANON key + the user's
//      access token in the Authorization header.
//      Calling supabase.auth.getUser(accessToken) verifies the token
//      is valid and resolves a user; rejects 401 if not.
//   4. Validate projectId is a real UUID; reject 400 if not.
//   5. Authorize via the SECURITY DEFINER RPC `can_access_project_pdf`
//      (staff via profiles OR client owner via client_users). The token
//      injected at step 3 makes auth.uid() inside the RPC resolve to the
//      caller. Reject 403 if it returns false / errors.
//   6. Only THEN launch Puppeteer and render the PDF.
//
// The print routes themselves (/quantities-print/:projectId etc.) and
// their SECURITY DEFINER fetch RPCs are UNCHANGED — gating happens here.

import chromium      from '@sparticuz/chromium'
import puppeteer     from 'puppeteer-core'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Authentication: extract Bearer token ──
  const authHeader  = req.headers.authorization || req.headers.Authorization
  const accessToken = authHeader && /^Bearer\s+/i.test(authHeader)
    ? authHeader.replace(/^Bearer\s+/i, '').trim()
    : null
  if (!accessToken) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  // Supabase server client — anon key + caller's access token in headers.
  // The same client is used to verify identity AND call the authorization
  // RPC, so auth.uid() inside the SECURITY DEFINER function resolves to
  // the caller's user id.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: userErr } = await supabase.auth.getUser(accessToken)
  if (userErr || !user) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  // ── 2. Input validation: projectId must be a real UUID ──
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const { projectId } = body || {}
  if (!projectId || typeof projectId !== 'string' || !UUID_REGEX.test(projectId)) {
    return res.status(400).json({ error: 'bad request' })
  }

  // ── 3. Authorization: SECURITY DEFINER RPC gates project access ──
  // Returns true for staff (row in profiles) or client owner (matching
  // client_users row). Any other case (incl. RPC error) → generic 403,
  // identical to "wrong project" so we don't leak information.
  const { data: allowed, error: rpcErr } = await supabase
    .rpc('can_access_project_pdf', { p_project_id: projectId })
  if (rpcErr || allowed !== true) {
    return res.status(403).json({ error: 'forbidden' })
  }

  // ── 4. Puppeteer flow (unchanged from the original) ──
  const protocol = req.headers['x-forwarded-proto'] || 'https'
  const host     = req.headers.host
  const printUrl = `${protocol}://${host}/quantities-print/${projectId}`

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

    // Synchronization fence — QuantitiesPrintView only sets this attribute on its
    // success-path render, AFTER the RPC has resolved and QuantitiesReport mounted.
    // Guards against networkidle0 firing before React mounts + dispatches the RPC.
    await page.waitForSelector('[data-quantities-ready="true"]', { timeout: 30000 })

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

    // puppeteer-core ≥24 returns Uint8Array — convert to Buffer
    const pdfBuffer = Buffer.from(pdfBytes)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', pdfBuffer.length)
    // No Content-Disposition — the client sets the download filename
    return res.status(200).end(pdfBuffer)
  } catch (err) {
    console.error('generate-quantities-pdf error:', err)
    return res.status(500).json({ error: 'PDF generation failed', detail: err.message })
  } finally {
    if (browser) await browser.close()
  }
}
