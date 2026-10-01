// src/spike/SpikeQuoteFlow.jsx — SPIKE, THROWAWAY. Branch spike/quote-flow-print.
//
// Route: /spike/quote-flow?v=v1..v5&hf=puppeteer|css
//
// Renders an ordered list of TYPED BLOCKS as one flowing document. There is
// no .page wrapper anywhere in here — that is the whole experiment. Each
// block type has exactly one renderer, which is what a real block-based
// quote would look like: the document's structure lives in data, the design
// lives in components and CSS, and neither can drift per quote.
//
// Nothing in src/components/QuotePreview*, src/pages/QuotePrint*, or the two
// production api/ functions is imported or touched.

import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getBlocks, VARIANT_LABEL } from './spikeBlocks'
import './spikeQuote.css'

const FOOT_CONTACT = 'סטודיו בתים · קיבוץ נגבה · 052-9593927 · einav.studiob@gmail.com'

/* ── Block renderers, one per type ───────────────────────────────────── */

const DocHead = ({ b }) => (
  <header className="sq-dochead">
    <div>
      <div className="sq-dochead-eyebrow">{b.eyebrow}</div>
      <div className="sq-dochead-title">
        {b.title} <small>| {b.sub}</small>
      </div>
    </div>
    <div className="sq-dochead-date">תאריך {b.date}</div>
  </header>
)

const PartyCard = ({ p }) => (
  <div className="sq-party">
    <div className="sq-party-title">{p.title}</div>
    {p.rows.map(([k, v]) => (
      <div className="sq-party-row" key={k}>
        <span className="sq-party-k">{k}</span>
        <span className="sq-party-v">{v}</span>
      </div>
    ))}
  </div>
)

const Parties = ({ b }) => (
  <section className="sq-parties">
    <PartyCard p={b.client} />
    <PartyCard p={b.planner} />
  </section>
)

/* The number is NOT passed in — ::before reads a CSS counter, so chapters
   renumber themselves when one is added, removed or moved. */
const Chapter = ({ b }) => (
  <h2 className="sq-chapter"><span className="sq-chapter-title">{b.title}</span></h2>
)

const Text = ({ b }) => <p className="sq-text">{b.text}</p>

const Fee = ({ b }) => (
  <div className="sq-fee">
    <span className="sq-fee-label">{b.label}</span>
    <span>
      <span className="sq-fee-amount">{b.amount}</span>
      <span className="sq-fee-note">{b.note}</span>
    </span>
  </div>
)

const Payments = ({ b }) => (
  <table className="sq-table">
    <thead>
      <tr>
        <th className="sq-col-n">{b.head[0]}</th>
        <th className="sq-col-when">{b.head[1]}</th>
        <th className="sq-col-what">{b.head[2]}</th>
        <th>{b.head[3]}</th>
        <th className="sq-col-pct">{b.head[4]}</th>
      </tr>
    </thead>
    <tbody>
      {b.rows.map((r, i) => (
        <tr key={i}>
          <td className="sq-col-n">{r[0]}</td>
          <td className="sq-col-when">{r[1]}</td>
          <td className="sq-col-what">{r[2]}</td>
          <td>{r[3]}</td>
          <td className="sq-col-pct">{r[4]}</td>
        </tr>
      ))}
    </tbody>
  </table>
)

const Stages = ({ b }) => (
  <>
    {b.stages.map((s, i) => (
      <section className="sq-stage" key={i}>
        <div className="sq-stage-head">
          <span className="sq-stage-num">שלב {String(i + 1).padStart(2, '0')}</span>
          <span className="sq-stage-title">{s.title}</span>
        </div>
        <div className="sq-stage-row">
          <span className="sq-stage-k">התהליך</span>
          <p className="sq-stage-v">{s.process}</p>
        </div>
        <div className="sq-stage-row">
          <span className="sq-stage-k">התוצר</span>
          <p className="sq-stage-v">{s.output}</p>
        </div>
      </section>
    ))}
  </>
)

const Optional = ({ b }) => (
  <section className="sq-optional">
    <div className="sq-optional-label">{b.label}</div>
    <div className="sq-optional-title">{b.title}</div>
    <p className="sq-text" style={{ marginBottom: 0 }}>{b.text}</p>
  </section>
)

const TermsGroup = ({ g }) => (
  <section className="sq-terms-group">
    <div className="sq-terms-title">{g.title}</div>
    {g.items.map(([lead, body], i) => (
      <p className="sq-term" key={i}>
        {lead && <b>{lead} </b>}{body}
      </p>
    ))}
  </section>
)

