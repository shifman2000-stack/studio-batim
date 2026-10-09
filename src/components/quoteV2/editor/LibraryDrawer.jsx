import { useMemo, useState } from 'react'
import { Modal } from './bits'

/* ═══════════════════════════════════════════════════════════════════════
   מגירת הספרייה — C.2

   סינון לפי טקסט חופשי ולפי תגית. דרך התגית `בריכה` מגיעים גם
   לווריאנט הבריכה פריט-פריט, למי שרוצה רק שלב אחד ממנו; ההחלפה
   המלאה בלחיצה אחת יושבת בסעיף עצמו ולא כאן.
   ═══════════════════════════════════════════════════════════════════════ */

export default function LibraryDrawer({ title, type, items, onPick, onClose, emptyLabel, onPickEmpty }) {
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')

  const ofType = useMemo(
    () => (items ?? []).filter(r => r?.type === type && !r?.archived),
    [items, type])

  const tags = useMemo(() => {
    const all = new Set()
    for (const r of ofType) for (const t of r?.tags ?? []) all.add(t)
    return [...all].sort((a, b) => a.localeCompare(b, 'he'))
  }, [ofType])

  const shown = useMemo(() => {
    const needle = q.trim()
    return ofType.filter(r => {
      if (tag && !(r?.tags ?? []).includes(tag)) return false
      if (!needle) return true
      const hay = [r?.title, ...(r?.tags ?? []), JSON.stringify(r?.payload ?? {})].join(' ')
      return hay.includes(needle)
    })
  }, [ofType, q, tag])

  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>

      <input
        className="qe-search"
        value={q}
        placeholder="חיפוש בטקסט…"
        onChange={e => setQ(e.target.value)}
      />
      {tags.length > 0 && (
        <div className="qe-tags">
          <button type="button" className={'qe-tag' + (tag === '' ? ' on' : '')} onClick={() => setTag('')}>הכול</button>
          {tags.map(t => (
            <button key={t} type="button" className={'qe-tag' + (tag === t ? ' on' : '')} onClick={() => setTag(t)}>{t}</button>
          ))}
        </div>
      )}

      {shown.length === 0 && <p style={{ color: '#8a8680' }}>אין פריטים מתאימים.</p>}
      {shown.map(r => (
        <button key={r.id} type="button" className="qe-li" onClick={() => onPick(r)}>
          <div>
            <b>{r.title}</b>
            <span>{(r.tags ?? []).join(' · ')}</span>
          </div>
          <span>+</span>
        </button>
      ))}

      {onPickEmpty && (
        <button type="button" className="qe-li" onClick={onPickEmpty}>
          <div><b>{emptyLabel}</b><span>כותבים מאפס</span></div>
          <span>+</span>
        </button>
      )}

      <div className="qe-row">
        <button type="button" className="qe-b" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  )
}
