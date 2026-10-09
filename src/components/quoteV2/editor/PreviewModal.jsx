import { useState } from 'react'
import QuoteJourneyV2 from '../QuoteJourneyV2'
import QuoteTowerV2 from '../QuoteTowerV2'

/* ═══════════════════════════════════════════════════════════════════════
   התצוגה המקדימה — C.1

   ⚠️ לא הדמיה. שני הרכיבים כאן הם **אותם רכיבים** שהלקוח מקבל
   ושנכנסים ל-PDF. מוקאפ שמצייר מחדש את החוויה בתוך העורך מתיישן
   ברגע שמשנים את החוויה עצמה, וזו בדיוק הטעות שהעורך הזה אמור
   למנוע מעינב: שתראה את מה שייצא, לא ציור שלו.

   החתימה מושבתת פשוט בכך שלא מועבר prop `client` — בלעדיו המסע
   נכנס למצב תצוגה, הפדים מושבתים והכפתור מת.
   ═══════════════════════════════════════════════════════════════════════ */

export default function PreviewModal({ content, onClose }) {
  const [face, setFace] = useState('mk')

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
        <button type="button" className="qe-ovx" onClick={onClose}>סגירה ✕</button>
      </div>

      <div className="qe-ovbody">
        {face === 'mk' ? (
          <div className="qe-phone">
            <div className="qe-scr">
              <QuoteJourneyV2 content={content} />
            </div>
          </div>
        ) : (
          <div className="qe-paper-wrap">
            <QuoteTowerV2 content={content} />
          </div>
        )}
      </div>
    </div>
  )
}
