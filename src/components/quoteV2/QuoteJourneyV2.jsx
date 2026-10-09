import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock, Banknote, CalendarDays } from 'lucide-react'
import './QuoteJourneyV2.css'
import { resolveText, isFilled } from '../../lib/quoteV2/resolve'
import { computePayments } from '../../lib/quoteV2/payments'
import { varsOf, clientCountOf } from '../../lib/quoteV2/content'
import Money from './Money'
import SignCard from './SignCard'

/* ═══════════════════════════════════════════════════════════════════════
   QuoteJourneyV2 — הפן השיווקי של הצעת מחיר v2
   מקור העיצוב: docs/mockups/quote-journey.html
   מודל הנתונים: docs/quote-v2-design.md — פרקים A.2, A.6, A.7

   מה הרכיב הזה כן: מרנדר content_v2 כחוויית גלילה.
   מה הוא לא: לא שומר, לא קורא ל-API, ולא נוגע בשום הצעה קיימת.

   סדר הפן השיווקי קבוע כאן בקוד ולא נגזר מסדר המערך —
   פתיחה → שלבים → שכר טרחה → ומה אם → רוצים עוד → PDF → חתימה.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── פריסת שש שכבות הציור על N שלבים ────────────────────────────────
   docs/quote-v2-design.md, B.4. הנוסחה מונוטונית ומבטיחה שלב 1 → שכבה 1
   ושלב N → שכבה 6 לכל N ≥ 2. פיצול השכבות לתתי-צעדים (a/b) הוא עבודת
   עיצוב שלא בוצעה עדיין, ולכן ב-N > 6 יהיו שלבים שאינם משנים את הציור. */
function layerForStage(index, total) {
  if (total <= 1) return 6
  return 1 + Math.round((index * 5) / (total - 1))
}

/* ── אייקוני צ׳יפי השלב ────────────────────────────────────────────
   שלושתם מ-lucide-react, שכבר בפרויקט ומשמש אותו במקומות אחרים —
   כך "אותה משפחה" מובטח מעצם המקור ולא מהקפדה ידנית. התכונות
   המשותפות יושבות בקבוע אחד: אותו גודל, אותו עובי קו, ו-lucide
   מצייר stroke=currentColor, כלומר הם לוקחים את צבע הצ׳יפ.

   SVG ולא אמוג׳י: ⏱ מרונדר בגופן המערכת, משנה גודל וצבע בין
   מכשירים, ובאנדרואיד יוצא צבעוני ושובר את הטיפוגרפיה האחידה. */
const CHIP_ICON = { size: 13, strokeWidth: 1.75, className: 'qj-chip-icon', 'aria-hidden': true }

/** מפריד את המילה האחרונה כדי להדגיש אותה, כמו "לכם <b>בית.</b>" במוקאפ. */
function Greeting({ text }) {
  const lines = text.split('\n')
  const last = lines[lines.length - 1]
  const cut = last.lastIndexOf(' ')
  if (cut === -1) return <>{text}</>
  return (
    <>
      {lines.slice(0, -1).join('\n')}
      {lines.length > 1 ? '\n' : ''}
      {last.slice(0, cut + 1)}
      <b>{last.slice(cut + 1)}</b>
    </>
  )
}

/**
 * @param {object} content      content_v2
 * @param {object} [vars]       ברירת מחדל: content.vars (הערכים הקפואים)
 * @param {number} [clientCount] ברירת מחדל: content.clients.length
 * @param {object} [client]     מצב החתימה האמיתי. בלעדיו זו תצוגה בלבד:
 *                              הטוגלים מקומיים והכפתורים מושבתים (מעבדה).
 */
