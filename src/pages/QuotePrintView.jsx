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
    <>
      {/*
        index.css sets body/html to height:100% + overflow:hidden and #root to
        display:flex + overflow:hidden — this clips pages 2-4 out of view.
        Override all of it here so all 4 A4 pages stack and scroll freely.
      */}
      <style>{`
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
        /* Breathing room between pages */
        .qp-pages {
          padding: 36px 0;
          background: white;
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
    </>
  )
}