const Signatures = ({ b }) => (
  <>
    <h3 className="sq-sign-title">{b.title}</h3>
    <p className="sq-sign-intro">{b.intro}</p>
    <table className="sq-sign-table">
      <thead>
        <tr>{b.head.map(h => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {Array.from({ length: b.rows }).map((_, i) => (
          <tr key={i}>{b.head.map(h => <td key={h} />)}</tr>
        ))}
      </tbody>
    </table>
    <div className="sq-closing">
      <div className="sq-closing-l1">{b.closing[0]}</div>
      <div className="sq-closing-l2">{b.closing[1]}</div>
      <div className="sq-closing-l3">{b.closing[2]}</div>
    </div>
  </>
)

const RENDERERS = {
  docHead: DocHead, parties: Parties, chapter: Chapter, text: Text,
  fee: Fee, payments: Payments, stages: Stages, optional: Optional,
}

export default function SpikeQuoteFlow() {
  const [params] = useSearchParams()
  const variant = params.get('v') || 'v1'
  const hf      = params.get('hf') || 'puppeteer'   // which header/footer approach
  /* CONTROL. raw=1 switches off every pagination rule this spike is
     testing — break-after on headings, break-inside on rows and groups,
     orphans/widows, and the .sq-tail binding. Generating the same variant
     with and without it is what separates "the rules worked" from "the
     content happened to land well". */
  const raw     = params.get('raw') === '1'
  const padQ    = params.get('pad')
  const blocks  = getBlocks(variant, padQ ? Number(padQ) : null)

  /* Signal readiness to Puppeteer only once the self-hosted fonts are in.
     With font-display:block the text is invisible until then, so a PDF taken
     too early would be blank rather than wrong — this attribute is what the
     API waits on instead of a fixed sleep. */
  useEffect(() => {
    let cancelled = false
    document.fonts.ready.then(() => {
      if (!cancelled) document.documentElement.setAttribute('data-spike-ready', '1')
    })
    return () => { cancelled = true }
  }, [variant, hf])

  /* The terms block and the signature block are rendered inside ONE
     .sq-tail wrapper, which is how V5 is solved: they can only move
     together, so the signatures can never start alone on a fresh page. */
  const termsIdx = blocks.findIndex(b => b.type === 'terms')
  const signIdx  = blocks.findIndex(b => b.type === 'signatures')
  const terms    = blocks[termsIdx]
  const sign     = blocks[signIdx]

  return (
    <div className={'sq-doc' + (hf === 'css' ? ' sq-mode-css' : '') + (raw ? ' sq-raw' : '')} dir="rtl">
      <style>{`
        /* THE SECOND LANDMINE. @page cannot be scoped by a selector, and the
           bundle carries four of them — from QuotePreview.css,
           FinishingReport.css and QuoteBuilder.css as well as this spike's.
           The last one in the bundle wins for every route, which here was
           QuoteBuilder.css's zero-margin one: the body ignored its
           24mm margins, ran to the paper edge and printed straight over the
           Puppeteer header. Re-declaring @page in THIS inline style puts it
           after the bundle in document order, so it wins. The three report
           routes do the same thing for the same reason. */
        @page { size: A4 portrait; margin: 24mm 16mm 20mm; }

        /* index.css pins html/body/#root to height:100% + overflow:hidden,
           which clips the document to one viewport and hides every page
           after the first from Puppeteer. Same release the three report
           routes already perform. */
        html, body, #root {
          height: auto !important; min-height: auto !important;
          max-height: none !important; overflow: visible !important;
        }
        body, #root { display: block !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }

        /* THE LANDMINE. Three stylesheets in this app ship a global
           @media print { * { visibility: hidden } } and then whitelist only
           their own container — Hours.css, QuoteBuilder.css and
           ReportTable.css. They are all in the one CSS bundle, so they
           apply to EVERY route once Puppeteer switches to print media.
           Without the counter-rule below the body of this document comes
           out completely blank: three A4 pages carrying nothing but the
           Puppeteer header and footer, which are immune because they render
           in their own isolated context. The three report routes already
           carry the identical workaround. */
        @media print {
          .sq-doc, .sq-doc * { visibility: visible !important; }
        }
      `}</style>

      {/* Approach (b) — repeating elements. Hidden unless hf=css. */}
      <div className="sq-fixed-head">סטודיו בתים</div>
      <div className="sq-fixed-foot">{FOOT_CONTACT}</div>

      {blocks.map((b, i) => {
        /* The terms block renders all its groups EXCEPT the last one, which
           belongs to the tail below. */
        if (i === termsIdx) {
          return (
            <div key="terms">
              {terms.groups.slice(0, -1).map((g, j) => <TermsGroup g={g} key={j} />)}
            </div>
          )
        }
        /* Tail: the last terms group + approval + signatures, in one
           break-inside: avoid wrapper. That is V5's answer — the signatures
           cannot start alone on a fresh page because they are bound to the
           text above them. */
        if (i === signIdx) {
          return (
            <div className="sq-tail" key="tail">
              <TermsGroup g={terms.groups[terms.groups.length - 1]} />
              <Signatures b={sign} />
            </div>
          )
        }
        const R = RENDERERS[b.type]
        return R ? <R b={b} key={i} /> : null
      })}

      <noscript>{VARIANT_LABEL[variant]}</noscript>
    </div>
  )
}
