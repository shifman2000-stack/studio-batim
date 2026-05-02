// src/pages/QuotePrintSigned.jsx
// Public, standalone route used by finalize-quote.js (Puppeteer) to render
// a signed quote as clean A4 pages WITH signature images.
//
// Key difference from QuotePrintView:
//   QuotePrintView fetches draft_content from quotes (no signatures).
//   This route fetches version content by token (has signatures) and passes
//   editableFields that unlocks the sig-image branch in QuotePreview.
//
// Route: /quote-print-signed/:token

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuotePreview from '../components/QuotePreview'

// Only these two paths are "editable" — which in practice means QuotePreview
// renders the <img> branch instead of the bare label.  All other content
// renders as locked static text.  The Pencil edit icon that would normally
// appear next to the image is hidden via the CSS below.
const SIG_IMAGE_FIELDS = ['sig1.signature', 'sig2.signature']

export default function QuotePrintSigned() {
  const { token } = useParams()
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!token) return
    const load = async () => {
      const { data: result, error } = await supabase.rpc('get_quote_by_token', { p_token: token })
      const ver = Array.isArray(result) && result.length > 0 ? result[0] : null
      if (!error && ver?.content) setData(ver.content)
    }
    load()
  }, [token])

  // Return null until data arrives — Puppeteer's networkidle0 handles timing
  if (!data) return null

  return (
    <div className="print-mode">
      <style>{`
        /* ── A4 paged layout ── */
        @page { size: A4 portrait; margin: 0; }

        /* Liberate root containers (index.css locks them to 100vh + overflow:hidden) */
        html, body, #root {
          height: auto !important;
          min-height: auto !important;
          max-height: none !important;
          overflow: visible !important;
        }
        body, #root { display: block !important; }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: white !important;
        }

        /* Neutralise the data-qb-page fixed-position rule from QuoteBuilder.css */
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

        /* Each .page = one A4 sheet */
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
        .print-mode .qp-pages .page:last-child {
          break-after: auto !important;
          page-break-after: auto !important;
        }

        /* Hide the Pencil / PenLine edit icons inside sig boxes —
           they are interactive in the client view but should not
           appear on the formal signed PDF. */
        .print-mode .sig-box svg { display: none !important; }
      `}</style>

      <QuotePreview
        data={data}
        isReadOnly={true}
        editableFields={SIG_IMAGE_FIELDS}
      />
    </div>
  )
}
