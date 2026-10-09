import { useEffect, useMemo } from 'react'
import './QuoteTowerV2.css'
import { resolveText, isFilled } from '../../lib/quoteV2/resolve'
import { computePayments } from '../../lib/quoteV2/payments'
import { varsOf, clientCountOf, signersOf, isSignedContent } from '../../lib/quoteV2/content'
import Money from './Money'

/* ═══════════════════════════════════════════════════════════════════════
   QuoteTowerV2 — הפן הכתוב של הצעת מחיר v2 ("מגדל הבית")
   מקור העיצוב: docs/mockups/quote-tower.html
   הנוסח המחייב:  docs/mockups/quote-reference.pdf (הצעת 29.9.26)
   המודל:         docs/quote-v2-design.md — A.2, B.3

   אותו content_v2 שמזין את החוויה, אבל **רק השדות של 📄**:
   formalName · process · output · pct · trigger · duration ·
   formalTitle · body · pdfTitle · pdfIntro · pdfBody · pdfText.
   שדות 📱 (storyTitle, storyBody, storyDeliverable, shortLabel,
   question, marketingAnswer) אינם נקראים כאן כלל.

   סדר הפרקים קבוע בקוד ולא לפי סדר המערך:
   תכולת השירות → תשלומים → שלבים → שירותים משלימים → תנאים → אישור.
   ═══════════════════════════════════════════════════════════════════════ */

/* פרטי הסטודיו קבועים בקוד, כמו ב-v1 (QuotePreview.jsx:584-590)
   ובהחלטה 32. אלה פרטי עוסק מורשה ולא טקסט שיווקי. */
const STUDIO = {
  name: 'עינב שיפמן · סטודיו בתים',
  vat: '031432826',
  phone: '052-9593927',
  email: 'einav.studiob@gmail.com',
  address: 'קיבוץ נגבה',
  signerTitle: 'סטודיו בתים · הנדסאית אדריכלות',
}

/* הלבנה האיזומטרית מהמוקאפ, שתי גרסאות צבע. פוליגונים בלבד —
   אין כאן <text>, ולכן גם לא בעיית העברית ההפוכה ב-WebKit.
   ⚠️ המוקאפ משתמש ב-<symbol> + <use>. כאן הפוליגונים מצוירים
   בתוך כל <svg> מחדש, כי ב-Chrome headless התוכן של <use> לא
   צויר ב-PDF והלבנים יצאו ריקות. הפרדת ה-defs מהשימוש היא
   בדיוק סוג התלות שמתפרקת בצינור ההדפסה — ולבנה היא 7 פוליגונים,
   זול יותר מלנסות להבין למה. */
const BRICK_COLORS = {
  sand: { left: '#a89f90', front: '#c8bfb0', top: '#ddd5c8', seam: '#968c7c' },
  sage: { left: '#4a6e48', front: '#7a9478', top: '#9fb39d', seam: '#3d5a3b' },
}

function Brick({ w = 46, sage = false, style, className }) {
  const c = sage ? BRICK_COLORS.sage : BRICK_COLORS.sand
  return (
    <svg
      className={'qt-brick' + (className ? ' ' + className : '')}
      style={style}
      width={w}
      height={Math.round((w * 74) / 100)}
      viewBox="-19 -10 38 28"
      aria-hidden="true"
    >
      <polygon points="-18,-2 -8,6 -8,17 -18,9" fill={c.left} />
      <polygon points="-8,6 18,-1 18,10 -8,17" fill={c.front} />
      <polygon points="-18,-2 8,-9 18,-1 -8,6" fill={c.top} />
      <g fill={c.seam}>
        <polygon points="-14.1,-1.66 -5.26,-4.04 -2.26,-1.64 -11.1,0.74" />
        <polygon points="-2.14,-4.88 6.7,-7.26 9.7,-4.86 0.86,-2.48" />
        <polygon points="-9.7,1.86 -0.86,-0.52 2.14,1.88 -6.7,4.26" />
        <polygon points="2.26,-1.36 11.1,-3.74 14.1,-1.34 5.26,1.04" />
      </g>
    </svg>
  )
}

function Chapter({ num, title, first }) {
  return (
    <div className={'qt-ch' + (first ? ' qt-ch--first' : '')}>
      <span className="qt-big">{num}</span>
      <h2>{title}</h2>
    </div>
  )
}

