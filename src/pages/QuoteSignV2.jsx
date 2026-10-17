import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuoteJourneyV2 from '../components/quoteV2/QuoteJourneyV2'
import QuoteTowerV2 from '../components/quoteV2/QuoteTowerV2'

/* ═══════════════════════════════════════════════════════════════════════
   מסך הלקוח של הצעת v2 — שני מבטים על אותה שורת quote_versions.

   · view="journey"  →  /quote/:token       — הפן השיווקי, המסע.
   · view="full"     →  /quote/:token/full  — המסמך המלא, ובו החתימה.

   מגיעים לכאן מ-QuoteRouter, ורק כש-content.schema === 2. הצעות v1
   לא עוברות כאן בכלל.

   ⚠️ שני המבטים חולקים את הקובץ הזה ולא רק במקרה: הטעינה, מצב
   החתימה והשליחה חייבים להיות אותו קוד בדיוק. מצב החתימה חי כאן
   ולא ברכיב התצוגה, כי **אותו אובייקט בדיוק** הוא מה שנשלח לשרת.
   ═══════════════════════════════════════════════════════════════════════ */

const SHELL = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
  background: '#16201d', zIndex: 50,
}
/* המסמך המלא הוא גיליון בהיר, ובניגוד למסע אין לו מכל גלילה משלו —
   index.css נועל את html/body/#root ל-overflow:hidden, ולכן הוא
   מקבל אחד כאן. */
const SHELL_FULL = {
  position: 'fixed', inset: 0, overflowY: 'auto', overflowX: 'hidden',
  background: '#e7e4de', zIndex: 50, WebkitOverflowScrolling: 'touch',
}
const BACKBAR = {
  position: 'sticky', top: 0, zIndex: 2,
  background: 'rgba(231,228,222,.92)', backdropFilter: 'blur(6px)',
  borderBottom: '1px solid #d6d2cb', padding: '10px 16px',
  display: 'flex', justifyContent: 'flex-start',
}
const BACKBTN = {
  font: 'inherit', fontFamily: 'Heebo, sans-serif', fontSize: 14,
  color: '#1c1a18', background: 'transparent', border: '1px solid #c9c4bc',
  borderRadius: 99, padding: '7px 14px', cursor: 'pointer', textDecoration: 'none',
}
const MSG = {
  ...SHELL, alignItems: 'center', justifyContent: 'center',
  color: '#efe7d8', fontFamily: 'Heebo, sans-serif', direction: 'rtl',
  padding: 40, textAlign: 'center',
}

const EMPTY_RESPONSE = { extrasSelected: [], consentChecked: false, signatures: [] }

export default function QuoteSignV2({ token: tokenProp, version: versionProp, view = 'journey' }) {
  const params = useParams()
  const token = tokenProp ?? params.token
  const full = view === 'full'

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
        /* הפן השיווקי כבר לא מציג בחירת תוספות, ולכן שליחה חדשה
           תמיד מגיעה בלי בחירה. השדה נשאר במבנה כי זה מה ש-
           finalize-quote-v2 מצפה לו, ומה שכבר נשמר בהצעות קיימות
           לא נוגעים בו. */
        extrasSelected: [],
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
      /* ⚠️ מיזוג התשובה אל ה-content שבזיכרון. בלעדיו המסמך המלא
         היה ממשיך להציג שורות חתימה ריקות אחרי חתימה מוצלחת:
         signersOf ו-isSignedContent קוראים מ-content.clientResponse,
         והשורה שנטענה מהמסד היא זו שלפני השליחה. השרת כבר כתב את
         אותו דבר בדיוק אצלו; זו רק אותה אמת, מקומית. */
      setVersion(prev => (prev
        ? { ...prev, is_signed: true, signed_file_url: out.file_url || '',
            content: { ...prev.content, clientResponse: payload } }
        : prev))
    } catch (e) {
      setError(e.message || 'שליחה נכשלה. אפשר לנסות שוב.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div style={MSG}>טוען…</div>
  if (notFound) return <div style={MSG}>הקישור אינו תקף. אפשר לפנות לסטודיו לקבלת קישור חדש.</div>

  const client = {
    response, setResponse,
    onSubmit: handleSubmit, submitting, submitted, error, signedFileUrl,
    onDownloadPdf: handleDownloadPdf, pdfBusy, pdfError,
    /* מה שהמסע צריך כדי להוביל אל המסמך המלא. הטוקן לא יוצא מכאן
       בשום צורה אחרת — רכיבי התצוגה לא מכירים כתובות. */
    fullHref: `/quote/${token}/full`,
    signed: submitted,
  }

  if (full) {
    return (
      <div style={SHELL_FULL} dir="rtl" lang="he">
        {/* ⚠️ הכפתור יושב כאן ולא בתוך QuoteTowerV2 בכוונה: המגדל הוא
            גם המסמך שמודפס ל-PDF, וכפתור ניווט בתוכו היה תלוי בכך
            שמישהו זוכר להסתיר אותו שם. מחוץ לו אין מה לשכוח. */}
        <div style={BACKBAR}>
          <a href={`/quote/${token}`} style={BACKBTN}>חזרה להצעה המקוצרת</a>
        </div>
        <QuoteTowerV2 content={version.content} client={client} />
      </div>
    )
  }

  return (
    <div style={SHELL}>
      <QuoteJourneyV2 content={version.content} client={client} />
    </div>
  )
}
