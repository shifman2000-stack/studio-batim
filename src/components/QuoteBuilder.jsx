import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabaseClient'
import QuotePreview, { buildInitialData } from './QuotePreview'
import './QuoteBuilder.css'

export default function QuoteBuilder({ inquiry, onClose, onQuoteUpdated }) {
  const [quoteId,     setQuoteId]     = useState(null)
  const [quoteStatus, setQuoteStatus] = useState('draft')
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [actionMsg,   setActionMsg]   = useState('')

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

  /* ── Save draft ── */
  const handleSaveDraft = async () => {
    // Use ref so we always get the latest edits, even if an onChange fired in the
    // same tick as this handler and the React state hasn't flushed yet.
    const toSave = dataRef.current ?? data
    console.log('saving data:', toSave)
    if (!toSave) return
    setSaving(true)
    try {
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
      } else {
        // First explicit save — create the row now
        const { data: created, error } = await supabase
          .from('quotes')
          .insert([{
            inquiry_id:   inquiry.id,
            quote_number: 1,
            status:       'draft',
            draft_content: toSave,
          }])
          .select()
          .single()
        console.log('save result (insert):', created, error)
        if (!error && created) {
          setQuoteId(created.id)
          onQuoteUpdated?.(inquiry.id, { id: created.id, status: 'draft' })
        } else if (error) {
          throw error
        }
      }
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
          #pdf-btn {
            position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
            background: #1a1a18; color: #f7f5f2;
            border: none; padding: 10px 28px;
            font-family: Heebo, sans-serif; font-size: 14px;
            cursor: pointer; z-index: 9999; border-radius: 4px;
          }
          @media print {
            #pdf-btn { display: none !important; }
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
        <button id="pdf-btn" onclick="window.print()">שמירה כ־PDF</button>
        ${clone.outerHTML}
      </body>
      </html>
    `)
    w.document.close()
  }

  /* ── Export PDF — html2canvas → jsPDF (WeasyPrint-equivalent for browser) ── */
  const handleExportPDF = async () => {
    const pages = Array.from(document.querySelectorAll('.page'))
    if (!pages.length) return
    setSaving(true)
    flash('מייצא PDF…')
    try {
      // Dynamic imports — keep jspdf/html2canvas out of the main bundle
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas'),
      ])

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pdfW = pdf.internal.pageSize.getWidth()   // 210 mm
      const pdfH = pdf.internal.pageSize.getHeight()  // 297 mm

      // Hide edit controls before capture
      const noprint = document.querySelectorAll('.page .qp-no-print, .page button')
      noprint.forEach(el => el.style.visibility = 'hidden')

      // Fix input rendering
      const inputs = document.querySelectorAll('.page input, .page textarea')
      inputs.forEach(el => {
        el.style.border = 'none'
        el.style.outline = 'none'
      })

      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          backgroundColor: '#f7f5f2',
          onclone: (clonedDoc) => {
            clonedDoc.querySelectorAll('button, .qp-no-print').forEach(el => el.remove())
          },
        })
        const imgData = canvas.toDataURL('image/jpeg', 0.95)
        if (i > 0) pdf.addPage()
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH)
      }

      const safeName = [inquiry.first_name, inquiry.last_name]
        .filter(Boolean).join('-') || 'ללקוח'
      pdf.save(`הצעת-מחיר-${safeName}.pdf`)

      // Restore everything
      noprint.forEach(el => el.style.visibility = '')
      inputs.forEach(el => {
        el.style.border = ''
        el.style.outline = ''
      })

      flash('PDF נוצר ✓')
    } catch (err) {
      console.error('PDF export error:', err)
      flash('שגיאה ביצוא PDF')
    } finally {
      setSaving(false)
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
            onClick={handleExportPDF}
            disabled={saving}
          >
            שמירה כ־PDF
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
