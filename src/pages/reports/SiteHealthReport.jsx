// src/pages/reports/SiteHealthReport.jsx
//
// Admin-only screen under "ניהול": "בדיקת אתר".
//
// Verifies that the public marketing site (batim-es.com) is up, serving
// the RIGHT content, and pointed at Vercel. Exists because of a real
// incident: the domain silently reverted to the old WordPress host after
// Hostinger's auto-CDN injected its own DNS records, and nobody noticed
// for weeks because testing was always done against the direct Vercel
// URL rather than the real domain.
//
// The checks themselves run in api/site-health.js — they CANNOT run here.
// A browser cannot read a cross-origin response body or status without
// CORS, cannot see certificate details at all, and has no DNS API. This
// screen only triggers the run and renders what came back.
//
// On entry it shows the LAST STORED result without re-running, so every
// staff member sees the same "last checked" line.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import '../ReportTable.css'

/* The two escape hatches. They matter precisely when the domain is
   broken — which is the moment someone opens this screen. */
const FALLBACKS = [
  { label: 'האתר ישירות ב-Vercel', url: 'https://batim-website.vercel.app' },
  { label: 'האפליקציה / כניסה',    url: 'https://studio-batim.vercel.app' },
]

const STATUS_META = {
  ok:   { label: 'תקין',  color: '#3f7a3f', bg: '#eef5ee', mark: '✓' },
  warn: { label: 'שימו לב', color: '#a8761f', bg: '#fdf6e8', mark: '!' },
  fail: { label: 'תקלה',  color: '#c94b4b', bg: '#fdecea', mark: '✕' },
}
const metaFor = (s) => STATUS_META[s] || STATUS_META.fail

