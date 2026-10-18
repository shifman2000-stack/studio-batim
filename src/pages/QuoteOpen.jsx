// src/pages/QuoteOpen.jsx
//
// /quote-open/:inquiryId — the ONE door to an inquiry's quote.
//
// It decides nothing about how a quote looks; it only answers "which
// screen owns this inquiry's quote", and then gets out of the way:
//
//   · the inquiry already has a quote  → open it BY ITS OWN SCHEMA.
//     A v1 draft opens in the v1 builder forever, whatever the flag
//     says (design decision 18 — moving to v2 is an explicit act that
//     creates a new quote, never a silent conversion).
//   · no quote yet, flag on  → create a v2 draft from the default
//     template and open the v2 editor.
//   · no quote yet, flag off → the v1 builder, exactly as today.
//
// ⚠️ "Already has a quote" means the one with the HIGHEST quote_number.
// An inquiry can hold several (phase 0 left v1 quotes behind a v2 one),
// and the newest is the one being worked on.
//
// Creating here is a deliberate choice. The v1 builder creates nothing
// until "save", but the v2 editor is keyed by a quote id and has
// nowhere to go without a row. The row it writes is a draft and
// nothing else: no version, no token, no template change.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { buildQuoteV2Content } from '../lib/quoteV2/content'
import { V2_FOR_NEW_QUOTES, isV2Quote, latestQuoteOf } from '../lib/quoteV2/launch'
import { singularizeForClient } from '../lib/quoteV2/singularize'

export default function QuoteOpen() {
  const { inquiryId } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).maybeSingle()
      if (cancelled) return
      if (profile?.role !== 'admin') { navigate('/dashboard'); return }

      const toV1 = () => navigate(`/quote-builder/${inquiryId}`, { replace: true })

      const { data: quotes, error: qErr } = await supabase
        .from('quotes').select('id, quote_number, status, draft_content')
        .eq('inquiry_id', inquiryId)
      if (cancelled) return
      if (qErr) { setError('טעינת ההצעות נכשלה: ' + qErr.message); return }

      const latest = latestQuoteOf(quotes)
      if (latest) {
        if (isV2Quote(latest)) navigate(`/quotes-v2/${latest.id}`, { replace: true })
        else toV1()
        return
      }

      if (!V2_FOR_NEW_QUOTES) { toV1(); return }

      /* ── A new v2 draft ── */
      const [{ data: tpl }, { data: inq }] = await Promise.all([
        supabase.from('quote_templates').select('content').eq('is_default', true).maybeSingle(),
        supabase.from('inquiries').select('*').eq('id', inquiryId).maybeSingle(),
      ])
      if (cancelled) return
      if (!tpl?.content?.sections || !inq) {
        /* No template to build from is not a reason to strand anyone —
           the v1 builder still works, and says so in the console. */
        console.warn('quote-open: no default template or inquiry; falling back to v1')
        toV1()
        return
      }

      let content = buildQuoteV2Content(tpl.content, inq, {})

      /* ── מזמין אחד → המרה ליחיד ─────────────────────────────────
         התבנית כתובה ברבים. הצעה עם מזמין אחד מומרת פעם אחת,
         כאן, ומכאן והלאה הטקסט הוא טקסט רגיל שאפשר לערוך.
         ⚠️ כישלון לא עוצר כלום: ההצעה נוצרת ברבים ומסומנת
         ב-singularizePending, והעורך מציג "נסה שוב". */
      if ((content.clients ?? []).length === 1) {
        setNote('מתאים את הנוסח ללקוח יחיד…')
        const r = await singularizeForClient(content, { firstName: content.clients[0]?.firstName })
        if (cancelled) return
        if (r.ok) content = r.content
        else content = { ...content, singularizePending: true, singularizeError: r.error }
      }
      setNote('')
      /* max+1 over the inquiry's own quotes, falling back to 1 — the same
         number QuoteBuilder would have picked, so v1 and v2 numbers can
         never collide on one inquiry. */
      const nextNumber = (quotes ?? []).reduce((m, r) => Math.max(m, r.quote_number || 0), 0) + 1

      const { data: created, error: insErr } = await supabase.from('quotes')
        .insert([{ inquiry_id: inquiryId, quote_number: nextNumber, status: 'draft', draft_content: content }])
        .select('id').single()
      if (cancelled) return
      if (insErr) {
        setError(insErr.message.includes('quotes_inquiry_id_quote_number_key')
          ? 'יצירת ההצעה נכשלה: כבר קיימת הצעה עם אותו מספר לפנייה הזו. רענני ונסי שוב.'
          : 'יצירת ההצעה נכשלה: ' + insErr.message)
        return
      }
      navigate(`/quotes-v2/${created.id}`, { replace: true })
    }

    run()
    return () => { cancelled = true }
  }, [inquiryId, navigate])

  return (
    <div dir="rtl" style={{ padding: 40, fontFamily: 'Heebo, sans-serif', color: error ? '#c0653a' : '#8a8680' }}>
      {error || note || 'פותח את הצעת המחיר…'}
    </div>
  )
}
