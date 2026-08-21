// api/site-health.js — Vercel Serverless Function
//
// SECURED endpoint. The caller MUST send:
//   Authorization: Bearer <supabase_access_token>
//   (no body)
//
// Runs the six "בדיקת אתר" checks against the public marketing site and
// this app, then records ONE row in public.site_health_checks so every
// staff member sees the same "last checked" line.
//
// Pipeline mirrors generate-contractor-spec-pdf.js:
//   1. Method check (POST only).
//   2. Extract Bearer token; 401 if missing.
//   3. Supabase server client with ANON key + the caller's token, so
//      auth.uid() resolves to the caller and RLS applies to the insert.
//   4. Authorize: the caller must be an ADMIN in profiles; 403 if not.
//   5. Run the checks, then insert the result row.
//
// ── WHY THIS IS A SERVER FUNCTION AND NOT BROWSER CODE ──────────────
// Four of the six checks are impossible from browser JavaScript:
//   · The marketing site sends no Access-Control-Allow-Origin, so a
//     cross-origin fetch REJECTS identically whether the site is dead,
//     the certificate expired, or everything is fine. `no-cors` yields
//     an opaque response whose status is always 0 and whose body reads
//     as empty — so neither the status code (checks 1/2/6) nor the HTML
//     (check 4) is knowable in a browser.
//   · No Web API exposes peer-certificate details at all, so "days
//     until expiry" (check 3) cannot be obtained client-side in any
//     form. Only a TLS socket can answer it.
//   · The browser has no DNS API (check 5).
// Server-to-server requests are not subject to CORS — it is a browser
// policy, not a network one — so all six run here.
//
// ── RUNTIME CONSTRAINT ──────────────────────────────────────────────
// This MUST run on the Node.js runtime, never Edge: `node:tls` and
// `node:dns` do not exist on Edge, which would silently remove the
// certificate and DNS checks.

import tls               from 'node:tls'
import { Resolver }      from 'node:dns/promises'
import { createClient }  from '@supabase/supabase-js'

const SUPABASE_URL      = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

/* ── What we are checking ────────────────────────────────────────── */
const APEX      = 'batim-es.com'
const WWW       = 'www.batim-es.com'
const APP_LOGIN = 'https://studio-batim.vercel.app/'

/* The marketing site's <title>. Verified to be STATIC in the served
   index.html (the page is a Vite SPA whose body is just <div id="root">,
   but the title is in the HTML as shipped), so a plain fetch sees it
   without executing any JavaScript.

   Matched as a SUBSTRING, deliberately. The live title is
   "סטודיו בתים | אדריכלות ועיצוב פנים"; an exact-equality test against
   "סטודיו בתים" would fail on a perfectly healthy site. Substring also
   survives a future tagline edit while still catching the thing this
   check exists for: the old WordPress site, a host's parking page, or a
   default template, none of which contain this string. */
const EXPECTED_TITLE_FRAGMENT = 'סטודיו בתים'

/* Certificate thresholds. Vercel auto-renews roughly 30 days out, so a
   cert with 25 days left is NORMAL — alarming at that point would make
   the screen red most months and train everyone to ignore it. */
const CERT_WARN_DAYS = 14
const CERT_FAIL_DAYS = 7

const HTTP_TIMEOUT_MS = 8000
const TLS_TIMEOUT_MS  = 8000
const RETRY_DELAY_MS  = 1200

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/* Run an async check, and on failure try ONCE more after a short delay.
   A single failed request is not an outage — a transient DNS blip or a
   dropped connection would otherwise be reported as a down site. Only a
   check that fails twice in a row is reported as failed. */
async function withRetry(fn) {
  try {
    const first = await fn()
    if (first.ok) return first
    await sleep(RETRY_DELAY_MS)
    const second = await fn()
    /* Report the second attempt, but say that a retry happened so a
       flapping host is visible rather than silently smoothed over. */
    return { ...second, retried: true }
  } catch (e) {
    await sleep(RETRY_DELAY_MS)
    try {
      return { ...(await fn()), retried: true }
    } catch (e2) {
      return { ok: false, detail: e2.message || String(e2), retried: true }
    }
  }
}

