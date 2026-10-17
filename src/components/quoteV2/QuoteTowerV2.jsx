import { useEffect, useMemo } from 'react'
import './QuoteTowerV2.css'
import { resolveText, isFilled } from '../../lib/quoteV2/resolve'
import { computePayments } from '../../lib/quoteV2/payments'
import { varsOf, clientCountOf, signersOf, isSignedContent } from '../../lib/quoteV2/content'
import Money from './Money'
import SignCard from './SignCard'
import Logo from '../Logo'

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
   תכולת השירות → תשלומים → שלבים → תנאים → שירותים משלימים → אישור.
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

/* הלבנה האיזומטרית מהמוקאפ. פוליגונים בלבד — אין כאן <text>,
   ולכן גם לא בעיית העברית ההפוכה ב-WebKit.
   ⚠️ המוקאפ משתמש ב-<symbol> + <use>. כאן הפוליגונים מצוירים
   בתוך כל <svg> מחדש, כי ב-Chrome headless התוכן של <use> לא
   צויר ב-PDF והלבנים יצאו ריקות. הפרדת ה-defs מהשימוש היא
   בדיוק סוג התלות שמתפרקת בצינור ההדפסה — ולבנה היא 7 פוליגונים,
   זול יותר מלנסות להבין למה. */
const BRICK_COLORS = {
  sand:  { left: '#a89f90', front: '#c8bfb0', top: '#ddd5c8', seam: '#968c7c' },
  terra: { left: '#b45a2c', front: '#d9774a', top: '#e89a73', seam: '#9c4c24' },
}

/* ⚠️ הגוון נקבע **לפי פרק**, לא לפי מקום ברשימה. קודם הלבנה
   האחרונה בכל רשימה יצאה בטרקוטה (accent={i === last}), וכך
   באותו מסמך היו שלוש רשימות שכל אחת מסתיימת בצבע אחר בלי
   שהצבע אומר משהו. עכשיו: 02 טרקוטה, 03 חול, 04 והסעיף
   האופציונלי חיוורות. ‎pale היא אותה לבנת חול בשקיפות 55%,
   בדיוק מה שהסעיף האופציונלי הציג מאז ומתמיד. */
const BRICK_VARIANTS = {
  terra: { colors: BRICK_COLORS.terra, opacity: 1 },
  sand:  { colors: BRICK_COLORS.sand,  opacity: 1 },
  pale:  { colors: BRICK_COLORS.sand,  opacity: 0.55 },
}

