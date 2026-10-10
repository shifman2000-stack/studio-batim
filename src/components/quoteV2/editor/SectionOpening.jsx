import LinkedField from './LinkedField'
import { Field } from './bits'
import { displayValue } from '../../../lib/quoteV2/linked'

/* 1 · פתיחה — מי הלקוח, איפה, ואיך ההצעה נפתחת אצלו בטלפון. */

export default function SectionOpening({
  content, opening, scope, extras, vars, nClients, readOnly, hideClientFields,
  f, onClient, onRemoveSecond, onProperty,
  onToggleExtra, onAddExtra, onRemoveExtra, onPatch,
}) {
  const c0 = content?.clients?.[0] ?? {}
  const c1 = content?.clients?.[1] ?? {}
  const second = [c1.firstName, c1.lastName].filter(Boolean).join(' ')

  return (
    <div className="qe-sec">
      <h2><span className="qe-n">1</span>פתיחה</h2>

      <div className="qe-pad">
        {/* בעריכת התבנית אין לקוח אמיתי לערוך — רק דוגמה שמוצגת
            בשורה שמעל, ולכן השדות האלה פשוט לא קיימים כאן. */}
        {hideClientFields ? null : <>
        <div className="qe-two">
          <Field label="שם פרטי" value={c0.firstName} disabled={readOnly}
            onChange={v => onClient(0, { firstName: v })} />
          <Field label="שם משפחה" value={c0.lastName} disabled={readOnly}
            onChange={v => onClient(0, { lastName: v })} />
        </div>
        <div className="qe-two">
          <Field label="טלפון" value={c0.phone} disabled={readOnly} inputMode="tel"
            onChange={v => onClient(0, { phone: v })} />
          <Field label="יישוב" value={content?.property?.settlement} disabled={readOnly}
            onChange={v => onProperty({ settlement: v })} />
        </div>

        <div className="qe-f">
          <label className="qe-lab">
            <span>לקוח/ה נוסף/ת</span>
            <span className="qe-sp" />
            {second && !readOnly && (
              <button type="button" className="qe-undo" onClick={onRemoveSecond}>הסרה</button>
            )}
          </label>
          <input
            value={second}
            disabled={readOnly}
            placeholder="אם יש — ההצעה תעבור אוטומטית לפנייה בלשון רבים"
            onChange={e => {
              const parts = e.target.value.trim().split(/\s+/)
              onClient(1, { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') })
            }}
          />
        </div>

        <div className="qe-two">
          <Field label="שטח הבית (מ״ר)" value={content?.property?.houseArea} inputMode="numeric"
            placeholder="לא חובה" disabled={readOnly} onChange={v => onProperty({ houseArea: v })} />
          <Field label="שטח המגרש (מ״ר)" value={content?.property?.plotArea} inputMode="numeric"
            placeholder="לא חובה" disabled={readOnly} onChange={v => onProperty({ plotArea: v })} />
        </div>
        <div className="qe-opt" style={{ margin: '-4px 0 14px' }}>
          מופיעים בשרטוט הבית בטלפון. אם ריקים — פשוט לא יופיעו.
        </div>
        </>}

        {opening && (
          <>
            <div className="qe-opt">כך תיפתח ההצעה בטלפון:</div>
            <div className="qe-hello">
              {displayValue({ raw: opening.greeting, frozen: f.frozen(opening.id, 'greeting'), vars, clientCount: nClients })}
            </div>
            <LinkedField
              label="שורת הפתיחה" textarea rows={3} disabled={readOnly}
              hint="ללקוחה אחת? פשוט לשנות כאן ל״בואי נבנה לך בית״."
              {...f.bind(opening.id, 'greeting', opening.greeting)}
            />
            <LinkedField
              label="פסקת פתיחה בטלפון" textarea rows={4} disabled={readOnly}
              {...f.bind(opening.id, 'intro', opening.intro)}
            />
          </>
        )}

        {scope && (
          <LinkedField
            label="תכולת השירות בהצעה הכתובה" textarea rows={6} disabled={readOnly}
            {...f.bind(scope.id, 'body', scope.body)}
          />
        )}
      </div>

      {extras && (extras.items ?? []).map(x => (
        <div className="qe-toggle" key={x.id}>
          <div className="qe-t">
            <b>{x.title || 'תוספת'}</b>
            <span>{x.sub}</span>
          </div>
          {!readOnly && (
            <>
              <button type="button" className="qe-ic" title="הסרה" onClick={() => onRemoveExtra(x.id)}>🗑</button>
              <button
                type="button"
                className={'qe-tg' + (x.enabled === false ? '' : ' on')}
                aria-label={x.enabled === false ? 'הדלקה' : 'כיבוי'}
                onClick={() => onToggleExtra(x.id)}
              />
            </>
          )}
        </div>
      ))}
      {extras && !readOnly && (
        <button type="button" className="qe-add" onClick={onAddExtra}>+ תוספת</button>
      )}

      {extras && (extras.items ?? []).some(x => x.enabled !== false) && !readOnly && (
        <div className="qe-note">
          תוספת כבויה נשארת בהצעה ולא מוצגת ללקוח. אפשר להדליק אותה שוב בכל רגע.
        </div>
      )}

      {/* עריכת הכותרת והטקסט של התוספות עצמן — מתחת לטוגלים, כי זה
          נדיר יותר מהדלקה וכיבוי. */}
      {extras && !readOnly && (extras.items ?? []).map(x => (
        <details key={'d' + x.id} style={{ padding: '0 20px 10px' }}>
          <summary className="qe-opt" style={{ cursor: 'pointer' }}>עריכת הטקסט של ״{x.title || 'תוספת'}״</summary>
          <div style={{ paddingTop: 8 }}>
            <Field label="שם התוספת" value={x.title} onChange={v => onPatch(x.id, { title: v })} />
            <Field label="תיאור קצר" value={x.sub} onChange={v => onPatch(x.id, { sub: v })} />
          </div>
        </details>
      ))}
    </div>
  )
}