/* ── HTTP probe ──────────────────────────────────────────────────── */
async function probe(url) {
  const startedAt = Date.now()
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal:   AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers:  { 'user-agent': 'studio-batim-site-health/1.0' },
    })
    return {
      ok:        res.ok,
      status:    res.status,
      finalUrl:  res.url,
      /* x-vercel-id is present on every response Vercel serves and is
         the AUTHORITY for "is this Vercel". Comparing DNS A records to
         a hardcoded IP would break the day Vercel rotates it — their
         recommended apex address has already changed once. */
      vercelId:  res.headers.get('x-vercel-id'),
      server:    res.headers.get('server'),
      body:      await res.text(),
      ms:        Date.now() - startedAt,
      detail:    res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}`,
    }
  } catch (e) {
    return {
      ok:     false,
      ms:     Date.now() - startedAt,
      detail: e.name === 'TimeoutError' ? `לא הגיבה תוך ${HTTP_TIMEOUT_MS / 1000} שניות` : (e.message || String(e)),
    }
  }
}

/* ── TLS certificate ─────────────────────────────────────────────── */
function inspectCert(host) {
  return new Promise((resolve) => {
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    try {
      const socket = tls.connect(
        { host, port: 443, servername: host, timeout: TLS_TIMEOUT_MS },
        () => {
          const cert = socket.getPeerCertificate()
          const authorized = socket.authorized
          socket.end()
          if (!cert || !cert.valid_to) {
            return done({ ok: false, detail: 'לא התקבלה תעודה מהשרת' })
          }
          const expiresAt = new Date(cert.valid_to)
          const daysLeft  = Math.floor((expiresAt.getTime() - Date.now()) / 86400000)
          done({
            ok: authorized && daysLeft > 0,
            authorized,
            daysLeft,
            expiresAt: expiresAt.toISOString(),
            issuer: (cert.issuer && (cert.issuer.O || cert.issuer.CN)) || null,
            detail: authorized
              ? `תקפה, ${daysLeft} ימים לפקיעה`
              : `התעודה לא עברה אימות (${socket.authorizationError || 'שגיאה לא ידועה'})`,
          })
        }
      )
      socket.on('timeout', () => { socket.destroy(); done({ ok: false, detail: 'פסק זמן בחיבור TLS' }) })
      socket.on('error', (e) => done({ ok: false, detail: e.message || String(e) }))
    } catch (e) {
      done({ ok: false, detail: e.message || String(e) })
    }
  })
}

/* ── DNS ─────────────────────────────────────────────────────────── */
/* An EXPLICIT public resolver rather than the platform default, whose
   cache can keep serving a record for its whole TTL after a fix — the
   exact situation this screen exists to diagnose. This is still not
   cache-free, and results can differ between Vercel regions, so DNS is
   reported as diagnostic CONTEXT while x-vercel-id decides pass/fail. */
async function lookupDns() {
  const resolver = new Resolver({ timeout: 5000, tries: 2 })
  try { resolver.setServers(['1.1.1.1', '8.8.8.8']) } catch { /* keep defaults */ }

  const out = { a: [], cname: [], errors: [] }
  try {
    out.a = await resolver.resolve4(APEX)
  } catch (e) {
    out.errors.push(`A ${APEX}: ${e.code || e.message}`)
  }
  try {
    out.cname = await resolver.resolveCname(WWW)
  } catch (e) {
    /* www may be an A/ALIAS rather than a CNAME — not itself a failure. */
    out.errors.push(`CNAME ${WWW}: ${e.code || e.message}`)
  }
  return out
}

/* ── The six checks ──────────────────────────────────────────────── */
export async function runChecks() {
  const [apex, www, appLogin, apexCert, wwwCert, dns] = await Promise.all([
    withRetry(() => probe(`https://${APEX}/`)),
    withRetry(() => probe(`https://${WWW}/`)),
    withRetry(() => probe(APP_LOGIN)),
    withRetry(() => inspectCert(APEX)),
    withRetry(() => inspectCert(WWW)),
    lookupDns(),
  ])

  /* 3 — certificate. Both hostnames carry their OWN certificate, so we
     report the MINIMUM days remaining; checking only one could miss an
     expiry on the other, which is precisely how the real incident
     surfaced. */
  const certDays = [apexCert, wwwCert]
    .filter(c => typeof c.daysLeft === 'number')
    .map(c => c.daysLeft)
  const minDays    = certDays.length ? Math.min(...certDays) : null
  const bothValid  = apexCert.ok && wwwCert.ok
  const certStatus = !bothValid ? 'fail'
    : (minDays !== null && minDays < CERT_FAIL_DAYS) ? 'fail'
    : (minDays !== null && minDays < CERT_WARN_DAYS) ? 'warn'
    : 'ok'

  /* 4 — content. Reads the <title> out of the raw served HTML. */
  const titleMatch = apex.body ? apex.body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) : null
  const title      = titleMatch ? titleMatch[1].trim() : null
  const titleOk    = !!title && title.includes(EXPECTED_TITLE_FRAGMENT)

  /* 5 — served by Vercel. */
  const vercelId  = apex.vercelId || www.vercelId
  const onVercel  = !!vercelId
  const dnsSummary = [
    dns.a.length     ? `A: ${dns.a.join(', ')}`          : null,
    dns.cname.length ? `CNAME www: ${dns.cname.join(', ')}` : null,
  ].filter(Boolean).join(' · ') || 'לא התקבלו רשומות'

  return [
    {
      key: 'apex_up', label: 'האתר batim-es.com מגיב',
      status: apex.ok ? 'ok' : 'fail',
      detail: apex.detail, ms: apex.ms, retried: !!apex.retried,
    },
    {
      key: 'www_up', label: 'הכתובת www.batim-es.com מגיבה',
      status: www.ok ? 'ok' : 'fail',
      detail: www.detail, ms: www.ms, retried: !!www.retried,
    },
    {
      key: 'ssl', label: 'תעודת SSL תקפה',
      status: certStatus,
      detail: minDays === null
        ? (apexCert.detail || wwwCert.detail || 'לא ניתן לקרוא את התעודה')
        : `${minDays} ימים לפקיעה (הנמוך מבין הדומיין ו-www)` +
          (apexCert.issuer ? ` · מנפיק: ${apexCert.issuer}` : ''),
      daysLeft: minDays,
      expiresAt: apexCert.expiresAt || wwwCert.expiresAt || null,
    },
    {
      key: 'content', label: 'האתר מציג את הגרסה הנכונה',
      status: titleOk ? 'ok' : 'fail',
      detail: title
        ? (titleOk ? `כותרת: "${title}"` : `כותרת לא צפויה: "${title}"`)
        : 'לא נמצאה כותרת בעמוד',
      title,
    },
    {
      key: 'vercel', label: 'הדומיין מוגש מ-Vercel',
      status: onVercel ? 'ok' : 'fail',
      detail: onVercel
        ? `x-vercel-id: ${vercelId} · ${dnsSummary}`
        : `לא זוהתה כותרת x-vercel-id — ייתכן שהדומיין מצביע לשרת אחר · ${dnsSummary}`,
      dns: { a: dns.a, cname: dns.cname, errors: dns.errors },
    },
    {
      /* Deliberately narrow wording. This confirms the login ROUTE
         answers 200 to an outside request — it catches a broken rewrite
         or a failed deploy. It is NOT proof "the app is up": anyone
         reading this screen already loaded the app to get here, so this
         check can never be the thing that tells them it is down. */
      key: 'app_login', label: 'מסך הכניסה מחזיר 200 מבחוץ',
      status: appLogin.ok ? 'ok' : 'fail',
      detail: appLogin.detail, ms: appLogin.ms, retried: !!appLogin.retried,
    },
  ]
}

