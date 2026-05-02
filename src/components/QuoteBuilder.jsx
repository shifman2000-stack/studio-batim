import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import QuotePreview, { buildInitialData } from './QuotePreview'
import { Send, Copy, Check, X } from 'lucide-react'
import './QuoteBuilder.css'

export default function QuoteBuilder({ inquiry, onClose, onQuoteUpdated }) {
  const [quoteId,     setQuoteId]     = useState(null)
  const [quoteStatus, setQuoteStatus] = useState('draft')
  const [data,        setData]        = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [isPdfGenerating, setIsPdfGenerating] = useState(false)
  const [actionMsg,      setActionMsg]      = useState('')
  const [showConfirmModal,  setShowConfirmModal]  = useState(false)
  const [sendResultModal,   setSendResultModal]   = useState(null)
  const [copied,            setCopied]            = useState(false)
  const [latestToken,       setLatestToken]       = useState(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

  // Always-current reference to data, updated synchronously on every field change.
  // Prevents stale-closure bugs where an input's onChange and the save button
  // click land in the same event-loop tick before React flushes the new state.
  const dataRef = useRef(null)

  const handleDataChange = (newData) => {
    dataRef.current = newData
    setData(newData)
  }

  /* ── On open: load existing quote, or initialise from inquiry ── */
  useEffect(() => {
    const init = async () => {
      setLoading(true)
      const { data: existing, error: loadError } = await supabase
        .from('quotes')
        .select('*')
        .eq('inquiry_id', inquiry.id)
        .order('quote_number', { ascending: true })
        .limit(1)
        .maybeSingle()

      console.log('loaded quote:', existing, 'error:', loadError)

      if (existing) {
        // Merge saved content onto current defaults so any new schema fields
        // introduced since the draft was saved get a safe fallback value.
        const base   = buildInitialData(inquiry)
        const merged = existing.draft_content
          ? { ...base, ...existing.draft_content }
          : base
        dataRef.current = merged
        setQuoteId(existing.id)
        setQuoteStatus(existing.status ?? 'draft')
        setData(merged)

        // Fetch the latest version token so read-only bar can show the link
        const { data: latestVer } = await supabase
          .from('quote_versions')
          .select('form_token')
          .eq('quote_id', existing.id)
          .not('form_token', 'is', null)
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (latestVer) setLatestToken(latestVer.form_token)
      } else {
        // No existing quote — show fresh data, create DB row only on first save
        const initial   = buildInitialData(inquiry)
        dataRef.current = initial
        setData(initial)
      }
      setLoading(false)
    }
    init()
  }, [inquiry.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (msg) => {
    setActionMsg(msg)
    setTimeout(() => setActionMsg(''), 2500)
  }

  /* ── Core save helper — returns the quoteId (existing or newly created).
        Throws on error so callers can handle it differently.
        Does NOT touch saving/isPdfGenerating state — callers manage that. ── */
  const doSave = async () => {
    const toSave = dataRef.current ?? data
    if (!toSave) throw new Error('no data to save')
    console.log('saving data:', toSave)

    if (quoteId) {
      // Row already exists — update it
      const { data: saved, error } = await supabase
        .from('quotes')
        .update({ draft_content: toSave, updated_at: new Date().toISOString() })
        .eq('id', quoteId)
        .select()
        .single()
      console.log('save result (update):', saved, error)
      if (error) throw error
      return quoteId
    } else {
      // First save — create the row now
      const { data: created, error } = await supabase
        .from('quotes')
        .insert([{
          inquiry_id:    inquiry.id,
          quote_number:  1,
          status:        'draft',
          draft_content: toSave,
        }])
        .select()
        .single()
      console.log('save result (insert):', created, error)
      if (error) throw error
      setQuoteId(created.id)
      onQuoteUpdated?.(inquiry.id, { id: created.id, status: 'draft' })
      return created.id
    }
  }

  /* ── Save draft (button handler) ── */
  const handleSaveDraft = async () => {
    setSaving(true)
    try {
      await doSave()
      flash('נשמר ✓')
    } catch (err) {
      console.error('save error:', err)
      console.log('save error full:', JSON.stringify(err))
      flash('שגיאה בשמירה')
    } finally {
      setSaving(false)
    }
  }

  /* ── Preview — clone live DOM into new tab ── */
  const handlePreview = () => {
    // 1. Grab the wrapper that contains all 4 A4 pages
    const pagesContainer = document.querySelector('.qp-pages')
    if (!pagesContainer) return
    const clone = pagesContainer.cloneNode(true)

    // 2. Remove all edit controls from the clone
    clone.querySelectorAll('.qp-no-print, button, [contenteditable]').forEach(el => {
      el.removeAttribute('contenteditable')
    })
    clone.querySelectorAll('button').forEach(el => el.remove())

    // 3. Collect all CSS from current document
    const styles = Array.from(document.styleSheets)
      .map(sheet => {
        try { return Array.from(sheet.cssRules).map(r => r.cssText).join('\n') }
        catch { return '' }
      }).join('\n')

    // 4. Collect font links
    const fontLinks = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map(l => l.outerHTML).join('\n')

    // 5. Open new window and write full document
    const w = window.open('', '_blank')
    w.document.write(`
      <!DOCTYPE html>
      <html lang="he" dir="rtl">
      <head>
        <meta charset="UTF-8">
        ${fontLinks}
        <style>
          ${styles}
          body { background: #e5e2dc; margin: 0; padding: 40px 20px; overflow-y: auto !important; min-height: 100vh; }
          .qp-no-print { display: none !important; }
          .qp-page, .qp-pages { overflow: visible !important; }
          input, textarea {
            border: none !important;
            outline: none !important;
            background: transparent !important;
            pointer-events: none;
          }
          @media print {
            body {
              display: block !important;
              margin: 0 !important;
              padding: 0 !important;
              background: white !important;
            }
            .page {
              display: block !important;
              overflow: visible !important;
              height: auto !important;
              min-height: 1123px;
              box-shadow: none !important;
              margin: 0 !important;
              page-break-after: always;
              break-after: page;
            }
            .page:last-child {
              page-break-after: avoid;
              break-after: avoid;
            }
          }
        </style>
      </head>
      <body>
        ${clone.outerHTML}
      </body>
      </html>
    `)
    w.document.close()
  }

  /* ── Generate PDF via server-side Puppeteer ── */
  const handleGeneratePDF = async () => {
    setIsPdfGenerating(true)
    flash('מייצר PDF…')
    try {
      // Step 1 — Save draft first so Puppeteer renders the latest content
      let savedId
      try {
        savedId = await doSave()
      } catch (err) {
        console.error('save error before PDF:', err)
        flash('שגיאה בשמירת טיוטה. נסי שוב.')
        return
      }

      if (!savedId) {
        flash('שגיאה: לא ניתן לקבל מזהה הצעה')
        return
      }

      // Step 2 — Call the Puppeteer serverless function
      const response = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: savedId }),
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        console.error('PDF API error:', errBody)
        flash('שגיאה בייצור PDF. נסי שוב.')
        return
      }

      // Step 3 — Trigger browser download with a Hebrew filename
      const blob       = await response.blob()
      const familyName = inquiry.last_name || ''
      const url        = window.URL.createObjectURL(blob)
      const a          = document.createElement('a')
      a.href           = url
      a.download       = `הצעת מחיר - משפחת ${familyName}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      flash('PDF הורד ✓')
    } catch (err) {
      console.error('PDF generation error:', err)
      flash('שגיאה בייצור PDF. נסי שוב.')
    } finally {
      setIsPdfGenerating(false)
    }
  }

  /* ── Send — open confirmation modal (only from draft status) ── */
  const handleSend = () => {
    if (quoteStatus !== 'draft') return
    setShowConfirmModal(true)
  }

  /* ── Perform send — runs after user confirms ── */
  const performSend = async () => {
    setShowConfirmModal(false)

    // b. Persist latest content
    let savedId
    try {
      savedId = await doSave()
    } catch (err) {
      console.error('send — save error:', err)
      flash('שגיאה בשליחה')
      return
    }

    // d. Find next version number
    const { data: lastVersion, error: vErr } = await supabase
      .from('quote_versions')
      .select('version_number')
      .eq('quote_id', savedId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (vErr) {
      console.error('send — version lookup error:', vErr)
      flash('שגיאה בשליחה')
      return
    }

    const nextVersion = (lastVersion?.version_number ?? 0) + 1

    // e. Generate client-facing token
    const token = crypto.randomUUID()

    // f. Insert version row
    const { error: insertErr } = await supabase
      .from('quote_versions')
      .insert([{
        quote_id:       savedId,
        version_number: nextVersion,
        content:        dataRef.current,
        form_token:     token,
        sent_at:        new Date().toISOString(),
        is_archived:    false,
      }])

    if (insertErr) {
      console.error('send — insert version error:', insertErr)
      flash('שגיאה בשליחה')
      return
    }

    // g. Flip quote status to 'sent'
    const { error: updateErr } = await supabase
      .from('quotes')
      .update({ status: 'sent', updated_at: new Date().toISOString() })
      .eq('id', savedId)

    if (updateErr) {
      console.error('send — update status error:', updateErr)
      flash('שגיאה בשליחה')
      return
    }

    // i. Success — update local state and surface the link
    setQuoteStatus('sent')
    setLatestToken(token)
    onQuoteUpdated?.(inquiry.id, { id: savedId, status: 'sent' })
    setSendResultModal({ token })
  }

  /* ── Cancel send — revokes the active link and reverts status to draft ── */
  const performCancelSend = async () => {
    setShowCancelConfirm(false)

    try {
      // b. Find the latest version that has an active token
      const { data: latestVer, error: vErr } = await supabase
        .from('quote_versions')
        .select('id')
        .eq('quote_id', quoteId)
        .not('form_token', 'is', null)
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (vErr) throw vErr

      // c. Archive the version and nullify its token
      if (latestVer) {
        const { error: archiveErr } = await supabase
          .from('quote_versions')
          .update({ form_token: null, is_archived: true })
          .eq('id', latestVer.id)
        if (archiveErr) throw archiveErr
      }

      // d. Revert quote status to draft
      const { error: updateErr } = await supabase
        .from('quotes')
        .update({ status: 'draft' })
        .eq('id', quoteId)
      if (updateErr) throw updateErr

      // e. Success
      setQuoteStatus('draft')
      setLatestToken(null)
      onQuoteUpdated?.(inquiry.id, { id: quoteId, status: 'draft' })
      flash('בוטלה השליחה ✓')
    } catch (err) {
      console.error('cancel send error:', err)
      flash('שגיאה בביטול השליחה')
    }
  }

  /* ── Derived read-only flag — true for any non-draft status ── */
  const isReadOnly = quoteStatus !== 'draft'

  /* ── Status label ── */
  const statusLabel = quoteStatus === 'draft' ? 'טיוטה'
    : quoteStatus === 'sent'   ? 'נשלח'
    : 'נחתם'

  /* ── Name for bar title ── */
  const clientName = [inquiry.first_name, inquiry.last_name].filter(Boolean).join(' ')

  if (loading || !data) {
    return (
      <div className="qb-overlay">
        <div style={{ margin: 'auto', paddingTop: 120 }}>
          <span className="qb-loading">טוען...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="qb-overlay">

      {/* ── ACTION BAR ── */}
      <div className="qb-bar">
        {/* Right side — title + status badge */}
        <div className="qb-bar-right">
          <span className="qb-bar-title">הצעת מחיר — {clientName}</span>
          <span className={`qb-status-badge qb-status-${quoteStatus}`}>{statusLabel}</span>
        </div>

        {/* Left side — action buttons */}
        <div className="qb-bar-actions">
          {actionMsg && <span className="qb-action-msg">{actionMsg}</span>}

          {!isReadOnly && (
            <button
              className="qb-btn qb-btn-ghost"
              onClick={handleSaveDraft}
              disabled={saving}
            >
              שמור טיוטה
            </button>
          )}

          <button
            className="qb-btn qb-btn-ghost qp-no-print"
            onClick={handlePreview}
          >
            תצוגה מקדימה
          </button>

          <button
            className="qb-btn qb-btn-ghost qp-no-print"
            onClick={handleGeneratePDF}
            disabled={saving || isPdfGenerating}
          >
            {isPdfGenerating ? 'מייצר PDF...' : 'שמירה כ־PDF'}
          </button>

          {!isReadOnly && (
            <button
              className="qb-btn qb-btn-send qp-no-print"
              onClick={handleSend}
            >
              שלח ללקוח
            </button>
          )}

          {/* Read-only mode extras: link input + copy icon (unified control), cancel-send */}
          {isReadOnly && latestToken && (
            /* Flex wrapper makes icon button stretch to match input height */
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              {/* Copy icon — sits LEFT of input in RTL; borderRight removed to merge with input */}
              <button
                style={{
                  width: 32, flexShrink: 0,
                  background: 'transparent',
                  color: copied ? '#7a9478' : '#f0ede6',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRight: 'none',
                  borderRadius: 0,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.18s',
                }}
                onClick={() => {
                  const link = `${window.location.origin}/quote/${latestToken}`
                  navigator.clipboard.writeText(link).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                title="העתקת לינק"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <input
                readOnly
                value={`${window.location.origin}/quote/${latestToken}`}
                style={{
                  background: 'transparent', color: '#f0ede6',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: 0,
                  padding: '6px 10px', width: 280,
                  fontFamily: 'monospace', fontSize: 11,
                  direction: 'ltr', outline: 'none',
                }}
              />
            </div>
          )}

          {quoteStatus === 'sent' && (
            <button
              className="qb-btn"
              style={{
                background: 'transparent', color: '#d4a3a3',
                border: '1px solid rgba(212,163,163,0.35)',
                borderRadius: 0,
                padding: '7px 14px', fontFamily: "'Heebo', sans-serif",
                fontWeight: 300, fontSize: 12, letterSpacing: '0.08em',
                cursor: 'pointer', transition: 'all 0.18s',
              }}
              onClick={() => setShowCancelConfirm(true)}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(212,163,163,0.6)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(212,163,163,0.35)'}
            >
              ביטול שליחה
            </button>
          )}

          <button
            className="qb-btn qb-btn-close qp-no-print"
            onClick={onClose}
          >
            ✕ סגור
          </button>
        </div>
      </div>

      {/* ── A4 BODY ── */}
      <div className="qb-body">
        <QuotePreview data={data} onChange={handleDataChange} isReadOnly={isReadOnly} />
      </div>

      {/* ── CANCEL SEND CONFIRMATION MODAL ── */}
      {showCancelConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, direction: 'rtl',
        }}>
          <div style={{
            background: '#f7f5f2',
            border: '1px solid rgba(26,26,24,0.13)',
            padding: '32px 36px',
            maxWidth: 580, width: '90vw',
            fontFamily: "'Heebo', sans-serif",
          }}>
            <p style={{
              margin: '0 0 28px', fontSize: 14, fontWeight: 300,
              color: '#1a1a18', whiteSpace: 'nowrap',
            }}>
              ביטול השליחה ימחק את הלינק. הלקוח לא יוכל יותר לפתוח אותו. להמשיך?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
              <button
                style={{
                  background: 'transparent', color: '#1a1a18',
                  border: '1px solid rgba(26,26,24,0.22)',
                  padding: '9px 22px', fontFamily: "'Heebo', sans-serif",
                  fontWeight: 300, fontSize: 12, letterSpacing: '0.12em',
                  cursor: 'pointer', transition: 'all 0.22s',
                }}
                onClick={() => setShowCancelConfirm(false)}
                onMouseEnter={e => e.currentTarget.style.background = '#eeebe6'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                ביטול
              </button>
              <button
                style={{
                  background: '#1a1a18', color: '#f7f5f2',
                  border: '1px solid #1a1a18',
                  padding: '9px 22px', fontFamily: "'Heebo', sans-serif",
                  fontWeight: 300, fontSize: 12, letterSpacing: '0.12em',
                  cursor: 'pointer',
                }}
                onClick={performCancelSend}
              >
                המשך וביטול שליחה
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CONFIRM SEND MODAL ── */}
      {showConfirmModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, direction: 'rtl',
        }}>
          <div style={{
            background: '#f7f5f2',
            border: '1px solid rgba(26,26,24,0.13)',
            padding: '32px 36px',
            maxWidth: 520, width: '90vw',
            fontFamily: "'Heebo', sans-serif",
          }}>
            <p style={{
              margin: '0 0 28px', fontSize: 14, fontWeight: 300,
              color: '#1a1a18', whiteSpace: 'nowrap',
            }}>
              ברגע שתשלחי, לא תוכלי יותר לערוך את ההצעה הזו. להמשיך?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
              <button
                style={{
                  background: 'transparent', color: '#1a1a18',
                  border: '1px solid rgba(26,26,24,0.22)',
                  padding: '9px 22px', fontFamily: "'Heebo', sans-serif",
                  fontWeight: 300, fontSize: 12, letterSpacing: '0.12em',
                  cursor: 'pointer', transition: 'all 0.22s',
                }}
                onClick={() => setShowConfirmModal(false)}
                onMouseEnter={e => e.currentTarget.style.background = '#eeebe6'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                ביטול
              </button>
              <button
                style={{
                  background: '#1a1a18', color: '#f7f5f2',
                  border: '1px solid #1a1a18',
                  padding: '9px 22px', fontFamily: "'Heebo', sans-serif",
                  fontWeight: 300, fontSize: 12, letterSpacing: '0.12em',
                  cursor: 'pointer',
                }}
                onClick={performSend}
              >
                המשך ושלח
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SEND RESULT MODAL ── */}
      {sendResultModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1000, direction: 'rtl',
        }}>
          <div style={{
            background: '#f7f5f2',
            border: '1px solid rgba(26,26,24,0.13)',
            padding: '32px 36px',
            maxWidth: 560, width: '90vw',
            fontFamily: "'Heebo', sans-serif",
          }}>
            {/* Title */}
            <p style={{
              margin: '0 0 6px', fontFamily: "'Playfair Display', serif",
              fontWeight: 400, fontSize: 22, color: '#1a1a18',
            }}>
              הצעת המחיר נשמרה ומוכנה לשליחה
            </p>
            {/* Subtitle */}
            <p style={{
              margin: '0 0 20px', fontSize: 11, fontWeight: 300,
              letterSpacing: '0.14em', color: '#8a8680', textTransform: 'uppercase',
            }}>
              QUOTE LINK
            </p>

            {/* Link row — copy icon + input */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'stretch', marginBottom: 24 }}>
              <button
                style={{
                  width: 38, flexShrink: 0,
                  background: '#7a9478', color: '#ffffff',
                  border: '1px solid #7a9478',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onClick={() => {
                  const link = `${window.location.origin}/quote/${sendResultModal.token}`
                  navigator.clipboard.writeText(link).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  })
                }}
                title="העתקת לינק"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <input
                readOnly
                value={`${window.location.origin}/quote/${sendResultModal.token}`}
                style={{
                  flex: 1, boxSizing: 'border-box',
                  background: '#ffffff', color: '#1a1a18',
                  border: '1px solid rgba(26,26,24,0.18)',
                  padding: '9px 12px',
                  fontFamily: 'monospace', fontSize: 12,
                  direction: 'ltr', outline: 'none',
                }}
              />
            </div>

            {/* Footer — שליחה במייל first (rightmost), סגור last (leftmost) */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-start' }}>
              <button
                style={{
                  background: '#7a9478', color: '#f7f5f2',
                  border: '1px solid #7a9478',
                  padding: '9px 22px', fontFamily: "'Heebo', sans-serif",
                  fontWeight: 300, fontSize: 12, letterSpacing: '0.12em',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}
                onClick={() => {
                  const link = `${window.location.origin}/quote/${sendResultModal.token}`
                  const subject = 'הצעת מחיר — סטודיו בתים'
                  const body = `שלום ${inquiry.first_name},\n\nמצורף קישור להצעת מחיר עבורכם:\n${link}\n\nנשמח לקבל את חתימתכם דרך הקישור.\n\nלכל שאלה אני זמינה.\n\nבברכה,\nעינב שיפמן\nסטודיו בתים`
                  const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(inquiry.email || '')}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
                  window.open(gmailUrl, '_blank')
                }}
              >
                <Send size={14} />
                שליחה במייל
              </button>
              <button
                style={{
                  background: 'transparent', color: '#1a1a18',
                  border: '1px solid rgba(26,26,24,0.22)',
                  padding: '9px 22px', fontFamily: "'Heebo', sans-serif",
                  fontWeight: 300, fontSize: 12, letterSpacing: '0.12em',
                  cursor: 'pointer', transition: 'all 0.22s',
                }}
                onClick={() => { setSendResultModal(null); onClose() }}
                onMouseEnter={e => e.currentTarget.style.background = '#eeebe6'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