function Brick({ w = 46, variant = 'sand', style, className }) {
  const v = BRICK_VARIANTS[variant] ?? BRICK_VARIANTS.sand
  const c = v.colors
  style = v.opacity === 1 ? style : { opacity: v.opacity, ...style }
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

/**
 * @param {object} [client] מצב ההצעה החיה — מה שהופך את המסמך
 *   למסך לקוח אינטראקטיבי. ⚠️ **בלעדיו הרינדור זהה לחלוטין למה
 *   שהיה**, וזה התנאי שמחזיק את ה-PDF: QuoteTowerPrint לא מעביר
 *   client, ולכן כל מה שתלוי בו פשוט לא קיים בצינור ההדפסה.
 *   כל תוספת אינטראקטיבית כאן חייבת להיות מאחורי `live`.
 */
export default function QuoteTowerV2({ content, vars, clientCount, client }) {
  const live = !!client

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


  return (
    <div className={'qt-doc' + (live ? ' qt-live' : '')} dir="rtl" lang="he">

      {/* ══ עמוד השער ══ */}
      <section className="qt-cover">
        <div className="qt-run">
          <Logo height={22} />
          <div className="qt-meta">{['הצעת מחיר', dateLine].filter(Boolean).join(' · ')}</div>
        </div>

        {/* ⚠️ כאן ישב מגדל הלבנים עם רשימת השלבים, ומתחתיו סכום
            שכר הטרחה. המגדל ירד כליל; הסכום עבר לראש פרק 02,
            שם ממילא מפורט לוח התשלומים. מה שנשאר בשער הוא
            הכותרת ושני המלבנים, והמרווחים כוונו מחדש סביבם. */}
        <div className="qt-hero">
          <div className="qt-hero-col">
            <div className="qt-over">תכנון אדריכלי · רישוי · ליווי</div>
            <h1>
              הבית של<br />{clientLine}
              {isFilled(v.settlement) && <><br /><em>ב{v.settlement}</em></>}
            </h1>
          </div>
        </div>

        <div className="qt-parties">
          <div className="qt-pc">
            <h5>{nClients > 1 ? 'המזמינים' : 'המזמין'}</h5>
            {/* אחרי החתימה — השם שהלקוח הקליד, שורה לכל מזמין; לפניה
                שורת השמות מהפנייה. ⚠️ הת.ז. ירדה מכאן — גם הקו הריק
                וגם הערך החתום. היא ממשיכה להופיע בבלוק אישור ההצעה
                שבסוף, שהוא המקום שבו היא מחייבת. */}
            {isSigned
              ? signers.map((sg, i) => (
                <div className="qt-psigner" key={i}>{sg.name || '—'}</div>
              ))
              : clientLine}
            {/* ⚠️ שם וכתובת בלבד. הטלפון והמייל ירדו — הם פרטי קשר
                ולא צד להסכם, והם מופיעים בפנייה ובמייל שאליו מצורף
                המסמך. */}
            {isFilled(v.settlement) && <><br /><span className="qt-m">כתובת הנכס: {v.settlement}</span></>}
          </div>
          <div className="qt-pc">
            <h5>המתכנן</h5>
            {/* ⚠️ שתי שורות בדיוק. הטלפון, המייל והכתובת ירדו. */}
            {STUDIO.name}<br />
            <span className="qt-m">ע.מ {STUDIO.vat}</span>
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

          {/* ⚠️ הסכום הגיע לכאן מעמוד השער. אותו תוכן ואותו עיצוב
              בדיוק — רק המרווח העליון התאפס, כי מעליו כותרת פרק
              ולא כותרת שער. */}
          {fee > 0 && (
            <div className="qt-fee">
              <div className="qt-k">
                {isFilled(S.fee?.feeLabel) ? t(S.fee.feeLabel) : 'שכר טרחה'}
                <br />{isFilled(S.fee?.vatNote) ? t(S.fee.vatNote) : 'בתוספת מע״מ'}
              </div>
              <div className="qt-amt"><Money value={fee} /></div>
            </div>
          )}

          {isFilled(S.fee.tableIntro) && <p className="qt-lead">{t(S.fee.tableIntro)}</p>}

          {stages.map((st, i) => (
            <div className="qt-pay" key={st.id ?? i}>
              <span className="qt-pc">{st.pct}%</span>
              <Brick w={40} variant="terra" />
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
                <Brick w={46} variant="sand" />
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

      {/* ══ 04 · מסגרת העבודה וגבולות אחריות ══ */}
      {S.terms && groups.length > 0 && (
        <>
          <Chapter num="04" title={t(S.terms.pdfTitle)} />
          {isFilled(S.terms.pdfIntro) && <p className="qt-lead">{t(S.terms.pdfIntro)}</p>}
          {groups.map((g, gi) => (
            <div className="qt-tg" key={g.id ?? gi}>
              <h3><Brick w={26} variant="pale" />{t(g.title)}</h3>
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

      {/* ══ שירותים משלימים ══
          ⚠️ הסעיף הזה ישב בין פרק 03 לפרק 04 ועבר לכאן, אל סוף
          המסמך וממש לפני בלוק האישור. הוא אינו ממוספר ואינו
          חלק מההצעה עצמה — הוא מה שאפשר להוסיף עליה, ולכן
          מקומו אחרי שנגמר מה שכלול בה. ⚠️ בפן השיווקי
          (QuoteJourneyV2) הסדר לא השתנה. */}
      {S.extras && isFilled(S.extras.pdfBody) && (
        <div className="qt-optional">
          <Brick w={46} variant="pale" />
          <div>
            {isFilled(S.extras.pdfEyebrow) && <div className="qt-tag">{t(S.extras.pdfEyebrow)}</div>}
            {isFilled(S.extras.pdfTitle) && <h4>{t(S.extras.pdfTitle)}</h4>}
            <p className="qt-txt">{t(S.extras.pdfBody)}</p>
          </div>
        </div>
      )}

      {/* ══ אישור ההצעה ══ */}
      {S.signing && (
        <>
          <div className="qt-approve">
            <h2>{isFilled(S.signing.pdfTitle) ? t(S.signing.pdfTitle) : 'אישור ההצעה'}</h2>
            {isFilled(S.signing.pdfText) && <p className="qt-txt">{t(S.signing.pdfText)}</p>}
            {/* לפני החתימה — שורות ריקות, כולל קו ת.ז. (החלטה 33).
                אחרי החתימה — מה שהלקוח הקליד וצייר, באותן עמודות.

                ⚠️ במצב לקוח שעדיין לא נחתם אין שורות ריקות: במקומן
                מגיע הכרטיס שמתחת, ושורת חתימה בעט מעל טופס חתימה
                דיגיטלי רק שואלת על איזו מהן לחתום. */}
            {live && !isSigned ? null : signers.map((sg, i) => {
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

            {/* ⚠️ מצב לקוח בלבד — אותו SignCard, אותה ולידציה ואותו
                אובייקט שנשלח לשרת; רק ההורה התחלף. אחרי שליחה
                מוצלחת הוא מציג את doneHeadline/doneBody ואת הקישור
                ל-PDF החתום, ולמעלה כאן כבר מופיעים הערכים החתומים,
                כי QuoteSignV2 מיזג את התשובה אל ה-content. */}
            {live && (
              <SignCard
                section={S.signing}
                t={t}
                clientCount={nClients}
                clients={content?.clients ?? []}
                client={client}
              />
            )}
          </div>

          {/* ⚠️ שלושת שורות הטקסט הן גוש אחד רצוף, והחתימה **לצידו**
              ולא בתוכו. היא עברה כאן שני סיבובים: קודם הייתה בקצה
              הנגדי של הדף (space-between), ואז נדחפה בין השם לשורת
              התפקיד — ששברה את הגוש לשניים. עכשיו הגוש שלם מימין
              והחתימה משמאלו, ממורכזת אליו אנכית.
              התמונה עצמה היא קובץ אמיתי ולא שרבוט SVG; הנתיב מוחלט
              מהשורש, ולכן הוא נפתר מול אותו origin גם כשהדף נטען
              ב-Puppeteer, ו-api/_quoteTowerPdf ממתין לטעינת
              התמונות לפני ההדפסה. object-fit:contain כדי שלא
              תיחתך לעולם. */}
          <div className="qt-closing">
            <div className="qt-who">
              {isFilled(S.signing.closing) ? t(S.signing.closing) : 'בברכה,'}
              <b>עינב שיפמן</b>
              <span className="qt-role">{STUDIO.signerTitle}</span>
            </div>
            <img className="qt-sig" src="/quote/einav-signature.png" alt="" />
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
