// src/pages/QuotePrintView.jsx
// Public, standalone route used by Puppeteer to render a quote as clean A4 pages.
// No action bar, no modal, no auth wrapper — just the 4 pages, white background.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuotePreview, { buildInitialData } from '../components/QuotePreview'

export default function QuotePrintView() {
  const { quoteId } = useParams()

  const [data,    setData]    = useState(null)
  const [inquiry, setInquiry] = useState(null)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    const load = async () => {
      // 1. Fetch the quote row by id
      const { data: quote, error: qErr } = await supabase
        .from('quotes')
        .select('*')
        .eq('id', quoteId)
        .single()

      if (qErr || !quote) {
        setError(qErr?.message ?? 'הצעת מחיר לא נמצאה')
        return
      }

      // 2. Fetch the related inquiry (needed for buildInitialData defaults)
      const { data: inq, error: iErr } = await supabase
        .from('inquiries')
        .select('*')
        .eq('id', quote.inquiry_id)
        .single()

      if (iErr || !inq) {
        setError(iErr?.message ?? 'פנייה לא נמצאה')
        return
      }

      // 3. Merge saved draft_content onto current defaults — identical to QuoteBuilder's logic
      const base   = buildInitialData(inq)
      const merged = quote.draft_content
        ? { ...base, ...quote.draft_content }
        : base

      setInquiry(inq)
      setData(merged)
    }

    load()
  }, [quoteId])

  // Error state
  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: 'Heebo, sans-serif', direction: 'rtl', color: '#c0392b' }}>
        שגיאה בטעינת הצעת המחיר: {error}
      </div>
    )
  }

  // Loading — return null so Puppeteer's networkidle0 wait handles timing
  if (!data || !inquiry) return null

  return (
    /*
      .print-mode is the scope anchor for all A4/page-break rules below.
      It exists ONLY in this route — QuotePreview rendered inside the
      QuoteBuilder modal has no .print-mode ancestor, so none of the
      page-break CSS leaks into the modal view.
    */
    <div className="print-mode">
      <style>{`
        /* ── Override index.css body/html/root so all 4 pages stack freely ── */
        html {
          height: auto !important;
        }
        body {
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
          display: block !important;
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
          direction: rtl !important;
        }
        #root {
          display: block !important;
          overflow: visible !important;
          height: auto !important;
          min-height: 0 !important;
          flex: none !important;
        }

        /* ── A4 page rules (always-on, NOT @media print) ──────────────────
           Puppeteer renders in screen media by default, so @media print
           rules in QuotePreview.css never fire.  These rules live outside
           any media query so they apply whenever this route is loaded.
           Scoped to .print-mode so they NEVER affect the QuoteBuilder modal.
        ────────────────────────────────────────────────────────────────── */
        @page {
          size: A4 portrait;
          margin: 0;
        }

        .print-mode .qp-pages {
          padding: 0;
          background: white;
        }

        .print-mode .qp-pages .page {
          width: 210mm;
          height: 297mm;
          margin: 0;
          box-shadow: none;
          border-radius: 0;
          overflow: hidden;
          page-break-after: always;
          break-after: page;
          page-break-inside: avoid;
          break-inside: avoid;
        }

        .print-mode .qp-pages .page:last-child {
          page-break-after: auto;
          break-after: auto;
        }
      `}</style>

      {/*
        isReadOnly={true} suppresses all edit controls inside QuotePreview:
          - qp-row-remove / qp-row-add buttons
          - qp-col-hide-btn
          - qp-no-print table columns
        The QuoteBuilder action bar (שמירה כ-PDF / שלח ללקוח / סגור) lives
        entirely in QuoteBuilder.jsx and is therefore absent here automatically.
      */}
      <QuotePreview
        inquiry={inquiry}
        data={data}
        isReadOnly={true}
      />
    </div>
  )
}