/* "12.8.26 21:40" — the format the last-checked line uses. */
function formatStamp(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(-2)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function CopyButton({ url }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard needs a secure context and can still be refused —
         select the text so it can be copied by hand rather than
         leaving a dead button. */
      const el = document.getElementById(`fallback-${url}`)
      if (el && el.select) { el.focus(); el.select() }
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      style={{
        background: copied ? '#eef5ee' : '#fff',
        color: copied ? '#3f7a3f' : '#2D3748',
        border: `1px solid ${copied ? '#3f7a3f' : '#d1d5db'}`,
        borderRadius: 8, padding: '6px 14px', fontFamily: 'inherit',
        fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >
      {copied ? 'הועתק ✓' : 'העתק'}
    </button>
  )
}

export default function SiteHealthReport() {
  const navigate = useNavigate()
  const [role, setRole] = useState(null)

  const [result,  setResult]  = useState(null)   /* last stored OR just-run */
  const [loading, setLoading] = useState(true)   /* initial load of last result */
  const [running, setRunning] = useState(false)  /* a check run in flight */

  /* A failure to RUN the check is a completely different thing from the
     check running and finding the site broken, and the two must never
     look alike — one says "we don't know", the other says "the site is
     down". Kept in its own state with its own neutral presentation, and
     it deliberately never clears `result`, so the last known status
     stays on screen while this explains why it wasn't refreshed. */
  const [runProblem, setRunProblem] = useState(null)  /* { title, detail } | null */

  /* The API route is a Vercel serverless function. `vite dev` serves the
     SPA only and has no /api handling at all, so the button cannot work
     here — say so up front instead of letting it fail and look like an
     outage. */
  const isLocalDev = typeof window !== 'undefined'
    && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')

      /* Last stored result — shown WITHOUT re-running, so the screen
         opens instantly and everyone sees the same line. */
      const { data, error: err } = await supabase
        .from('site_health_checks')
        .select('id, checked_at, status, passed_count, total_count, summary, results')
        .order('checked_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (err) console.error('SiteHealthReport — load last result failed:', err)
      if (data) setResult(data)
      setLoading(false)
    }
    init()
  }, [])

  const runCheck = async () => {
    setRunning(true)
    setRunProblem(null)
    try {
      /* The endpoint is admin-gated by the caller's own access token,
         the same pattern the PDF endpoints use. */
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }

      let res
      try {
        res = await fetch('/api/site-health', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
      } catch (netErr) {
        /* fetch itself rejected — the request never got an answer. This
           is about THIS browser's connection to the app, and says
           nothing whatsoever about batim-es.com. */
        console.error('SiteHealthReport — request failed:', netErr)
        setRunProblem({
          title:  'לא הצלחנו להריץ את הבדיקה',
          detail: 'הבקשה לשרת לא הושלמה. ייתכן שאין חיבור לרשת. זה לא אומר דבר על מצב האתר — התוצאה האחרונה שמוצגת למטה היא מהבדיקה הקודמת.',
        })
        return
      }

      /* 404 = the serverless function isn't there. Under `vite dev` that
         is ALWAYS the case: Vite serves the SPA and nothing under /api.
         In a deployed environment it means the function failed to build
         or wasn't included. Either way it is an environment problem, not
         a site problem. */
      if (res.status === 404) {
        setRunProblem({
          title: 'הבדיקה אינה זמינה בסביבה הזו',
          detail: isLocalDev
            ? 'שרת הפיתוח המקומי (vite) לא מריץ פונקציות שרת, ולכן /api/site-health לא קיים כאן. הבדיקה תעבוד בסביבה מפורסמת (preview או production). זו מגבלה של סביבת הפיתוח — לא תקלה באתר.'
            : 'נתיב /api/site-health לא נמצא בשרת. ייתכן שהפריסה האחרונה לא כללה את הפונקציה. זו תקלת סביבה — לא תקלה באתר.',
        })
        return
      }
      if (res.status === 401) {
        setRunProblem({ title: 'הבדיקה לא רצה', detail: 'ההתחברות פגה. התחברי מחדש ונסי שוב.' })
        return
      }
      if (res.status === 403) {
        setRunProblem({ title: 'הבדיקה לא רצה', detail: 'להרצת הבדיקה נדרשת הרשאת מנהל.' })
        return
      }

      /* Parse defensively: a misrouted request can answer 200 with the
         SPA's HTML, and blindly calling res.json() would surface that as
         an unintelligible parse error. */
      let data = null
      try {
        data = await res.json()
      } catch {
        setRunProblem({
          title:  'התקבלה תשובה לא צפויה מהשרת',
          detail: `השרת החזיר תוכן שאינו תוצאת בדיקה (סטטוס ${res.status}). זו תקלת סביבה — לא תקלה באתר.`,
        })
        return
      }

      if (!res.ok) {
        setRunProblem({
          title:  'הבדיקה לא הושלמה',
          detail: (data && data.detail) || `השרת החזיר שגיאה ${res.status}. זו תקלת סביבה — לא תקלה באתר.`,
        })
        return
      }

      setResult(data)
      if (data.saved === false) {
        /* The checks DID run and the result on screen is real — only the
           recording failed, so this is a caveat, not a failed run. */
        setRunProblem({
          title:  'התוצאה לא נשמרה',
          detail: 'הבדיקה רצה והתוצאה מוצגת כאן, אך לא נשמרה בבסיס הנתונים — שאר הצוות לא יראה אותה.',
        })
      }
    } finally {
      setRunning(false)
    }
  }

  if (role !== 'admin') return null

  const meta   = result ? metaFor(result.status) : null
  const checks = Array.isArray(result?.results) ? result.results : []

  return (
    <div className="report-table-page" dir="rtl">
      <div className="report-header-row">
        <h1 className="report-page-title">בדיקת אתר</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>← חזרה לדוחות</button>
      </div>

      {/* ── Last-checked line + run button ── */}
      <div className="report-controls" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {loading ? (
          <span className="report-loading" style={{ margin: 0 }}>טוען...</span>
        ) : result ? (
          <span style={{ fontSize: 14, color: '#2D3748' }}>
            {/* Labelled explicitly: when a run fails this line is still
                here, and it must read as history rather than as the
                outcome of the click that just happened. */}
            <span style={{ color: '#6b7280' }}>נבדק לאחרונה: </span>
            {formatStamp(result.checked_at)}
            {' · '}
            <b style={{ color: meta.color }}>{meta.label}</b>
            {' — '}
            {result.summary}
          </span>
        ) : (
          <span style={{ fontSize: 14, color: '#6b7280' }}>טרם בוצעה בדיקה</span>
        )}

        <button
          className="hours-report-fetch-btn"
          onClick={runCheck}
          disabled={running}
          style={{
            marginInlineStart: 'auto',
            ...(running ? { opacity: 0.5, cursor: 'not-allowed' } : null),
          }}
        >
          {running ? 'בודק...' : 'הרץ בדיקה'}
        </button>
      </div>

      {/* ── "the check couldn't run" ──
          Deliberately NOT red. Red on this screen means the SITE has a
          problem; this means we simply don't know, which is a different
          message and must not be mistaken for an outage. Neutral sand
          border + ℹ, and it explicitly points at the result below as
          still being the last known state. */}
      {runProblem && (
        <div style={{
          background: '#fdf8ef', border: '1px solid #e3d5b8',
          borderInlineStart: '4px solid #c8a55b',
          borderRadius: 8, padding: '10px 14px', marginBottom: 14,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 15, lineHeight: 1.4, flexShrink: 0 }}>ℹ️</span>
          <div>
            <div style={{ fontWeight: 700, color: '#7a5c1e', fontSize: 13.5, marginBottom: 3 }}>
              {runProblem.title}
            </div>
            <div style={{ color: '#4a4a48', fontSize: 13, lineHeight: 1.6 }}>
              {runProblem.detail}
            </div>
          </div>
        </div>
      )}

      {/* Same message before anyone clicks, so the button doesn't look
          broken on localhost. */}
      {isLocalDev && !runProblem && (
        <div style={{
          color: '#6b7280', fontSize: 12.5, marginBottom: 14, lineHeight: 1.6,
        }}>
          ℹ️ בסביבת פיתוח מקומית הרצת הבדיקה אינה זמינה — שרת הפיתוח לא מריץ פונקציות שרת.
          מוצגת התוצאה האחרונה שנשמרה.
        </div>
      )}

      {/* ── The six checks ── */}
      {!loading && checks.length > 0 && (
        <div className="report-card" style={{ overflow: 'hidden', width: '100%', marginBottom: 18 }}>
          <table className="report-stage-table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>סטטוס</th>
                <th>בדיקה</th>
                <th>פירוט</th>
              </tr>
            </thead>
            <tbody>
              {checks.map(c => {
                const m = metaFor(c.status)
                return (
                  <tr key={c.key}>
                    <td>
                      <span style={{
                        display: 'inline-block', minWidth: 62, textAlign: 'center',
                        background: m.bg, color: m.color, border: `1px solid ${m.color}`,
                        borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600,
                      }}>
                        {m.mark} {m.label}
                      </span>
                    </td>
                    <td>{c.label}</td>
                    <td style={{ color: '#4a4a48', fontSize: 13, wordBreak: 'break-word' }}>
                      {c.detail}
                      {c.retried && (
                        <span style={{ color: '#a8761f', fontSize: 12 }}> · נדרש ניסיון חוזר</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Fallback URLs ──
          Deliberately ALWAYS visible, never hidden behind a passing
          result: they are needed exactly when something is broken. */}
      <div className="report-card" style={{ width: '100%', padding: '14px 16px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#2D3748', marginBottom: 4 }}>
          כתובות גיבוי
        </div>
        <div style={{ fontSize: 12.5, color: '#6b7280', marginBottom: 12 }}>
          עוקפות את הדומיין ופונות ישירות ל-Vercel — שימושיות כשהדומיין עצמו לא זמין.
        </div>
        {FALLBACKS.map(f => (
          <div
            key={f.url}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderTop: '1px solid rgba(26,26,24,0.08)',
            }}
          >
            <div style={{ minWidth: 150, fontSize: 13.5, color: '#2D3748' }}>{f.label}</div>
            <input
              id={`fallback-${f.url}`}
              readOnly
              value={f.url}
              onFocus={e => e.target.select()}
              dir="ltr"
              style={{
                flex: '1 1 auto', minWidth: 0, fontFamily: 'inherit', fontSize: 13,
                color: '#4a4a48', background: '#fafafa', border: '1px solid #d9d6cd',
                borderRadius: 8, padding: '6px 10px', textAlign: 'left',
              }}
            />
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 13, color: '#7a9478', textDecoration: 'none',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              פתח ↗
            </a>
            <CopyButton url={f.url} />
          </div>
        ))}
      </div>
    </div>
  )
}
