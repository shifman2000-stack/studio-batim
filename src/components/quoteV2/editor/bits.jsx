import { useEffect } from 'react'

/* חלקים קטנים וחוזרים של העורך. */

/** כרטיס מתקפל — כותרת לחיצה, פעולות, וגוף שנפתח. */
export function Card({ num, title, sub, open, onToggle, onUp, onDown, onRemove, canUp, canDown, readOnly, children }) {
  const stop = fn => e => { e.stopPropagation(); fn?.() }
  return (
    <div className={'qe-card' + (open ? ' open' : '')}>
      <div className="qe-ch" onClick={onToggle}>
        <span className="qe-num">{num}</span>
        <div className="qe-t">
          <b>{title || <span style={{ color: '#c0653a' }}>ללא שם</span>}</b>
          {sub && <span>{sub}</span>}
        </div>
        {!readOnly && (
          <div className="qe-act">
            {onUp && <button type="button" className="qe-ic" title="למעלה" disabled={!canUp} onClick={stop(onUp)}>▲</button>}
            {onDown && <button type="button" className="qe-ic" title="למטה" disabled={!canDown} onClick={stop(onDown)}>▼</button>}
            {onRemove && <button type="button" className="qe-ic" title="הסרה" onClick={stop(onRemove)}>🗑</button>}
          </div>
        )}
        <button type="button" className="qe-edit">{open ? 'סגירה' : readOnly ? 'צפייה' : 'עריכה'}</button>
      </div>
      {open && <div className="qe-body">{children}</div>}
    </div>
  )
}

/** שני החצאים שבתוך כרטיס פתוח — הכתוב והשיווקי. */
export function Faces({ written, marketing, writtenTitle, marketingTitle }) {
  return (
    <div className="qe-faces">
      <div className="qe-face">
        <h4><i>📄</i>{writtenTitle ?? 'בהצעה הכתובה'}</h4>
        {written}
      </div>
      <div className="qe-face">
        <h4><i>📱</i>{marketingTitle ?? 'במה שהלקוח רואה בטלפון'}</h4>
        {marketing}
      </div>
    </div>
  )
}

/** שדה טקסט רגיל — בלי מנגנון מקושר/קפוא (שמות, מספרים). */
export function Field({ label, value, onChange, hint, placeholder, textarea, rows, disabled, inputMode }) {
  const Tag = textarea ? 'textarea' : 'input'
  return (
    <div className="qe-f">
      <label>{label}</label>
      <Tag
        value={value ?? ''}
        placeholder={placeholder}
        inputMode={inputMode}
        rows={textarea ? (rows ?? 3) : undefined}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
      {hint && <div className="qe-opt">{hint}</div>}
    </div>
  )
}

/** מודאל. Esc סוגר, ולחיצה על הרקע סוגרת. */
export function Modal({ onClose, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="qe-mo" onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="qe-mbox">{children}</div>
    </div>
  )
}

export function Toast({ text }) {
  return <div className={'qe-toast' + (text ? ' show' : '')}>{text}</div>
}
