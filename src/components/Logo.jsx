import React from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   הלוגו האופקי — "סטודיו בתים │ BY EINAV SHIFMAN"

   מקור אחד לכל המסכים. הסדר החזותי נקבע ע״י direction:rtl על המכל:
   הוורדמארק מימין, הקו באמצע, הכיתוב הלטיני משמאל.

   ⚠️ ברירות המחדל (height=30, tone='dark') חייבות להישאר זהות
   לפיקסל למה שהיה כאן לפני שנוספו ה-props — הן מה שהניווט,
   ClientPortal ו-QuotePreview מרנדרים. k יוצא 1 בדיוק, וכל ערך
   מוכפל בו חוזר למספר המקורי.

   tone='light' נועד לרקע הכהה של המסע (#16201d). אין שימוש
   בטוקנים של theme.css כאן בכוונה: --text-primary הוא כמעט שחור
   ועל רקע כהה הוא היה נעלם.
   ═══════════════════════════════════════════════════════════════════════ */

const BASE_H = 30          // גובה הוורדמארק המקורי

const TONES = {
  dark:  { title: '#1a1a18', sub: '#8a8680', rule: '#c8bfb0' },
  light: { title: '#efe7d8', sub: '#97a49c', rule: 'rgba(239, 231, 216, .45)' },
};

export default function Logo({ height = BASE_H, tone = 'dark' }) {
  const k = height / BASE_H;
  const c = TONES[tone] ?? TONES.dark;

  /* ⚠️ סדר הילדים כאן הוא [ורדמארק, קו, כיתוב] — זה הסדר שמייצר
     "סטודיו בתים" מימין ו-BY EINAV SHIFMAN משמאל, כי direction:rtl
     על המכל מניח את הילד הראשון בימין. קודם הם היו הפוכים, והלוגו
     יצא עם הלטינית מימין בכל מקום שבו הוא מופיע.

     direction:rtl כתוב כאן במפורש ולא יורש מההורה: הלוגו מופיע גם
     בתוך מכלים ממורכזים ו-LTR, והסדר שלו לא אמור להיות תלוי בהם.
     (מדוד: אותו סדר בדיוק בארבעה סוגי הורים.) */
  return (
    <div style={{ textDecoration: 'none', direction: 'rtl', display: 'flex', alignItems: 'center', gap: 0 }}>
      <span style={{
        fontFamily: "'Rubik', sans-serif",
        fontWeight: 300,
        fontSize: `${30 * k}px`,
        letterSpacing: '0.06em',
        color: c.title,
        lineHeight: 1,
        whiteSpace: 'nowrap'
      }}>סטודיו בתים</span>
      <span style={{
        display: 'block',
        width: '1px',
        height: `${28 * k}px`,
        flexShrink: 0,
        background: `linear-gradient(to bottom, transparent, ${c.rule} 25%, ${c.rule} 75%, transparent)`,
        margin: `0 ${16 * k}px`
      }} />
      <span style={{
        fontFamily: "'Heebo', sans-serif",
        fontWeight: 200,
        fontSize: `${9 * k}px`,
        letterSpacing: '0.28em',
        color: c.sub,
        direction: 'ltr',
        whiteSpace: 'nowrap'
      }}>BY EINAV SHIFMAN</span>
    </div>
  );
}