/* ── המגדל שעל השער ────────────────────────────────────────────────
   המוקאפ קשיח ל-6 לבנים ב-bottom: 0/44/88/… . כאן המרווח נגזר
   ממספר השלבים, כך שגובה המגדל נשאר קבוע (B.4). הלבנה האחרונה
   בצבע sage — היא סוף הפרויקט. */
function Tower({ names }) {
  const n = names.length
  if (n === 0) return null
  const step = n > 1 ? Math.min(44, 220 / (n - 1)) : 0
  const height = Math.round((n - 1) * step + 104)
  return (
    <div className="qt-tower" style={{ height }}>
      {names.map((name, i) => (
        <Brick key={'b' + i} w={110} sage={i === n - 1} className="qt-brickpos"
          style={{ bottom: Math.round(i * step) }} />
      ))}
      {names.map((name, i) => (
        <div key={'l' + i} className="qt-tl" style={{ bottom: Math.round(i * step) + 20 }}>
          <b>שלב {i + 1}</b>{name}
        </div>
      ))}
    </div>
  )
}

export default function QuoteTowerV2({ content, vars, clientCount }) {
  /* כמו בפן השיווקי: הערכים הקפואים שב-content הם מקור האמת, ו-prop
     מפורש גובר עליהם רק במעבדה. */
  const v = vars ?? varsOf(content)
  const nClients = clientCount ?? clientCountOf(content)
  const signers = signersOf(content, nClients)
  const isSigned = isSignedContent(content)
  const t = (raw) => resolveText(raw, v, nClients)

  const S = useMemo(() => {
    const byType = {}
    for (const s of content?.sections ?? []) {
      if (s?.enabled === false) continue
      byType[s.type] = s
    }
    return byType
  }, [content])

  const stages = useMemo(
    () => (S.stages?.items ?? []).filter(s => s?.enabled !== false),
    [S]
  )
  /* כמו השלבים למעלה: פריט מכובה נשאר במסמך ולא מרונדר (C.2). */
  const groups = useMemo(
    () => (S.terms?.groups ?? []).map(g => ({ ...g, items: (g.items ?? []).filter(i => i?.enabled !== false) })),
    [S]
  )
  const fee = Number(v.fee) || 0
  const amounts = useMemo(
    () => computePayments(fee, stages.map(s => s.pct)),
    [fee, stages]
  )
  const pctSum = stages.reduce((a, s) => a + (Number(s.pct) || 0), 0)

  /* פונטים — נטענים רק כל עוד המסמך על המסך, ולא מ-index.html, כדי
     לא לגעת בשאר האפליקציה. ⚠️ לפרודקשן זה יעבור ל-woff2 מקומי
     (docs/quote-v2-design.md, B.2), כי Puppeteer לא ימתין לרשת. */
  useEffect(() => {
    const id = 'qt-fonts'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700&family=Rubik:wght@300;400&family=Playfair+Display:wght@400;500&family=Frank+Ruhl+Libre:wght@300;400;500&display=swap'
    document.head.appendChild(link)
    return () => { document.getElementById(id)?.remove() }
  }, [])

  if (!content) return null

  const clientLine = isFilled(v.firstNames) ? v.firstNames : '—'
  const dateLine = isFilled(v.date) ? v.date : ''
  const metaLine = [clientLine, v.settlement].filter(isFilled).join(' · ')

  const Logo = (
    <div className="qt-logo">
      <div className="qt-lg-he">סטודיו בתים</div>
      <div className="qt-lg-en">BY EINAV SHIFMAN</div>
    </div>
  )

  return (
    <div className="qt-doc" dir="rtl" lang="he">

      {/* ══ עמוד השער ══ */}
      <section className="qt-cover">
        <div className="qt-run">
          {Logo}
          <div className="qt-meta">{['הצעת מחיר', dateLine].filter(Boolean).join(' · ')}</div>
        </div>

        <div className="qt-hero">
          <div className="qt-hero-col">
            <div className="qt-over">תכנון אדריכלי · רישוי · ליווי</div>
            <h1>
              הבית של<br />{clientLine}
              {isFilled(v.settlement) && <><br /><em>ב{v.settlement}</em></>}
            </h1>
          </div>
          <Tower names={stages.map(s => t(s.formalName))} />
        </div>

        {fee > 0 && (
          <div className="qt-fee">
            <div className="qt-k">
              {isFilled(S.fee?.feeLabel) ? t(S.fee.feeLabel) : 'שכר טרחה'}
              <br />{isFilled(S.fee?.vatNote) ? t(S.fee.vatNote) : 'בתוספת מע״מ'}
            </div>
            <div className="qt-amt"><Money value={fee} /></div>
          </div>
        )}

        <div className="qt-parties">
          <div className="qt-pc">
            <h5>{nClients > 1 ? 'המזמינים' : 'המזמין'}</h5>
            {/* אחרי החתימה — השם והת.ז. שהלקוח הקליד, שורה לכל מזמין.
                לפני כן בדיוק כמו קודם: שורת השמות מהפנייה וקו ת.ז. ריק.
                אותו signersOf שמזין את בלוק אישור ההצעה (החלטה 33). */}
            {isSigned ? signers.map((sg, i) => (
              <div className="qt-psigner" key={i}>
                {sg.name || '—'}<br />
                <span className="qt-m">ת.ז.</span>{' '}
                {sg.idNumber
                  ? <span className="qt-idval">{sg.idNumber}</span>
                  : <span className="qt-idline" />}
              </div>
            )) : (
              <>
                {clientLine}<br />
                <span className="qt-m">ת.ז.</span> <span className="qt-idline" />
              </>
            )}
            {isFilled(v.clientPhone) && <><br /><span className="qt-m qt-ltr">{v.clientPhone}</span></>}
            {isFilled(v.clientEmail) && <><br /><span className="qt-m qt-ltr">{v.clientEmail}</span></>}
            {isFilled(v.settlement) && <><br /><span className="qt-m">כתובת הנכס: {v.settlement}</span></>}
          </div>
          <div className="qt-pc">
            <h5>המתכנן</h5>
            {STUDIO.name}<br />
            <span className="qt-m">ע.מ {STUDIO.vat}</span><br />
            <span className="qt-m qt-ltr">{STUDIO.phone} · {STUDIO.email}</span><br />
            <span className="qt-m">{STUDIO.address}</span>
          </div>
        </div>
      </section>

      {/* ══ 01 · תכולת השירות ══ */}
      {S.scope && (
        <>
          <Chapter num="01" title={t(S.scope.pdfTitle)} first />
          <p className="qt-txt">{t(S.scope.body)}</p>
        </>
      )}

      {/* ══ 02 · תשלומים ══ */}
      {S.fee && stages.length > 0 && (
        <>
          <Chapter num="02" title={t(S.fee.pdfTitle)} />
          {isFilled(S.fee.tableIntro) && <p className="qt-lead">{t(S.fee.tableIntro)}</p>}

          {stages.map((st, i) => (
            <div className="qt-pay" key={st.id ?? i}>
              <span className="qt-pc">{st.pct}%</span>
              <Brick w={40} sage={i === stages.length - 1} />
              <div className="qt-mid">
                <small>שלב {i + 1}</small>
                <b>{t(st.formalName)}</b>
                {isFilled(st.duration) && (
                  <span>{t(st.duration).split('\n').filter(Boolean).join(' · ')}</span>
                )}
              </div>
              <div className="qt-when">
                <i>מועד התשלום</i>
                {t(st.trigger)}
              </div>
              {fee > 0 && (
                <div className="qt-sum">
                  <Money value={amounts[i]} />
                  <span className="qt-vat">בתוספת מע״מ</span>
                </div>
              )}
            </div>
          ))}

          <div className="qt-paytotal">
            <span>סה״כ</span>
            <b>
              <bdi className="qt-pctnum">{pctSum}%</bdi>
              {fee > 0 && <> · <Money value={fee} /></>}
              {' '}{isFilled(S.fee.vatNote) ? t(S.fee.vatNote) : 'בתוספת מע״מ'}
            </b>
          </div>
        </>
      )}

      {/* ══ 03 · פירוט שלבי העבודה ══ */}
      {S.stages && stages.length > 0 && (
        <>
          <Chapter num="03" title={t(S.stages.pdfTitle)} />
          {stages.map((st, i) => (
            <div className="qt-stage" key={st.id ?? i}>
              <div className="qt-side">
                <Brick w={46} sage={i === stages.length - 1} />
                <div className="qt-no">שלב {i + 1}</div>
                <h3>{t(st.formalName)}</h3>
              </div>
              <div className="qt-body">
                <div className="qt-lbl">התהליך</div>
                <p className="qt-txt">{t(st.process)}</p>
                {isFilled(st.output) && (
                  <p className="qt-pull">
                    <span className="qt-lbl">התוצר · </span>{t(st.output)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ══ שירותים משלימים ══ */}
      {S.extras && isFilled(S.extras.pdfBody) && (
        <div className="qt-optional">
          <Brick w={46} style={{ opacity: .55 }} />
          <div>
            {isFilled(S.extras.pdfEyebrow) && <div className="qt-tag">{t(S.extras.pdfEyebrow)}</div>}
            {isFilled(S.extras.pdfTitle) && <h4>{t(S.extras.pdfTitle)}</h4>}
            <p className="qt-txt">{t(S.extras.pdfBody)}</p>
          </div>
        </div>
      )}

      {/* ══ 04 · מסגרת העבודה וגבולות אחריות ══ */}
      {S.terms && groups.length > 0 && (
        <>
          <Chapter num="04" title={t(S.terms.pdfTitle)} />
          {isFilled(S.terms.pdfIntro) && <p className="qt-lead">{t(S.terms.pdfIntro)}</p>}
          {groups.map((g, gi) => (
            <div className="qt-tg" key={g.id ?? gi}>
              <h3><Brick w={26} />{t(g.title)}</h3>
              {(g.items ?? []).map((item, ii) => {
                const labelled = isFilled(item.formalTitle)
                return (
                  <div
                    className={'qt-term' + (labelled ? '' : ' qt-term--nolabel')}
                    key={item.id ?? ii}
                  >
                    {labelled && <div className="qt-k">{t(item.formalTitle)}</div>}
                    <div className="qt-v">{t(item.body)}</div>
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}

      {/* ══ אישור ההצעה ══ */}
      {S.signing && (
        <>
          <div className="qt-approve">
            <h2>{isFilled(S.signing.pdfTitle) ? t(S.signing.pdfTitle) : 'אישור ההצעה'}</h2>
            {isFilled(S.signing.pdfText) && <p className="qt-txt">{t(S.signing.pdfText)}</p>}
            {/* לפני החתימה — שורות ריקות, כולל קו ת.ז. (החלטה 33).
                אחרי החתימה — מה שהלקוח הקליד וצייר, באותן עמודות. */}
            {signers.map((sg, i) => {
              const signedAt = sg.signedAtClient
                ? new Date(sg.signedAtClient).toLocaleDateString('he-IL')
                : ''
              return (
                <div key={i}>
                  {nClients > 1 && <div className="qt-signer">חותם {i + 1}</div>}
                  {isSigned && (
                    <div className="qt-sigvals">
                      <div>{sg.name || ''}</div>
                      <div>{sg.idNumber || ''}</div>
                      <div className="qt-sigimg">
                        {sg.image && <img src={sg.image} alt="" />}
                      </div>
                      <div>{signedAt}</div>
                    </div>
                  )}
                  <div className="qt-sigrow">
                    <div>שם</div><div>ת.ז.</div><div>חתימה</div><div>תאריך</div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="qt-closing">
            <div className="qt-who">
              {isFilled(S.signing.closing) ? t(S.signing.closing) : 'בברכה,'}
              <b>עינב שיפמן</b>
              {STUDIO.signerTitle}
            </div>
            <svg width="170" height="72" viewBox="0 0 190 80" aria-hidden="true">
              <path d="M8 58 C30 20,46 66,62 40 S90 10,98 46 S120 70,136 30 S170 18,182 26"
                fill="none" stroke="#2c3f73" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M40 64 C80 52,130 54,176 44"
                fill="none" stroke="#2c3f73" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </div>
        </>
      )}

      {/* ⚠️ אין כאן כותרת רצה ומספור עמודים. הם יגיעו מ-Puppeteer
          דרך displayHeaderFooter בשלב החתימה — זו הדרך היחידה לקבל
          pageNumber/totalPages אמיתיים. @page משאיר להם שוליים. */}
      <div className="qt-metafoot" hidden>{metaLine}</div>
    </div>
  )
}
