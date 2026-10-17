import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import QuotePublic from './QuotePublic'
import QuoteSignV2 from './QuoteSignV2'

/* ═══════════════════════════════════════════════════════════════════════
   /quote/:token — נקודת ההסתעפות היחידה בין v1 ל-v2.

   ⚠️ זה הקובץ היחיד בכל שלב D שנוגע בלקוחות קיימים, ולכן הוא
   מכוון להיות הקצר ביותר שאפשר: קריאת RPC אחת, בדיקה אחת, שתי
   החזרות.

   כלל הזהב: **רק schema === 2 מפורש הולך ל-v2.** שגיאה, טוקן שלא
   נמצא, content ריק, או כל ערך אחר — נופלים ל-QuotePublic, שהוא
   בדיוק הקובץ של היום, בלי שורה אחת שונה. הוא טוען את הטוקן שוב
   בעצמו; קריאת RPC כפולה בטעינה אחת, וזה המחיר הנכון לכך ש-v1
   לא תלוי בשום דבר חדש.
   ═══════════════════════════════════════════════════════════════════════ */

const MSG = {
  position: 'fixed', inset: 0, display: 'flex',
  alignItems: 'center', justifyContent: 'center',
  background: '#e5e2dc', color: '#1a1a18', zIndex: 50,
  fontFamily: 'Heebo, sans-serif', direction: 'rtl',
}

/**
 * @param {'journey'|'full'} [view] איזה מבט של v2 לפתוח. ⚠️ לא רלוונטי
 *   ל-v1: ל-QuotePublic אין מסמך מלא נפרד, ו-/quote/:token/full על
 *   הצעת v1 נופל אל אותו מסך שהיה — עדיף מ-404 על קישור שנשלח.
 */
export default function QuoteRouter({ view = 'journey' }) {
  const { token } = useParams()
  const [schema, setSchema] = useState(undefined)   // undefined = עדיין בודקים

  useEffect(() => {
    if (!token) { setSchema(null); return }
    let cancelled = false
    const check = async () => {
      try {
        const { data, error } = await supabase.rpc('get_quote_by_token', { p_token: token })
        const ver = Array.isArray(data) && data.length > 0 ? data[0] : null
        if (!cancelled) setSchema(error ? null : (ver?.content?.schema ?? null))
      } catch {
        if (!cancelled) setSchema(null)   // כל כשל → v1
      }
    }
    check()
    return () => { cancelled = true }
  }, [token])

  if (schema === undefined) return <div style={MSG}>טוען…</div>
  return schema === 2 ? <QuoteSignV2 view={view} /> : <QuotePublic />
}
