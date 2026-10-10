import { useState } from 'react'
import { Modal } from './bits'
import { sendChecklist, waLink } from '../../../lib/quoteV2/validate'
import { describeTemplateChanges } from '../../../lib/quoteV2/templateSync'

/* ═══════════════════════════════════════════════════════════════════════
   דיאלוג השליחה — C.3 + C.4

   שלושה מסכים ברצף, באותה תיבה:
   1. צ׳קליסט. כל מה שלא ✓ חוסם, ואי אפשר להתקדם.
   2. "לעדכן גם את התבנית?" — **ברירת המחדל לא**, ומופיעה רק אם
      באמת משהו שונה מהתבנית.
   3. הקישור: וואטסאפ או העתקה.

   ⚠️ השאלה על התבנית נשאלת פעם אחת, כאן, ולא בכל עריכה — זו
   הנקודה שבה עינב ממילא עוצרת לחשוב (החלטה 35).
   ═══════════════════════════════════════════════════════════════════════ */

export default function SendDialog({ content, template, link, sending, error, onSend, onClose, onCopy }) {
  const [alsoTemplate, setAlsoTemplate] = useState(false)

  const checks = sendChecklist(content)
  const blocked = checks.some(c => !c.ok)
  const changes = template ? describeTemplateChanges(template, content) : []

  /* מסך 3 — נשלח */
  if (link) {
    const phone = content?.clients?.[0]?.phone
    const names = content?.vars?.firstNames
    return (
      <Modal onClose={onClose}>
        <h3>ההצעה נשלחה ✓</h3>
        <p>הקישור חי. אפשר לשלוח אותו בוואטסאפ או להעתיק.</p>
        <code className="qe-link">{link}</code>
        <div className="qe-row">
          {phone
            ? <a className="qe-b wa" href={waLink(phone, names, link)} target="_blank" rel="noreferrer">שליחה בוואטסאפ</a>
            : <span className="qe-opt">אין טלפון בפנייה — אפשר רק להעתיק</span>}
          <button type="button" className="qe-b" onClick={() => onCopy(link)}>העתקת קישור</button>
          <button type="button" className="qe-b" onClick={onClose}>סגירה</button>
        </div>
      </Modal>
    )
  }

  /* מסכים 1-2 */
  return (
    <Modal onClose={onClose}>
      <h3>שליחה ללקוח</h3>

      {checks.map((c, i) => (
        <div className="qe-ck" key={i}>
          <span className={c.ok ? 'ok' : 'no'}>{c.ok ? '✓' : '!'}</span>
          <span>{c.text}</span>
        </div>
      ))}

      {!blocked && changes.length > 0 && (
        <>
          <p style={{ margin: '16px 0 6px' }}>
            שינית {changes.length === 1 ? 'דבר אחד' : `${changes.length} דברים`} לעומת התבנית.
          </p>
          <label className="qe-ck" style={{ cursor: 'pointer', borderBottom: 0 }}>
            <input type="checkbox" checked={alsoTemplate} onChange={e => setAlsoTemplate(e.target.checked)} />
            <span>לעדכן גם את התבנית לפעם הבאה?</span>
          </label>
          <div className="qe-opt" style={{ marginInlineStart: 26 }}>
            {changes.slice(0, 6).map(c => c.label).join(' · ')}
            {changes.length > 6 ? ` ועוד ${changes.length - 6}` : ''}
            <br />
            מה שהסרת מההצעה יישאר בתבנית — עדכון בלבד, בלי מחיקה.
          </div>
        </>
      )}

      {error && <div className="qe-ck"><span className="no">!</span><span>{error}</span></div>}

      <div className="qe-row">
        {!blocked && (
          <button type="button" className="qe-b pri" disabled={sending} onClick={() => onSend({ alsoTemplate })}>
            {sending ? 'שולח…' : 'שליחה →'}
          </button>
        )}
        <button type="button" className="qe-b" onClick={onClose}>
          {blocked ? 'חזרה לתיקון' : 'ביטול'}
        </button>
      </div>
    </Modal>
  )
}
