import { displayValue, canRestore } from '../../../lib/quoteV2/linked'

/* ═══════════════════════════════════════════════════════════════════════
   שדה מקושר/קפוא — C.5 (החלטה 36)

   זה הרכיב היחיד בעורך שמותר לו לדעת שקיים תחביר. כל שאר העורך
   עובד מול טקסט רגיל.

   · מקושר  — מציג את הטקסט פתור; מתעדכן לבד עם מספר הלקוחות
              ועם השטחים.
   · קפוא    — מציג ושומר בדיוק מה שעינב הקלידה, ומראה ↺.

   המעבר בין המצבים קורה ברגע ההקלדה הראשונה, בלי שאלה ובלי כפתור:
   מה שעינב רואה בשדה כשהיא מתחילה להקליד הוא הטקסט הפתור, ולכן
   העריכה שלה מתחילה מהניסוח ולא מהתחביר.
   ═══════════════════════════════════════════════════════════════════════ */

export default function LinkedField({
  label, value, frozen, templateRaw, vars, clientCount,
  onChange, onRestore, textarea, hint, rows, disabled, placeholder,
  grammar,
}) {
  const shown = displayValue({ raw: value, frozen, vars, clientCount })
  const showUndo = canRestore({ frozen, templateRaw }) && !disabled
  const Tag = textarea ? 'textarea' : 'input'

  /* ── עריכת תבנית: שדה עם חלופות יחיד/רבים ─────────────────────────
     בהצעה רגילה אין מצב כזה — שם מספר הלקוחות ידוע ויש ניסוח אחד.
     בתבנית שני הניסוחים חיים זה לצד זה, ועינב חייבת לראות את שניהם
     כדי לערוך אותם. היא עדיין לא רואה שום תחביר: שתי תיבות רגילות,
     וההרכבה חזרה ל-{יחיד|רבים} קורית בשמירה. */
  if (grammar) {
    return (
      <div className="qe-f">
        <label className="qe-lab"><span>{label}</span></label>
        <div className="qe-gram">
          <div>
            <span className="qe-gram-l">ללקוח אחד</span>
            <Tag
              value={grammar.singular ?? ''}
              disabled={disabled}
              rows={textarea ? (rows ?? 3) : undefined}
              onChange={e => grammar.onChange('singular', e.target.value)}
            />
          </div>
          <div>
            <span className="qe-gram-l">לשני לקוחות</span>
            <Tag
              value={grammar.plural ?? ''}
              disabled={disabled}
              rows={textarea ? (rows ?? 3) : undefined}
              onChange={e => grammar.onChange('plural', e.target.value)}
            />
          </div>
        </div>
        {hint && <div className="qe-opt">{hint}</div>}
      </div>
    )
  }

  return (
    <div className="qe-f">
      <label className="qe-lab">
        <span>{label}</span>
        <span className="qe-sp" />
        {frozen && !showUndo && <span className="qe-manual">נערך ידנית</span>}
        {showUndo && (
          <button
            type="button"
            className="qe-undo"
            title="הטקסט יחזור לנוסח מהתבנית, ויתעדכן שוב לבד"
            onClick={onRestore}
          >
            ↺ חזרה לנוסח האוטומטי
          </button>
        )}
      </label>
      <Tag
        value={shown}
        disabled={disabled}
        placeholder={placeholder}
        rows={textarea ? (rows ?? 3) : undefined}
        onChange={e => onChange(e.target.value)}
      />
      {hint && <div className="qe-opt">{hint}</div>}
    </div>
  )
}
