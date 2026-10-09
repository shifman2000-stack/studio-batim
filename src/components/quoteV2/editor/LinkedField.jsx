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
}) {
  const shown = displayValue({ raw: value, frozen, vars, clientCount })
  const showUndo = canRestore({ frozen, templateRaw }) && !disabled
  const Tag = textarea ? 'textarea' : 'input'

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
