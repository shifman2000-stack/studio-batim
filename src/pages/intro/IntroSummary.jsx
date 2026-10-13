// src/pages/intro/IntroSummary.jsx
//
// Area 02 — "סיכום פגישה". One free-text field, saved as you type.
//
// The editor is the app's own RichTextEditor — the same one the project
// card's סיכומי פגישות tab uses, with the same toolbar and the same
// HTML-into-a-text-column storage. Not a second editor that would drift
// from it.
//
// Stored on the inquiry itself, in intro_meeting_summary. The column is
// added by docs/sql/intro-meeting-summary.sql, which is NOT run from
// here; until it exists every save answers with an error, and this
// screen says so in Hebrew instead of silently losing what was typed.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import RichTextEditor from '../../components/meetings/RichTextEditor'
import '../../components/meetings/MeetingSummariesTab.css'

export default function IntroSummary({ inquiryId }) {
  const [value, setValue] = useState(null)      // null until loaded
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    let cancelled = false
    supabase.from('inquiries').select('intro_meeting_summary').eq('id', inquiryId).maybeSingle()
      .then(({ data, error: e }) => {
        if (cancelled) return
        /* A missing column answers with an error, not with a null row —
           that is the "SQL not run yet" case, and it must not read as an
           empty summary that the first keystroke then overwrites. */
        if (e) { setError(COLUMN_HINT); setValue('') ; return }
        setValue(data?.intro_meeting_summary ?? '')
      })
    return () => { cancelled = true }
  }, [inquiryId])

  /* Debounced, and never before the row has loaded. */
  const onChange = (html) => {
    setValue(html)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const { error: e } = await supabase
        .from('inquiries').update({ intro_meeting_summary: html }).eq('id', inquiryId)
      if (e) { setError(COLUMN_HINT); return }
      setError('')
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    }, 700)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  if (value === null) return <p className="im-caption">טוען…</p>

  return (
    <>
      <p className="im-caption">
        {error || (saved ? '✓ נשמר' : 'נשמר אוטומטית תוך כדי כתיבה')}
      </p>
      <div className="im-summary">
        <RichTextEditor
          value={value}
          onChange={onChange}
          ariaLabel="סיכום פגישת היכרות"
          placeholder="מה סוכם בפגישה…"
        />
      </div>
    </>
  )
}

const COLUMN_HINT =
  'השמירה נכשלה — נראה שעמודת intro_meeting_summary עדיין לא קיימת. ' +
  'יש להריץ את docs/sql/intro-meeting-summary.sql.'
