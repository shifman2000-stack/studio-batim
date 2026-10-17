import LinkedField from './LinkedField'
import { isFilled } from '../../../lib/quoteV2/resolve'
import { SIGN_CTA_FALLBACK } from '../../../lib/quoteV2/content'

/* 5 · החתימה — שלושת הנוסחים שהלקוח פוגש סביב החתימה.

   ⚠️ רק שלושה שדות, ובכוונה. ל-sec_sign יש עוד נוסחים (headline,
   subtitle, consentLabel, legal, pdfText, pdfTitle, closing,
   pdfButtonLabel), והם מחייבים או משפטיים — לא טקסט שמשנים בין
   הצעה להצעה. מה שכאן הוא מה שעינב ביקשה לשלוט בו. */

export default function SectionSigning({ signing, vars, nClients, readOnly, f }) {
  if (!signing) return null

  /* ⚠️ ctaLabel לא קיים באף תבנית שמורה (נבדק ב-Prod), ולכן השדה
     ייפתח ריק וייראה כאילו אין נוסח — בזמן שללקוח מוצג הנוסח
     שבקוד. הזנת ברירת המחדל כערך ההתחלתי מראה כאן בדיוק את מה
     שהלקוח רואה. כל עוד לא עורכים, שום דבר לא נשמר ושני הצדדים
     ממשיכים לקרוא את אותו קבוע. */
  const cta = isFilled(signing.ctaLabel) ? signing.ctaLabel : SIGN_CTA_FALLBACK

  return (
    <div className="qe-sec">
      <h2><span className="qe-n">5</span>החתימה</h2>

      <div className="qe-pad">
        <div className="qe-note">
          הכפתור מופיע בסוף ההצעה בטלפון ומוביל אל ההצעה המלאה, ששם חותמים.
        </div>

        <LinkedField
          label="כפתור המעבר אל ההצעה המלאה" disabled={readOnly}
          {...f.bind(signing.id, 'ctaLabel', cta)}
        />
        <LinkedField
          label="כותרת אחרי החתימה" disabled={readOnly}
          {...f.bind(signing.id, 'doneHeadline', signing.doneHeadline)}
        />
        <LinkedField
          label="טקסט אחרי החתימה" textarea rows={3} disabled={readOnly}
          {...f.bind(signing.id, 'doneBody', signing.doneBody)}
        />
      </div>
    </div>
  )
}
