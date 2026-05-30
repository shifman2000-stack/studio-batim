// src/pages/ContractorSpecPrintView.jsx
// Public, standalone route used by Puppeteer to render the contractor-spec
// report as a clean A4 document. No nav, no auth wrapper — just the report.
//
// Mirrors FinishingPrintView's structure exactly.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import ContractorSpecReport from '../components/ContractorSpecReport'

export default function ContractorSpecPrintView() {
  const { projectId } = useParams()

  const [data,  setData]  = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const load = async () => {
      // Single RPC call — SECURITY DEFINER, EXECUTE granted to anon.
      // Bypasses RLS so Puppeteer (unauthenticated) can render the PDF.
      const { data: rpcData, error } = await supabase
        .rpc('get_contractor_spec_for_print', { p_project_id: projectId })

      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData

      if (error || !row) {
        setError(error?.message ?? 'נתוני הפרויקט לא נמצאו')
        return
      }

      setData(row)
    }

    load()
  }, [projectId])

  // Error state
  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: 'Heebo, sans-serif', direction: 'rtl', color: '#c0392b' }}>
        שגיאה בטעינת מפרט לקבלן: {error}
      </div>
    )
  }

  // Loading — return null so Puppeteer's waitForSelector handles timing
  if (!data) return null

  return (
    <div className="contractor-spec-print-mode" data-contractor-spec-ready="true">
      <style>{`
        /* Force A4 paged layout for Puppeteer. Margins kept in sync with ContractorSpecReport.css. */
        @page {
          size: A4 portrait;
          margin: 15mm 12mm;
        }

        /* Liberate html / body / #root so the report can flow across pages.
           index.css locks these to height:100% + overflow:hidden, which clips
           the document to one viewport. This <style> tag is inside the route
           component — it mounts and unmounts with the route, so the rest of
           the app is never affected. */
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
          background: #ffffff !important;
        }

        /* Counter the three global at-media-print rules in the app
           (Hours.css, QuoteBuilder.css, ReportTable.css) that hide every
           element and whitelist only their own containers. None of them
           know about us, so we whitelist ourselves explicitly. Without
           this, Puppeteer print-media emulation hides every element and
           the PDF is blank. */
        @media print {
          .contractor-spec-print-mode,
          .contractor-spec-print-mode * {
            visibility: visible !important;
          }
        }
      `}</style>

      <ContractorSpecReport data={data} />
    </div>
  )
}
