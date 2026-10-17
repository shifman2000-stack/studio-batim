import { useEffect, useMemo, useRef, useState } from 'react'
import './QuoteJourneyV2.css'
import { resolveText, isFilled } from '../../lib/quoteV2/resolve'
import { varsOf, clientCountOf, SIGN_CTA_FALLBACK } from '../../lib/quoteV2/content'
import Money from './Money'
import Logo from '../Logo'

/* ═══════════════════════════════════════════════════════════════════════
   QuoteJourneyV2 — הפן השיווקי של הצעת מחיר v2
   מקור העיצוב: docs/mockups/quote-journey.html
   מודל הנתונים: docs/quote-v2-design.md — פרקים A.2, A.6, A.7

   מה הרכיב הזה כן: מרנדר content_v2 כחוויית גלילה.
   מה הוא לא: לא שומר, לא קורא ל-API, ולא נוגע בשום הצעה קיימת.

   סדר הפן השיווקי קבוע כאן בקוד ולא נגזר מסדר המערך —
   פתיחה → שלבים → שכר טרחה → ומה אם → רוצים עוד → PDF → אל ההצעה
   המלאה. החתימה עצמה כבר אינה כאן — היא במסמך המלא.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── פריסת שש שכבות הציור על N שלבים ────────────────────────────────
   docs/quote-v2-design.md, B.4. הנוסחה מונוטונית ומבטיחה שלב 1 → שכבה 1
   ושלב N → שכבה 6 לכל N ≥ 2. פיצול השכבות לתתי-צעדים (a/b) הוא עבודת
   עיצוב שלא בוצעה עדיין, ולכן ב-N > 6 יהיו שלבים שאינם משנים את הציור. */
function layerForStage(index, total) {
  if (total <= 1) return 6
  return 1 + Math.round((index * 5) / (total - 1))
}

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
 * @param {object} [client]     החיבור אל ההצעה החיה: כפתור ה-PDF,
 *                              הקישור אל המסמך המלא (fullHref) והאם
 *                              היא כבר נחתמה (signed). בלעדיו זו
 *                              תצוגה בלבד והכפתורים מושבתים (מעבדה).
 */
export default function QuoteJourneyV2({ content, vars, clientCount, client }) {
  const scrollRef = useRef(null)
  const chapterRefs = useRef([])

  const [stage, setStage] = useState(1)

  /* הערכים הקפואים שבתוך ה-content הם מקור האמת. prop מפורש גובר
     עליהם רק במעבדה, שבה מחליפים לקוחות ושטחים בלי לגעת בנתונים. */
  const v = vars ?? varsOf(content)
  const nClients = clientCount ?? clientCountOf(content)
  const live = !!client

  const t = (raw) => resolveText(raw, v, nClients)

  /* ── הסעיפים, לפי טיפוס. כל טיפוס מופיע פעם אחת (A.2). ── */
  const S = useMemo(() => {
    const byType = {}
    for (const s of content?.sections ?? []) {
      if (s?.enabled === false) continue
      byType[s.type] = s
    }
    return byType
  }, [content])

  /* `enabled: false` על פריט = נשאר במסמך ולא מרונדר (C.2). קודם
     הסינון היה רק ברמת הסעיף, ולכן טוגל שמכבה תוספת בעורך לא היה
     מכבה אותה כאן. הפן הכתוב כבר סינן שלבים ככה. */
  const stages = useMemo(() => (S.stages?.items ?? []).filter(s => s?.enabled !== false), [S])
  const terms = useMemo(
    () => (S.terms?.groups ?? []).flatMap(g => (g.items ?? []).filter(i => i?.enabled !== false)),
    [S]
  )
  const fee = Number(v.fee) || 0
  const total = stages.length

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

  /* ── הפונטים. נטענים רק כל עוד המסע על המסך, ולא מ-index.html,
        כדי שלא לגעת בשאר האפליקציה. ⚠️ לפרודקשן זה יעבור ל-woff2
        מקומי (docs/quote-v2-design.md, B.2). ── */
  useEffect(() => {
    const id = 'qj-fonts'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700&family=Frank+Ruhl+Libre:wght@300;400;500;700&family=Playfair+Display:wght@400;500&family=Rubik:wght@300&display=swap'
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
        <Logo height={20} tone="light" />
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
              </section>
            ))}
          </div>
        </main>
      )}

      {/* ── שכר טרחה ── */}
      {S.fee && (
        <section className="qj-fee">
          <div className="qj-q">{t(S.fee.question)}</div>
          {/* ⚠️ הסכום הסופי מיד. קודם הוא נספר מ-0 תוך 1.4 שניות
              בעקבות IntersectionObserver; הספירה ירדה, והסעיף פשוט
              מופיע תוך כדי גלילה כמו כל סעיף אחר. */}
          <div className="qj-amt">
            <Money value={fee} />
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

      {/* ── רוצים עוד? ──
          ⚠️ טקסט בלבד. קודם היו כאן כפתורי בחירה שכתבו אל
          clientResponse.extrasSelected; הבחירה נשמרה ונחתמה, ואף אחד
          לא ראה אותה — לא במסמך, לא במסכי הצוות ולא במייל. הפריטים
          עצמם נשארים ב-content, והמסמך הכתוב ממשיך להציג אותם דרך
          pdfEyebrow / pdfTitle / pdfBody. */}
      {S.extras && (isFilled(S.extras.title) || isFilled(S.extras.subtitle)) && (
        <section className="qj-extras">
          <h2 className="qj-serif">{t(S.extras.title)}</h2>
          <p className="qj-sub">{t(S.extras.subtitle)}</p>
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

      {/* ── אל ההצעה המלאה ─────────────────────────────────────────
          ⚠️ כאן ישב כרטיס החתימה. החתימה עברה אל המסמך המלא, כדי
          שהלקוח יחתום על מה שהוא קורא ולא על תקציר שלו; מה שנשאר
          כאן הוא הכפתור שמוביל לשם — אל **ראש** המסמך. ⚠️ בתחילה
          הוא הצביע על ‎#sign, כלומר נחת ישר על בלוק החתימה ודילג
          על המסמך שעליו חותמים — בדיוק מה שההעברה באה לתקן.

          בלי client אין טוקן ואין לאן לנווט — בדיוק כמו כפתור
          ה-PDF שמעליו, הכפתור מרונדר מושבת כדי שהתצוגה המקדימה
          בעורך תראה את הנוסח במקומו. */}
      {S.signing && (
        <div className={'qj-cta' + (live && client.signed ? ' qj-signed' : '')}>
          {live && client.fullHref ? (
            <a href={client.fullHref}>
              {client.signed
                ? 'ההצעה נחתמה · לצפייה במסמך החתום'
                : t(isFilled(S.signing.ctaLabel) ? S.signing.ctaLabel : SIGN_CTA_FALLBACK)}
            </a>
          ) : (
            <>
              <button type="button" disabled>
                {t(isFilled(S.signing.ctaLabel) ? S.signing.ctaLabel : SIGN_CTA_FALLBACK)}
              </button>
              <span className="qj-soon">בתצוגה מקדימה הכפתור מושבת</span>
            </>
          )}
        </div>
      )}

      {/* ── כותרת תחתונה. פרטי הסטודיו קבועים בקוד (החלטה 32). ── */}
      <footer className="qj-foot">
        <div>
          <Logo height={18} tone="light" />
          <span className="qj-contact">עינב שיפמן · קיבוץ נגבה · 052-9593927 · einav.studiob@gmail.com</span>
        </div>
      </footer>
    </div>
  )
}