/* One Hebrew line naming the FIRST real problem, so the stored summary
   reads like the examples ("תקלה — האתר מציג גרסה ישנה"). */
export function summarize(checks) {
  const failed  = checks.filter(c => c.status === 'fail')
  const warned  = checks.filter(c => c.status === 'warn')
  const passed  = checks.filter(c => c.status !== 'fail').length

  let status = 'ok'
  let summary = `${passed}/${checks.length} בדיקות עברו`

  if (failed.length > 0) {
    status = 'fail'
    const first = failed[0]
    const reason =
      first.key === 'content'   ? 'האתר מציג גרסה ישנה' :
      first.key === 'ssl'       ? 'בעיה בתעודת SSL' :
      first.key === 'vercel'    ? 'הדומיין לא מוגש מ-Vercel' :
      first.key === 'apex_up'   ? 'האתר אינו מגיב' :
      first.key === 'www_up'    ? 'כתובת www אינה מגיבה' :
                                  'מסך הכניסה אינו מגיב'
    summary = `${reason} (${passed}/${checks.length})`
  } else if (warned.length > 0) {
    status = 'warn'
    const ssl = warned.find(c => c.key === 'ssl')
    summary = ssl
      ? `תעודת SSL פגה בעוד ${ssl.daysLeft} ימים (${passed}/${checks.length})`
      : `${passed}/${checks.length} בדיקות עברו, עם הערות`
  }
  return { status, summary, passed }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Authentication ──
  const authHeader  = req.headers.authorization || req.headers.Authorization
  const accessToken = authHeader && /^Bearer\s+/i.test(authHeader)
    ? authHeader.replace(/^Bearer\s+/i, '').trim()
    : null
  if (!accessToken) return res.status(401).json({ error: 'unauthorized' })

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error: userErr } = await supabase.auth.getUser(accessToken)
  if (userErr || !user) return res.status(401).json({ error: 'unauthorized' })

  // ── 2. Authorization: admin only ──
  const { data: profile, error: profErr } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profErr || !profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' })
  }

  // ── 3. Run the checks ──
  let checks
  try {
    checks = await runChecks()
  } catch (e) {
    console.error('site-health: checks threw:', e)
    return res.status(500).json({ error: 'check_failed', detail: e.message || String(e) })
  }
  const { status, summary, passed } = summarize(checks)

  // ── 4. Record it. The insert runs as the CALLER (their token is on
  //      the client above), so admin_can_insert_site_health applies. ──
  const row = {
    checked_by:   user.id,
    status,
    passed_count: passed,
    total_count:  checks.length,
    summary,
    results:      checks,
  }
  const { data: saved, error: insErr } = await supabase
    .from('site_health_checks')
    .insert(row)
    .select('id, checked_at, status, passed_count, total_count, summary, results')
    .single()

  if (insErr) {
    /* The checks DID run — hand the results back even though we could
       not persist them, and say so, rather than pretending the run
       failed outright. */
    console.error('site-health: insert failed:', insErr)
    return res.status(200).json({ ...row, checked_at: new Date().toISOString(), saved: false })
  }

  return res.status(200).json({ ...saved, saved: true })
}
