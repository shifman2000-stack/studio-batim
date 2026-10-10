import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../supabaseClient'
import { partitionEdits, previewOf } from '../../../lib/quoteV2/templateAssist'

/* ═══════════════════════════════════════════════════════════════════════
   העוזר של עינב — צ׳אט לצד טופס הצעת המחיר

   ⚠️ העוזר **לא כותב לתוכן**. הוא מחזיר רשימת פעולות ממוקדות-id,
   וכל אחת מהן עוברת את ה-validators של templateAssist לפני שהיא
   מוצגת. הצעה שמאבדת {{משתנה}}, ששוברת {יחיד|רבים} או שמצביעה על
   id שלא קיים — נזרקת כאן, לפני שעינב רואה אותה, והמודל מתבקש
   פעם אחת לתקן. אחרי זה היא פשוט לא מוצעת.

   עינב מאשרת כל הצעה בנפרד. אישור מחיל אותה על המצב **המקומי**
   בלבד; מה ששומר הוא כפתור "שמירת תבנית" הקיים, על כל מנגנון
   הגיבוי והכתיבה המאומתת שלו.
   ═══════════════════════════════════════════════════════════════════════ */

const RETRY_NOTE = (reasons) =>
  `חלק מההצעות נפסלו באימות: ${reasons.join(' · ')}. ` +
  'תקן/י אותן ושלח/י שוב — חובה לשמר כל {{משתנה}}, כל חלופת {יחיד|רבים} וכל [[קטע מותנה]].'

export default function AssistantPanel({ content, twoClients, onApply, onClose }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState([])      // [{ edit, preview, state }]
  const endRef = useRef(null)
  const contentRef = useRef(content)
  contentRef.current = content

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages, pending, busy])

  const callAssistant = async (history, retryOf) => {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('ההתחברות פגה. יש לרענן את הדף.')

    const res = await fetch('/api/template-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: history, content: contentRef.current }),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(out.error || 'העוזר לא זמין כרגע.')
    return out
  }

  const send = async (text) => {
    const clean = String(text ?? '').trim()
    if (!clean || busy) return
    setError('')
    setInput('')
    const history = [...messages, { role: 'user', content: clean }]
    setMessages(history)
    setBusy(true)

    try {
      let out = await callAssistant(history)
      let { valid, invalid } = partitionEdits(contentRef.current, out.edits)

      /* הזדמנות אחת לתקן — ורק אם לא נשאר כלום תקין. */
      if (invalid.length && !valid.length) {
        const retryHistory = [
          ...history,
          { role: 'assistant', content: out.reply || '(הצעות)' },
          { role: 'user', content: RETRY_NOTE(invalid.map(i => i.reason)) },
        ]
        out = await callAssistant(retryHistory)
        const second = partitionEdits(contentRef.current, out.edits)
        valid = second.valid
        invalid = second.invalid
      }

      setMessages(m => [...m, {
        role: 'assistant',
        content: out.reply || (valid.length ? 'הנה ההצעות:' : 'לא הצלחתי להציע עריכה בטוחה.'),
        dropped: invalid.length,
      }])
      setPending(valid.map(edit => ({
        edit,
        preview: previewOf(contentRef.current, edit, twoClients),
        state: 'open',
      })))
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const decide = (i, state) => {
    setPending(p => p.map((x, k) => (k === i ? { ...x, state } : x)))
    if (state === 'approved') onApply([pending[i].edit])
  }

  const approveAll = () => {
    const open = pending.filter(p => p.state === 'open')
    if (!open.length) return
    onApply(open.map(p => p.edit))
    setPending(p => p.map(x => (x.state === 'open' ? { ...x, state: 'approved' } : x)))
  }

  const openCount = pending.filter(p => p.state === 'open').length

  return (
    <aside className="qe-chat">
      <div className="qe-chat-top">
        <b>עוזר העריכה</b>
        <span className="qe-sp" />
        <button type="button" className="qe-ic" title="סגירה" onClick={onClose}>✕</button>
      </div>

      <div className="qe-chat-body">
        {messages.length === 0 && (
          <div className="qe-chat-hint">
            אפשר לבקש בשפה חופשית. לדוגמה:
            <ul>
              <li>בשלב 2 תוריד את המשפט על ה-VR</li>
              <li>תנסח את תנאי ההשהיה ברכות</li>
              <li>תוסיף שלב של ליווי תאורה בסוף</li>
            </ul>
            כל הצעה תגיע לאישור שלך, ושום דבר לא נשמר עד "שמירת תבנית".
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={'qe-msg ' + (m.role === 'user' ? 'me' : 'bot')}>
            {m.content}
            {m.dropped > 0 && (
              <div className="qe-msg-note">
                {m.dropped === 1 ? 'הצעה אחת נפסלה' : `${m.dropped} הצעות נפסלו`} באימות התחביר ולא הוצגו.
              </div>
            )}
          </div>
        ))}

        {pending.length > 0 && (
          <div className="qe-props">
            {openCount > 1 && (
              <button type="button" className="qe-b pri qe-approveall" onClick={approveAll}>
                ✓ אישור הכל ({openCount})
              </button>
            )}
            {pending.map((p, i) => (
              <div key={i} className={'qe-prop ' + p.state}>
                <div className="qe-prop-head">
                  <span>{p.edit.reason || 'עריכה'}</span>
                  {p.preview.binding && <span className="qe-binding">שינוי בנוסח המחייב</span>}
                </div>
                <div className="qe-prop-diff">
                  <div className="qe-prop-before">{p.preview.before || '—'}</div>
                  <div className="qe-prop-after">{p.preview.after || '—'}</div>
                </div>
                {p.state === 'open' ? (
                  <div className="qe-prop-act">
                    <button type="button" className="qe-b pri" onClick={() => decide(i, 'approved')}>✓ אישור</button>
                    <button type="button" className="qe-b" onClick={() => decide(i, 'rejected')}>✗ דחייה</button>
                  </div>
                ) : (
                  <div className="qe-prop-state">{p.state === 'approved' ? '✓ אושר' : '✗ נדחה'}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {busy && <div className="qe-msg bot qe-thinking">Claude חושב…</div>}
        {error && <div className="qe-warn">{error}</div>}
        <div ref={endRef} />
      </div>

      <form
        className="qe-chat-form"
        onSubmit={e => { e.preventDefault(); send(input) }}
      >
        <textarea
          value={input}
          rows={2}
          disabled={busy}
          placeholder="מה לשנות בטופס?"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
          }}
        />
        <button type="submit" className="qe-b pri" disabled={busy || !input.trim()}>שליחה</button>
      </form>
    </aside>
  )
}
