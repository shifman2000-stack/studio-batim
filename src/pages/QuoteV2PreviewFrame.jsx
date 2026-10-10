import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import QuoteJourneyV2 from '../components/quoteV2/QuoteJourneyV2'

/* ═══════════════════════════════════════════════════════════════════════
   /quotes-v2/preview-frame — המסע בתוך iframe, לתצוגה המקדימה בעורך

   ⚠️ הקובץ הזה קיים כדי לתת למסע **viewport אמיתי**.

   המסע נשען על רוחב וגובה החלון: media queries שמחליפות בין פריסת
   הטלפון לפריסת המחשב, הציור שננעץ בראש המסך בטלפון, ומכל גלילה
   משלו. בתוך div על מסך רחב כל אלה נמדדים מול חלון הדפדפן ולא מול
   התיבה, ולכן התצוגה המקדימה הראתה פריסת מחשב בתוך מסגרת טלפון.
   iframe פותר את זה מהשורש: יש לו viewport משלו.

   ה-content מגיע ב-postMessage ולא מהמסד — כך התצוגה מראה את מה
   שעינב עורכת **ברגע זה**, לפני שנשמר.

   השלד כאן זהה ל-QuoteSignV2: אותו div חיצוני, אותם סגנונות. מה
   שלא מועבר הוא ה-prop `client`, ובלעדיו המסע נכנס למצב תצוגה —
   הפדים מושבתים וכפתור החתימה מת.
   ═══════════════════════════════════════════════════════════════════════ */

/* זהה ל-SHELL ב-QuoteSignV2.jsx. אם זה ישתנה שם, שיישתנה גם כאן —
   כל ההבדל בין התצוגה המקדימה למה שהלקוח רואה מתחיל בשורה כזו. */
const SHELL = {
  position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
  background: '#16201d', zIndex: 50,
}
const MSG = {
  ...SHELL, alignItems: 'center', justifyContent: 'center',
  color: '#efe7d8', fontFamily: 'Heebo, sans-serif', direction: 'rtl',
  padding: 40, textAlign: 'center',
}

export default function QuoteV2PreviewFrame() {
  const [allowed, setAllowed] = useState(null)   // null = בודקים
  const [content, setContent] = useState(null)

  /* admin בלבד, כמו שאר מסכי v2. בתוך iframe לא מנווטים לשום מקום —
     פשוט לא מציגים. הסשן משותף עם ההורה (אותו origin). */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { if (!cancelled) setAllowed(false); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (!cancelled) setAllowed(profile?.role === 'admin')
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onMessage = (e) => {
      /* אותו origin בלבד — ההורה הוא העורך, ושום דף אחר לא אמור
         להזרים לכאן תוכן. */
      if (e.origin !== window.location.origin) return
      if (e.data?.type !== 'quote-v2-preview') return
      setContent(e.data.content ?? null)
    }
    window.addEventListener('message', onMessage)
    /* ההורה לא יודע מתי ה-iframe מוכן לקבל; לכן אנחנו מודיעים לו. */
    window.parent?.postMessage({ type: 'quote-v2-preview-ready' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  if (allowed === false) return <div style={MSG}>אין הרשאה.</div>
  if (!content) return <div style={SHELL} />

  return (
    <div style={SHELL}>
      <QuoteJourneyV2 content={content} />
    </div>
  )
}
