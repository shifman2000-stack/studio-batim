import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import QuotePreview, { buildInitialData } from './QuotePreview'
import './QuoteBuilder.css'

export default function QuoteBuilder({ inquiry, onClose, onQuoteUpdated }) {
  const [quoteId,     setQuoteId]     = useState(null)
  const [quoteStatus, setQuoteStatus] = useState('draft')
  const [data,        setData]        = useState(null)
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [isPdfGenerating, setIsPdfGenerating] = useState(false)
  const [actionMsg,      setActionMsg]      = useState('')

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

  /* ── Send — placeholder ── */
  const handleSend = () => alert('בקרוב')

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

          <button
            className="qb-btn qb-btn-ghost"
            onClick={handleSaveDraft}
            disabled={saving}
          >
            שמור טיוטה
          </button>

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

          <button
            className="qb-btn qb-btn-send qp-no-print"
            onClick={handleSend}
          >
            שלח ללקוח
          </button>

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
        <QuotePreview data={data} onChange={handleDataChange} />
      </div>

    </div>
  )
}