export default function QuoteJourneyV2({ content, vars, clientCount, client }) {
  const scrollRef = useRef(null)
  const feeRef = useRef(null)
  const feeRan = useRef(false)
  const chapterRefs = useRef([])

  const [stage, setStage] = useState(1)
  const [feeSeen, setFeeSeen] = useState(false)
  const [feeShown, setFeeShown] = useState(0)
  /* טוגלים מקומיים — משמשים רק כשאין client (מצב מעבדה). */
  const [localExtras, setLocalExtras] = useState({})

  /* הערכים הקפואים שבתוך ה-content הם מקור האמת. prop מפורש גובר
     עליהם רק במעבדה, שבה מחליפים לקוחות ושטחים בלי לגעת בנתונים. */
  const v = vars ?? varsOf(content)
  const nClients = clientCount ?? clientCountOf(content)
  const live = !!client

  const t = (raw) => resolveText(raw, v, nClients)

  const selectedExtras = live
    ? (client.response?.extrasSelected ?? [])
    : Object.keys(localExtras).filter(k => localExtras[k])

  const toggleExtra = (key) => {
    if (!live) { setLocalExtras(p => ({ ...p, [key]: !p[key] })); return }
    client.setResponse(prev => {
      const cur = prev?.extrasSelected ?? []
      return {
        ...prev,
        extrasSelected: cur.includes(key) ? cur.filter(x => x !== key) : [...cur, key],
      }
    })
  }

  /* ── הסעיפים, לפי טיפוס. כל טיפוס מופיע פעם אחת (A.2). ── */
  const S = useMemo(() => {
    const byType = {}
    for (const s of content?.sections ?? []) {
      if (s?.enabled === false) continue
      byType[s.type] = s
    }
    return byType
  }, [content])

  const stages = useMemo(() => S.stages?.items ?? [], [S])
  const terms = useMemo(
    () => (S.terms?.groups ?? []).flatMap(g => g.items ?? []),
    [S]
  )
  const extras = useMemo(() => S.extras?.items ?? [], [S])
  const fee = Number(v.fee) || 0
  const total = stages.length
  /* אותה גזירה בדיוק כמו בפן הכתוב. קודם זה היה Math.round מקומי
     כאן ו-floor+השלמה שם — זהה עבור התבנית הנוכחית, אבל בשכר טרחה
     שלא מתחלק יפה הצ׳יפ בטלפון וה-PDF היו מציגים סכומים שונים. */
  const amounts = useMemo(
    () => computePayments(fee, stages.map(s => s.pct)),
    [fee, stages]
  )

  /* ── ההתקדמות: איזה פרק נמצא באמצע המסך ──────────────────────────
     root הוא מכל הגלילה שלנו ולא ה-viewport, כדי שהמסע יעבוד גם
     כשהוא מוטמע בתוך מסגרת תצוגה מקדימה ולא תופס את כל החלון. */
  useEffect(() => {
    const root = scrollRef.current
    if (!root || total === 0) return
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const n = Number(e.target.dataset.s)
            if (n) setStage(n)
          }
        }
      },
      { root, rootMargin: '-45% 0px -45% 0px' }
    )
    chapterRefs.current.filter(Boolean).forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [total])

  /* ── ספירת שכר הטרחה, פעם אחת ─────────────────────────────────────
     השמירה על "רץ כבר" היא ב-ref ולא ב-state, ו-feeSeen **אינו**
     בתלויות: אילו היה, setFeeSeen היה מריץ את האפקט מחדש, הניקוי
     היה מבטל את ה-requestAnimationFrame, והמספר היה נתקע על 0. */
  useEffect(() => {
    const root = scrollRef.current
    const el = feeRef.current
    if (!root || !el || fee <= 0) return
    let raf = 0
    const io = new IntersectionObserver(
      entries => {
        if (!entries[0].isIntersecting || feeRan.current) return
        feeRan.current = true
        setFeeSeen(true)
        setStage(total)
        const t0 = performance.now()
        const T = 1400
        const tick = (now) => {
          const k = Math.min(1, (now - t0) / T)
          const eased = 1 - Math.pow(1 - k, 3)
          setFeeShown(Math.round(fee * eased))
          if (k < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      },
      { root, threshold: 0.4 }
    )
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [fee, total])

  /* ── הפונטים. נטענים רק כל עוד המסע על המסך, ולא מ-index.html,
        כדי שלא לגעת בשאר האפליקציה. ⚠️ לפרודקשן זה יעבור ל-woff2
        מקומי (docs/quote-v2-design.md, B.2). ── */
  useEffect(() => {
    const id = 'qj-fonts'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700&family=Frank+Ruhl+Libre:wght@300;400;500;700&display=swap'
    document.head.appendChild(link)
    return () => { document.getElementById(id)?.remove() }
  }, [])

  const activeLayer = layerForStage(Math.max(0, stage - 1), total)
  const lit = activeLayer >= 6
  const layerOn = n => (n <= activeLayer ? ' qj-on' : '')

  const houseLabel = isFilled(v.houseArea) ? `בית · כ-${v.houseArea} מ״ר` : null
  const plotLabel = isFilled(v.plotArea) ? `מגרש · כ-${v.plotArea} מ״ר` : null

  if (!content) return null

  return (
    <div className="qj-root" ref={scrollRef} dir="rtl" lang="he">

      {/* ── סרגל עליון ── */}
      <div className="qj-bar">
        <div className="qj-lg">סטודיו בתים<small>BY EINAV SHIFMAN</small></div>
        <div className="qj-prog">
          {stages.map((_, i) => (
            <i key={i} className={i < stage ? 'qj-on' : undefined} />
          ))}
        </div>
      </div>

      {/* ── פתיחה ── */}
      {S.opening && (
        <section className="qj-hero">
          {isFilled(content?.meta?.date) && (
            <div className="qj-to">הצעה אישית · {content.meta.date}</div>
          )}
          <h1 className="qj-serif"><Greeting text={t(S.opening.greeting)} /></h1>
          <p>{t(S.opening.intro)}</p>
          <div className="qj-cue"><span />{nClients > 1 ? 'גללו כדי לבנות' : 'גלול כדי לבנות'}</div>
          <div className="qj-groundline" />
        </section>
      )}

      {/* ── הסיפור: הציור הדבוק + הפרקים ── */}
      {total > 0 && (
        <main className="qj-story">
          <div className="qj-stick">
            <div className={'qj-cap' + (lit ? ' qj-on' : '')}>הבית עומד</div>

            <svg
              className={'qj-house' + (lit ? ' qj-lit' : '')}
              viewBox="0 0 420 320"
              role="img"
              aria-label="הבית נבנה לפי השלבים"
            >
              {/* 0 — הקרקע, תמיד */}
              <path className="qj-ln" d="M6 262 H414" />

              {/* תוויות השטח — HTML בתוך foreignObject, צמוד מתחת לקו
                  הקרקע (y=262). foreignObject ולא מיקום absolute מעל
                  ה-SVG, כי ה-SVG מרונדר ב-xMidYMid meet: הוא ממורכז
                  בתוך הקופסה שלו ואין דרך אמינה לחשב מבחוץ איפה הקו
                  נמצא בפיקסלים. בתוך ה-viewBox זה פשוט y=266.
                  HTML ולא <text>, כי עברית מרווחת ב-SVG מתהפכת ב-WebKit. */}
              {(houseLabel || plotLabel) && (
                <foreignObject x="10" y="266" width="400" height="20">
                  <div xmlns="http://www.w3.org/1999/xhtml" className="qj-dims">
                    {houseLabel && <span className={activeLayer >= 3 ? 'qj-on' : undefined}>{houseLabel}</span>}
                    {plotLabel && <span className={activeLayer >= 1 ? 'qj-on' : undefined}>{plotLabel}</span>}
                  </div>
                </foreignObject>
              )}

              {/* 1 — מגרש, קווי בניין, סקיצה */}
              <g className={'qj-lay' + layerOn(1)}>
                <path className="qj-ln qj-d qj-thin" pathLength="1000" d="M34 262 V232 M386 262 V232" strokeDasharray="4 4" />
                <path
                  className="qj-ln qj-d qj-tr"
                  pathLength="1000"
                  d="M112 262 V176 L210 122 L308 176 V262"
                  style={{ strokeDasharray: '6 6', opacity: activeLayer > 1 ? 0.25 : 1 }}
                />
                <path className="qj-ln qj-thin" d="M58 262 l6 -10 l6 10 M350 262 l6 -10 l6 10" />
              </g>

              {/* 2 — המסה */}
              <g className={'qj-lay' + layerOn(2)}>
                <path className="qj-ln qj-d" pathLength="1000" d="M108 262 V192 H316 V262" />
                <path className="qj-ln qj-d" pathLength="1000" d="M98 192 H326" />
                <path className="qj-ln qj-d" pathLength="1000" d="M150 192 V128 H306 V192" />
                <path className="qj-ln qj-d" pathLength="1000" d="M138 128 H318" />
                <path className="qj-ln qj-d qj-thin" pathLength="1000" d="M240 128 V112 H288 V128" />
              </g>

              {/* 3 — מידות */}
              <g className={'qj-lay' + layerOn(3)}>
                <path className="qj-ln qj-d qj-thin" pathLength="1000" d="M344 128 V262 M338 128 H350 M338 262 H350" />
                <text className="qj-dim" x="356" y="198">7.20+</text>
                <path className="qj-ln qj-d qj-thin" pathLength="1000" d="M108 296 H316 M108 290 V302 M316 290 V302" />
                <text className="qj-dim" x="212" y="314" textAnchor="middle">20.00</text>
              </g>

              {/* 4 — חותמת ההיתר. הטקסט הוא HTML בתוך foreignObject
                   ולא <text>, כדי לא להסתכן בהיפוך עברית מרווחת ב-WebKit. */}
              <g className={'qj-lay' + layerOn(4)}>
                <g className="qj-stamp">
                  <circle cx="72" cy="70" r="36" fill="none" stroke="#d9774a" strokeWidth="2" />
                  <circle cx="72" cy="70" r="29" fill="none" stroke="#d9774a" strokeWidth=".8" />
                  <foreignObject x="36" y="52" width="72" height="40">
                    <div xmlns="http://www.w3.org/1999/xhtml" className="qj-stamp-txt">
                      <div className="qj-s1">היתר</div>
                      <div className="qj-s2">מאושר</div>
                    </div>
                  </foreignObject>
                </g>
              </g>

              {/* 5 — חלונות, דלתות, פרטים */}
              <g className={'qj-lay' + layerOn(5)}>
                <rect className="qj-win" x="128" y="212" width="36" height="30" />
                <rect className="qj-win" x="256" y="212" width="40" height="30" />
                <rect className="qj-win" x="168" y="146" width="112" height="22" />
                <path
                  className="qj-ln qj-d qj-thin"
                  pathLength="1000"
                  d="M128 212 h36 v30 h-36 z M146 212 v30 M256 212 h40 v30 h-40 z M276 212 v30 M168 146 h112 v22 h-112 z M196 146 v22 M224 146 v22 M252 146 v22"
                />
                <path className="qj-ln qj-d" pathLength="1000" d="M196 262 V206 H226 V262" />
                <path className="qj-ln qj-d qj-thin" pathLength="1000" d="M108 222 l18 -18 M108 240 l36 -36 M298 262 l18 -18 M306 192 l10 -10" />
              </g>

              {/* 6 — בריכה, עץ, אור */}
              <g className={'qj-lay' + layerOn(6)}>
                <ellipse className="qj-halo" cx="146" cy="227" rx="34" ry="24" fill="#f4b860" filter="url(#qj-bl)" />
                <ellipse className="qj-halo" cx="224" cy="157" rx="70" ry="22" fill="#f4b860" filter="url(#qj-bl)" />
                <path className="qj-ln qj-d" pathLength="1000" d="M330 262 v9 h62 v-9" />
                <path d="M332 264 h58 v5 h-58 z" fill="#5f8f99" opacity=".8" />
                <path className="qj-ln qj-d" pathLength="1000" d="M62 262 V214" />
                <circle className="qj-ln qj-d" pathLength="1000" cx="62" cy="200" r="22" />
                <circle className="qj-ln qj-d qj-thin" pathLength="1000" cx="48" cy="212" r="12" />
              </g>

              <defs><filter id="qj-bl"><feGaussianBlur stdDeviation="9" /></filter></defs>
            </svg>
          </div>

          <div className="qj-chapters">
            {stages.map((st, i) => (
              <section
                key={st.id ?? i}
                className="qj-chap"
                data-s={i + 1}
                ref={el => { chapterRefs.current[i] = el }}
              >
                <div className="qj-num">
                  <b>{String(i + 1).padStart(2, '0')}</b>
                  מתוך {String(total).padStart(2, '0')}
                </div>
                <h2>{t(st.storyTitle) || t(st.formalName)}</h2>
                <p>{t(st.storyBody) || t(st.process)}</p>
                {isFilled(st.storyDeliverable) && (
                  <div className="qj-got">
                    <small>{nClients > 1 ? 'מה תקבלו' : 'מה תקבל'}</small>
                    <div>{t(st.storyDeliverable)}</div>
                  </div>
                )}
                <div className="qj-facts">
                  {isFilled(st.duration) && (
                    <span><Clock {...CHIP_ICON} />{t(st.duration).split('\n')[0]}</span>
                  )}
                  {st.pct > 0 && (
                    <span>
                      <Banknote {...CHIP_ICON} />
                      <span>
                        תשלום <b>{st.pct}%</b>
                        {/* "+ מע״מ" נצמד לסכום ולכן מופיע רק כשיש סכום —
                            "תשלום 20% + מע״מ" בלי מספר קורא כאילו המע״מ
                            מתווסף לאחוז. */}
                        {fee > 0 && <> · <Money value={amounts[i]} /> + מע״מ</>}
                      </span>
                    </span>
                  )}
                  {isFilled(st.trigger) && (
                    <span><CalendarDays {...CHIP_ICON} />{t(st.trigger)}</span>
                  )}
                </div>
              </section>
            ))}
          </div>
        </main>
      )}

      {/* ── שכר טרחה ── */}
      {S.fee && (
        <section className={'qj-fee' + (feeSeen ? ' qj-seen' : '')} ref={feeRef}>
          <div className="qj-q">{t(S.fee.question)}</div>
          <div className="qj-amt qj-serif">
            <Money value={feeShown} />
          </div>
          <div className="qj-vat">{t(S.fee.note)}</div>

          {total > 0 && (
            <>
              <div className="qj-segs">
                {stages.map((st, i) => (
                  <div key={st.id ?? i} style={{ flex: st.pct || 1 }}>
                    <span>{st.pct >= 10 ? `${st.pct}%` : ''}</span>
                  </div>
                ))}
              </div>
              <div className="qj-segl">
                {stages.map((st, i) => (
                  <div key={st.id ?? i} style={{ flex: st.pct || 1 }}>
                    <b>{i + 1}</b>
                    {/* shortLabel — השם הקצר של השלב, הצד השיווקי.
                        ריק → המספר בלבד. השם הרשמי אינו בשימוש כאן:
                        הוא ארוך מכדי להיכנס מתחת לפס. */}
                    {isFilled(st.shortLabel) && (
                      <span className="qj-seglabel">{t(st.shortLabel)}</span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── ומה אם…? ── */}
      {S.terms && terms.length > 0 && (
        <section className="qj-whatif">
          <h2 className="qj-serif">{t(S.terms.title)}</h2>
          <p className="qj-sub">{t(S.terms.subtitle)}</p>
          {terms.map((item, i) => (
            <details className="qj-qa" key={item.id ?? i}>
              <summary>{t(item.question)}</summary>
              {/* החלטה 24: יש תשובה שיווקית → מציגים אותה; ריק → הנוסח המחייב. */}
              <p>{isFilled(item.marketingAnswer) ? t(item.marketingAnswer) : t(item.body)}</p>
            </details>
          ))}
        </section>
      )}

      {/* ── רוצים עוד? ── */}
      {S.extras && extras.length > 0 && (
        <section className="qj-extras">
          <h2 className="qj-serif">{t(S.extras.title)}</h2>
          <p className="qj-sub">{t(S.extras.subtitle)}</p>
          {extras.map((ex, i) => {
            const key = ex.id ?? String(i)
            const on = selectedExtras.includes(key)
            return (
              <button
                type="button"
                key={key}
                className={'qj-extra' + (on ? ' qj-on' : '')}
                aria-pressed={on}
                disabled={live && client.submitted}
                onClick={() => toggleExtra(key)}
              >
                <div className="qj-t">
                  <b>{t(ex.title)}</b>
                  <span>{t(ex.sub)}</span>
                </div>
                <div className="qj-tog" />
              </button>
            )
          })}
        </section>
      )}

      {/* ── ההצעה המלאה לפני החתימה (החלטה 25) ── */}
      {S.signing && isFilled(S.signing.pdfButtonLabel) && (
        <div className="qj-fullpdf">
          <button
            type="button"
            disabled={!live || client.pdfBusy}
            onClick={() => client?.onDownloadPdf?.()}
          >
            {client?.pdfBusy ? 'מכינים את ה-PDF…' : `⇣ ${t(S.signing.pdfButtonLabel)}`}
          </button>
          {!live && <span className="qj-soon">בתצוגה מקדימה הכפתור מושבת</span>}
          {live && client.pdfError && <span className="qj-soon qj-err">{client.pdfError}</span>}
        </div>
      )}

      {/* ── חתימה ── */}
      {S.signing && (
        <SignCard
          section={S.signing}
          t={t}
          clientCount={nClients}
          clients={content?.clients ?? []}
          client={client}
        />
      )}

      {/* ── כותרת תחתונה. פרטי הסטודיו קבועים בקוד (החלטה 32). ── */}
      <footer className="qj-foot">
        <div>
          <div className="qj-lg">סטודיו בתים</div>
          <span className="qj-contact">עינב שיפמן · קיבוץ נגבה · 052-9593927 · einav.studiob@gmail.com</span>
        </div>
      </footer>
    </div>
  )
}
