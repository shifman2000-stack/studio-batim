import { useEffect, useRef, useState } from 'react'
import QuoteTowerV2 from '../QuoteTowerV2'

/* ═══════════════════════════════════════════════════════════════════════
   התצוגה המקדימה — C.1

   ⚠️ לא הדמיה. שני הפנים כאן הם **הרכיבים האמיתיים** שהלקוח מקבל
   ושנכנסים ל-PDF.

   📱 הפן השיווקי רץ בתוך **iframe**, ולא בתוך div. המסע נשען על
   רוחב וגובה ה-viewport — media queries, הציור שננעץ בראש המסך
   בטלפון, ומכל גלילה משלו. בתוך div על מסך רחב כל אלה נמדדו מול
   חלון הדפדפן, ולכן התצוגה הראתה פריסת מחשב בתוך מסגרת טלפון.
   ל-iframe יש viewport משלו, ולכן 390×844 מתנהג כמו טלפון אמיתי
   ו-1440×900 כמו מסך.

   התוכן עובר ב-postMessage בכל שינוי — התצוגה מראה את מה שעינב
   עורכת ברגע זה, בלי לשמור.

   📄 הפן הכתוב נשאר כמו שהיה: QuoteTowerV2 ישירות, כגיליון נייר.
   הוא לא תלוי ב-viewport — רוחבו 210mm קבוע.
   ═══════════════════════════════════════════════════════════════════════ */

const DEVICES = {
  phone: { w: 390, h: 844, label: '📱 טלפון' },
  desktop: { w: 1440, h: 900, label: '🖥 מחשב' },
}

export default function PreviewModal({ content, onClose }) {
  const [face, setFace] = useState('mk')
  const [device, setDevice] = useState('phone')
  const [scale, setScale] = useState(1)
  const frameRef = useRef(null)
  const readyRef = useRef(false)
  const boxRef = useRef(null)

  const dev = DEVICES[device]

  /* שולחים את התוכן ל-iframe. ה-ready מגיע ממנו כשהוא נטען, כי
     onLoad של ה-iframe לא מבטיח שה-listener כבר רשום. */
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'quote-v2-preview-ready') return
      readyRef.current = true
      frameRef.current?.contentWindow?.postMessage(
        { type: 'quote-v2-preview', content }, window.location.origin)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [content])

  /* כל שינוי בתוכן — משודר מחדש, מושהה מעט כדי לא להציף בהקלדה. */
  useEffect(() => {
    if (!readyRef.current) return
    const id = setTimeout(() => {
      frameRef.current?.contentWindow?.postMessage(
        { type: 'quote-v2-preview', content }, window.location.origin)
    }, 150)
    return () => clearTimeout(id)
  }, [content])

  /* החלפת מכשיר טוענת מחדש את ה-iframe, ולכן מאפסת את ה-ready. */
  useEffect(() => { readyRef.current = false }, [device])

  /* מכווצים את ה-iframe כדי שייכנס למודאל, בלי לשנות פרופורציות:
     ה-iframe עצמו נשאר 1440×900 ו-transform מקטין אותו. */
  useEffect(() => {
    if (face !== 'mk') return
    const fit = () => {
      const box = boxRef.current
      if (!box) return
      /* clientWidth כולל את הריפוד (box-sizing: border-box), ולכן
         בלי לחסר אותו המסגרת יוצאת רחבה מהמקום ומופיע פס גלילה
         אופקי במודאל. */
      const cs = getComputedStyle(box)
      const padX = parseFloat(cs.paddingInlineStart) + parseFloat(cs.paddingInlineEnd)
      const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      const availW = box.clientWidth - padX - 4
      const availH = box.clientHeight - padY - 4
      setScale(Math.min(1, availW / dev.w, availH / dev.h))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [face, device, dev.w, dev.h])

  return (
    <div className="qe-ov">
      <div className="qe-ovbar">
        <div className="qe-seg">
          <button type="button" className={face === 'mk' ? 'on' : ''} onClick={() => setFace('mk')}>
            📱 מה שהלקוח רואה
          </button>
          <button type="button" className={face === 'wr' ? 'on' : ''} onClick={() => setFace('wr')}>
            📄 ההצעה הכתובה (PDF)
          </button>
        </div>

        {face === 'mk' && (
          <div className="qe-seg">
            {Object.entries(DEVICES).map(([key, d]) => (
              <button key={key} type="button" className={device === key ? 'on' : ''} onClick={() => setDevice(key)}>
                {d.label}
              </button>
            ))}
          </div>
        )}

        <button type="button" className="qe-ovx" onClick={onClose}>סגירה ✕</button>
      </div>

      <div className="qe-ovbody" ref={boxRef}>
        {face === 'mk' ? (
          <div
            className={'qe-dev' + (device === 'phone' ? ' qe-dev--phone' : '')}
            style={{
              width: dev.w * scale,
              height: dev.h * scale,
            }}
          >
            <iframe
              ref={frameRef}
              key={device}
              title="תצוגה מקדימה"
              src="/quotes-v2/preview-frame"
              style={{
                width: dev.w, height: dev.h, border: 0, display: 'block',
                transform: `scale(${scale})`, transformOrigin: 'top right',
              }}
            />
          </div>
        ) : (
          <div className="qe-paper-wrap">
            <QuoteTowerV2 content={content} />
          </div>
        )}
      </div>

      {face === 'mk' && (
        <div className="qe-devnote">
          {dev.w}×{dev.h}
          {scale < 1 ? ` · מוצג ב-${Math.round(scale * 100)}%` : ''}
          {' · '}גלילה בתוך המסגרת
        </div>
      )}
    </div>
  )
}
