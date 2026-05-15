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
      // Single RPC call — SECURITY DEFINER, EXECUTE granted to anon.
      // Bypasses RLS on quotes + inquiries so Puppeteer (unauthenticated) can render the PDF.
      console.log('[QuotePrintView] fetching quote', quoteId)
      const { data: rpcData, error } = await supabase
        .rpc('get_quote_for_print', { p_quote_id: quoteId })

      console.log('[QuotePrintView] rpc result:', { data: rpcData, error })
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData

      if (error || !row) {
        setError(error?.message ?? 'הצעת מחיר לא נמצאה')
        return
      }

      const quote = row.quote
      const inq   = row.inquiry

      console.log('[QuotePrintView] rendering with quote:', !!quote, 'inquiry:', !!inq)

      if (!quote || !inq) {
        setError('הצעת מחיר לא נמצאה')
        return
      }

      // Merge saved draft_content onto current defaults — identical to QuoteBuilder's logic
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
        /* Force A4 paged layout for Puppeteer */
        @page {
          size: A4 portrait;
          margin: 0;
        }

        /* Liberate html / body / #root so all 4 pages can flow.
           index.css locks these to height:100% + overflow:hidden, which clips
           the document to one viewport and prevents Puppeteer from seeing pages 2-4.
           This <style> tag is inside QuotePrintView JSX — it mounts and unmounts
           with the route, so the rest of the app is never affected. */
        html, body, #root {
          height: auto !important;
          min-height: auto !important;
          max-height: none !important;
          overflow: visible !important;
        }

        body, #root {
          display: block !important;
        }

        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        }

        /* Neutralize the QuoteBuilder.css print rule that pins data-qb-page to fixed */
        .print-mode [data-qb-page],
        .print-mode .qp-pages {
          position: static !important;
          top: auto !important;
          left: auto !important;
          right: auto !important;
          width: auto !important;
          height: auto !important;
          overflow: visible !important;
          display: block !important;
          transform: none !important;
        }

        /* Each .page is a full A4 sheet, breaks after itself */
        .print-mode .qp-pages .page {
          width: 210mm !important;
          margin: 0 !important;
          box-shadow: none !important;
          border-radius: 0 !important;
          overflow: hidden !important;
          position: relative !important;
          break-after: page !important;
          page-break-after: always !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
          box-sizing: border-box !important;
        }

        /* Last page does not need a break after */
        .print-mode .qp-pages .page:last-child {
          break-after: auto !important;
          page-break-after: auto !important;
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
