import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuoteJourneyV2 from '../components/quoteV2/QuoteJourneyV2'

/* ═══════════════════════════════════════════════════════════════════════
   הפן השיווקי של הלקוח — הצעת v2 לפי טוקן.

   מגיעים לכאן מ-QuoteRouter, ורק כש-content.schema === 2. הצעות v1
   לא עוברות כאן בכלל.

   כל מצב החתימה חי כאן ולא ברכיב המסע, כי **אותו אובייקט בדיוק** הוא
   מה שנשלח לשרת. המסע מקבל אותו ב-prop `client` ומדווח עליו חזרה.
   ═══════════════════════════════════════════════════════════════════════ */

const SHELL = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
  background: '#16201d', zIndex: 50,
}
const MSG = {
  ...SHELL, alignItems: 'center', justifyContent: 'center',
  color: '#efe7d8', fontFamily: 'Heebo, sans-serif', direction: 'rtl',
  padding: 40, textAlign: 'center',
}

const EMPTY_RESPONSE = { extrasSelected: [], consentChecked: false, signatures: [] }

export default function QuoteSignV2({ token: tokenProp, version: versionProp }) {
  const params = useParams()
  const token = tokenProp ?? params.token

  const [version, setVersion] = useState(versionProp ?? null)
  const [loading, setLoading] = useState(!versionProp)
  const [notFound, setNotFound] = useState(false)

  const [response, setResponse] = useState(EMPTY_RESPONSE)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [signedFileUrl, setSignedFileUrl] = useState('')
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')

  useEffect(() => {
    if (versionProp || !token) { if (!token) setNotFound(true); return }
    let cancelled = false
    const load = async () => {
      const { data, error: err } = await supabase.rpc('get_quote_by_token', { p_token: token })
      const ver = Array.isArray(data) && data.length > 0 ? data[0] : null
      if (cancelled) return
      if (err || !ver?.content) setNotFound(true)
      else setVersion(ver)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [token, versionProp])

  /* הצעה שכבר נחתמה נפתחת ישר במצב החתום, והקישור ממשיך לחיות
     (החלטה 16) — הלקוח יכול לחזור ולהוריד את ה-PDF. */
  useEffect(() => {
    if (!version) return
    if (version.is_signed) {
      setSubmitted(true)
      setSignedFileUrl(version.signed_file_url || '')
    }
    setResponse({ ...EMPTY_RESPONSE, ...(version.content?.clientResponse ?? {}) })
  }, [version])

  const handleDownloadPdf = async () => {
    setPdfBusy(true)
    setPdfError('')
    try {
      const res = await fetch('/api/quote-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) throw new Error('שגיאה ביצירת ה-PDF')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `הצעת מחיר - סטודיו בתים.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      setPdfError(e.message || 'שגיאה ביצירת ה-PDF')
    } finally {
      setPdfBusy(false)
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const payload = {
        ...response,
        consentCheckedAt: new Date().toISOString(),
        signatures: (response.signatures ?? []).map((sg, i) => ({
          ...sg, clientIndex: i, signedAtClient: sg?.signedAtClient ?? new Date().toISOString(),
        })),
      }
      const res = await fetch('/api/finalize-quote-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, clientResponse: payload }),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok || !out.success) throw new Error(out.detail || out.error || 'שליחה נכשלה')
      setSignedFileUrl(out.file_url || '')
      setSubmitted(true)
    } catch (e) {
      setError(e.message || 'שליחה נכשלה. אפשר לנסות שוב.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div style={MSG}>טוען…</div>
  if (notFound) return <div style={MSG}>הקישור אינו תקף. אפשר לפנות לסטודיו לקבלת קישור חדש.</div>

  return (
    <div style={SHELL}>
      <QuoteJourneyV2
        content={version.content}
        client={{
          response, setResponse,
          onSubmit: handleSubmit, submitting, submitted, error, signedFileUrl,
          onDownloadPdf: handleDownloadPdf, pdfBusy, pdfError,
        }}
      />
    </div>
  )
}
