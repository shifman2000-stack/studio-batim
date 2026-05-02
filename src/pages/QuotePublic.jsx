// src/pages/QuotePublic.jsx
// Public client-facing route — renders a sent quote in read-only mode.
// Accessible without authentication: /quote/:token
// Fetches via RPC (get_quote_by_token) so no direct table access is needed.
//
// The outermost div in every return branch uses position:fixed so it escapes
// index.css's html/body/#root overflow:hidden + height:100% constraints.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuotePreview from '../components/QuotePreview'

// Fields the client is allowed to fill in / sign.
// Everything else stays locked (rendered as static text).
const CLIENT_EDITABLE_FIELDS = [
  'client1.name', 'client1.id', 'client1.phone', 'client1.email',
  'client2.name', 'client2.id', 'client2.phone', 'client2.email',
  'clientLastName',
  'sig1.name', 'sig1.date', 'sig1.signature',
  'sig2.name', 'sig2.date', 'sig2.signature',
]

// Base wrapper applied to ALL return branches.
// position:fixed lifts it out of the constrained #root flexbox;
// overflow:auto re-enables scrolling within this layer.
const WRAPPER = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  overflow: 'auto',
  background: '#e5e2dc',
  zIndex: 50,
  direction: 'rtl',
}

// Inject the spinner keyframe once at module load time.
if (typeof document !== 'undefined' && !document.getElementById('quote-public-spin-style')) {
  const styleEl = document.createElement('style')
  styleEl.id = 'quote-public-spin-style'
  styleEl.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`
  document.head.appendChild(styleEl)
}

/* ── Shared button styles ─────────────────────────────────────────────── */
const BTN_BASE = {
  padding:       '9px 22px',
  fontFamily:    "'Heebo', sans-serif",
  fontWeight:    300,
  fontSize:      12,
  letterSpacing: '0.12em',
  borderRadius:  0,
  cursor:        'pointer',
}
const BTN_SECONDARY = {
  ...BTN_BASE,
  background: 'transparent',
  color:      '#1a1a18',
  border:     '1px solid rgba(26,26,24,0.22)',
}
const BTN_PRIMARY = {
  ...BTN_BASE,
  background: '#1a1a18',
  color:      '#f7f5f2',
  border:     '1px solid #1a1a18',
}

export default function QuotePublic() {
  const { token } = useParams()

  const [version,           setVersion]           = useState(null)
  const [localData,         setLocalData]         = useState(null)
  const [loading,           setLoading]           = useState(true)
  const [notFound,          setNotFound]          = useState(false)
  const [isPdfGenerating,   setIsPdfGenerating]   = useState(false)
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [submitting,        setSubmitting]        = useState(false)
  const [submitted,         setSubmitted]         = useState(false)
  const [submitError,       setSubmitError]       = useState('')
  const [signedFileUrl,     setSignedFileUrl]     = useState('')

  // Derived: is the form ready to submit?
  const client2HasName = !!(localData?.client2?.name && localData.client2.name.trim() !== '')
  const sig1Done  = !!(localData?.sig1?.signature)
  const sig2Done  = !!(localData?.sig2?.signature)
  const canSubmit = sig1Done && (!client2HasName || sig2Done)

  useEffect(() => {
    const load = async () => {
      if (!token) {
        setNotFound(true)
        setLoading(false)
        return
      }

      const { data, error } = await supabase.rpc('get_quote_by_token', { p_token: token })

      // RPC returns TABLE → always an array; grab the first (and only) row
      const ver = Array.isArray(data) && data.length > 0 ? data[0] : null

      if (error || !ver) {
        setNotFound(true)
      } else {
        setVersion(ver)
        // Pre-fill today's date into empty sig date fields
        const today = new Date().toISOString().slice(0, 10)
        const enriched = {
          ...ver.content,
          sig1: { ...(ver.content?.sig1 || {}), date: ver.content?.sig1?.date || today },
          sig2: { ...(ver.content?.sig2 || {}), date: ver.content?.sig2?.date || today },
        }
        setLocalData(enriched)
      }
      setLoading(false)
    }
    load()
  }, [token])

  const handleDownloadPdf = async () => {
    setIsPdfGenerating(true)
    try {
      const response = await fetch('/api/generate-pdf', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ quoteId: version.quote_id }),
      })

      if (response.status === 404) {
        alert('שמירה כ-PDF זמינה רק בסביבת ייצור')
        return
      }
      if (!response.ok) {
        alert('שגיאה בייצור PDF')
        return
      }

      const blob = await response.blob()
      const url  = window.URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = 'הצעת מחיר - סטודיו בתים.pdf'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PDF download error:', err)
      alert('שגיאה בייצור PDF')
    } finally {
      setIsPdfGenerating(false)
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setSubmitError('')
    try {
      const response = await fetch('/api/finalize-quote', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, content: localData }),
      })
      const result = await response.json()
      if (!response.ok) {
        setSubmitError(result.error || 'אירעה שגיאה. נסו שוב או פנו לסטודיו בתים.')
        setSubmitting(false)
        return
      }
      setSignedFileUrl(result.file_url || '')
      setShowSubmitConfirm(false)
      setSubmitted(true)
    } catch (err) {
      console.error('Submit error:', err)
      setSubmitError('אירעה שגיאה. נסו שוב או פנו לסטודיו בתים.')
      setSubmitting(false)
    }
  }

  /* ── LOADING ── */
  if (loading) {
    return (
      <div style={{
        ...WRAPPER,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Heebo', sans-serif", fontWeight: 300,
        fontSize: 16, color: '#1a1a18',
      }}>
        טוען...
      </div>
    )
  }

  /* ── NOT FOUND ── */
  if (notFound || !version) {
    return (
      <div style={{
        ...WRAPPER,
        background: '#f7f5f2',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px',
        fontFamily: "'Heebo', sans-serif",
      }}>
        <div style={{
          background: '#ffffff', maxWidth: 480, width: '100%',
          padding: '48px 36px',
          border: '1px solid rgba(26,26,24,0.13)',
        }}>
          <p style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 26, fontWeight: 400, color: '#1a1a18',
            margin: '0 0 16px',
          }}>
            ההצעה אינה זמינה
          </p>
          <p style={{
            fontFamily: "'Heebo', sans-serif",
            fontSize: 14, fontWeight: 300, color: '#4a4a48',
            lineHeight: 1.7, margin: 0,
          }}>
            ייתכן שהקישור פג תוקף או הוסר. נא לפנות לסטודיו בתים
          </p>
        </div>
      </div>
    )
  }

  /* ── SUBMITTED — thank-you page ── */
  if (submitted) {
    return (
      <div style={{
        ...WRAPPER,
        background: '#f7f5f2',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px 20px',
      }}>
        <div style={{
          background:  '#ffffff',
          border:      '1px solid rgba(26,26,24,0.13)',
          padding:     '56px 40px',
          maxWidth:    520,
          width:       '100%',
          textAlign:   'center',
          fontFamily:  "'Heebo', sans-serif",
        }}>
          <p style={{
            fontFamily:   "'Playfair Display', serif",
            fontSize:     32,
            fontWeight:   400,
            color:        '#1a1a18',
            margin:       '0 0 18px',
          }}>
            תודה!
          </p>
          <p style={{
            fontFamily: "'Heebo', sans-serif",
            fontWeight: 300,
            fontSize:   15,
            color:      '#4a4a48',
            lineHeight: 1.7,
            margin:     '0 0 30px',
          }}>
            ההצעה התקבלה אצל סטודיו בתים.
          </p>
          <p style={{
            fontFamily: "'Heebo', sans-serif",
            fontWeight: 300,
            fontSize:   13,
            color:      '#8a8680',
            margin:     '0 0 30px',
          }}>
            לכל שאלה אני זמינה: einav.studiob@gmail.com · 052-9593927
          </p>
          {signedFileUrl && (
            <button
              onClick={() => window.open(signedFileUrl, '_blank')}
              style={{
                background:    '#1a1a18',
                color:         '#f7f5f2',
                border:        '1px solid #1a1a18',
                padding:       '12px 28px',
                fontFamily:    "'Heebo', sans-serif",
                fontWeight:    300,
                fontSize:      13,
                letterSpacing: '0.12em',
                borderRadius:  0,
                cursor:        'pointer',
              }}
            >
              הורדת ההצעה החתומה
            </button>
          )}
        </div>
      </div>
    )
  }

  /* ── LOADED ── */
  return (
    <div style={WRAPPER}>

      {/* Sticky action bar — dark, matches qb-bar.
          position:sticky works correctly here because the scroll container
          is the WRAPPER div (overflow:auto), not the clipped #root. */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#1a1a18',
        padding: '12px 24px',
        display: 'flex', justifyContent: 'flex-end',
      }}>
        <button
          onClick={handleDownloadPdf}
          disabled={isPdfGenerating}
          style={{
            background:    'transparent',
            color:         '#f0ede6',
            border:        '1px solid rgba(255,255,255,0.18)',
            padding:       '7px 16px',
            fontFamily:    "'Heebo', sans-serif",
            fontWeight:    300, fontSize: 12, letterSpacing: '0.12em',
            cursor:        isPdfGenerating ? 'not-allowed' : 'pointer',
            opacity:       isPdfGenerating ? 0.5 : 1,
            transition:    'all 0.18s',
          }}
        >
          {isPdfGenerating ? 'מייצר PDF...' : 'שמירה כ־PDF'}
        </button>
      </div>

      {/* Client notice banner */}
      <div style={{
        background:    '#f0ede6',
        borderBottom:  '1px solid rgba(26,26,24,0.10)',
        padding:       '14px 32px',
        fontFamily:    "'Heebo', sans-serif",
        fontSize:      13,
        fontWeight:    300,
        color:         '#4a4a48',
        lineHeight:    1.6,
        textAlign:     'center',
        direction:     'rtl',
      }}>
        אנא עברו על ההצעה, מלאו את פרטי המזמינים וחתמו בסוף
      </div>

      {/* Quote body */}
      <div style={{ background: '#e5e2dc', paddingTop: 20 }}>
        <QuotePreview
          data={localData}
          onChange={setLocalData}
          isReadOnly={true}
          editableFields={CLIENT_EDITABLE_FIELDS}
        />
      </div>

      {/* Submit button */}
      <div style={{
        display:        'flex',
        justifyContent: 'center',
        padding:        '40px 20px 60px',
        background:     '#e5e2dc',
      }}>
        <button
          onClick={() => setShowSubmitConfirm(true)}
          disabled={!canSubmit}
          style={{
            background:    '#1a1a18',
            color:         '#f7f5f2',
            border:        '1px solid #1a1a18',
            padding:       '14px 36px',
            fontFamily:    "'Heebo', sans-serif",
            fontWeight:    300,
            fontSize:      '14px',
            letterSpacing: '0.12em',
            borderRadius:  0,
            cursor:        canSubmit ? 'pointer' : 'not-allowed',
            opacity:       canSubmit ? 1 : 0.35,
          }}
        >
          שלח טופס חתום
        </button>
      </div>

      {/* Confirmation modal */}
      {showSubmitConfirm && (
        <div style={{
          position:       'fixed',
          inset:          0,
          background:     'rgba(0,0,0,0.5)',
          zIndex:         1000,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
        }}>
          <div style={{
            background:  '#f7f5f2',
            border:      '1px solid rgba(26,26,24,0.13)',
            padding:     '32px 36px',
            maxWidth:    520,
            width:       '90vw',
            fontFamily:  "'Heebo', sans-serif",
            direction:   'rtl',
          }}>

            {submitting ? (
              /* ── Loading state ── */
              <div style={{
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                gap:            16,
                padding:        '8px 0',
              }}>
                <div style={{
                  width:        20,
                  height:       20,
                  border:       '2px solid rgba(0,0,0,0.1)',
                  borderTop:    '2px solid #1a1a18',
                  borderRadius: '50%',
                  animation:    'spin 1s linear infinite',
                }} />
                <p style={{
                  fontFamily: "'Heebo', sans-serif",
                  fontWeight: 300,
                  fontSize:   14,
                  color:      '#1a1a18',
                  margin:     0,
                }}>
                  אנא המתינו מספר שניות עד שהטופס יישמר...
                </p>
              </div>
            ) : (
              /* ── Confirmation state ── */
              <>
                {submitError && (
                  <p style={{
                    fontFamily: "'Heebo', sans-serif",
                    fontWeight: 300,
                    fontSize:   13,
                    color:      '#c0392b',
                    margin:     '0 0 16px',
                  }}>
                    {submitError}
                  </p>
                )}
                <p style={{
                  fontFamily: "'Heebo', sans-serif",
                  fontWeight: 300,
                  fontSize:   14,
                  color:      '#1a1a18',
                  lineHeight: 1.7,
                  margin:     '0 0 28px',
                }}>
                  האם לשלוח את ההצעה החתומה? לאחר השליחה לא ניתן יהיה לערוך.
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
                  <button style={BTN_SECONDARY} onClick={() => setShowSubmitConfirm(false)}>
                    ביטול
                  </button>
                  <button style={BTN_PRIMARY} onClick={handleSubmit}>
                    אישור ושליחה
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}

    </div>
  )
}
