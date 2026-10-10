import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import QuoteJourneyV2 from '../../components/quoteV2/QuoteJourneyV2'
import QuoteTowerV2 from '../../components/quoteV2/QuoteTowerV2'
import { buildQuoteV2Content } from '../../lib/quoteV2/content'

/* ═══════════════════════════════════════════════════════════════════════
   /lab/quote-v2/new — יצירת הצעת v2 לבדיקה

   ⚠️ admin בלבד, לא מקושר משום תפריט. זו פרוסה מינימלית מהעורך
   האמיתי (שלב 6), שקיימת רק כדי שאפשר יהיה ליצור הצעת v2 אחת דרך
   המסכים ולא דרך SQL — ובלי לגעת באף מסך קיים.

   "שלח" משתמש **באותה לוגיקה בדיוק** של QuoteBuilder של היום:
   שורת quote_versions חדשה עם form_token, ו-quotes.status = 'sent'.
   ═══════════════════════════════════════════════════════════════════════ */

const WRAP = {
  position: 'fixed', inset: 0, overflow: 'auto', background: '#f3f1ee',
  direction: 'rtl', fontFamily: 'Heebo, sans-serif', padding: '22px 18px 60px',
}
const CARD = {
  maxWidth: 760, margin: '0 auto', background: '#fff', borderRadius: 14,
  padding: '20px 22px', boxShadow: '0 2px 14px rgba(40,30,20,.10)',
}
const ROW = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 14 }
const FIELD = { display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 160px', minWidth: 140 }
const LABEL = { fontSize: 12, letterSpacing: '.08em', color: '#8a8680' }
const INPUT = {
  font: 'inherit', fontSize: 15, padding: '8px 10px', borderRadius: 8,
  border: '1px solid #ddd8d0', background: '#fff', color: '#1a1a18', width: '100%',
}
const BTN = {
  font: 'inherit', fontSize: 14, padding: '10px 18px', borderRadius: 9,
  border: '1px solid #1a1a18', background: '#1a1a18', color: '#f7f5f2', cursor: 'pointer',
}
const BTN_SEC = { ...BTN, background: 'transparent', color: '#1a1a18', borderColor: 'rgba(26,26,24,.25)' }
const NOTE = { fontSize: 12.5, color: '#8a8680', marginTop: 10, lineHeight: 1.6 }

export default function QuoteV2New() {
  const navigate = useNavigate()
  const [state, setState] = useState('checking')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const [template, setTemplate] = useState(null)
  const [inquiries, setInquiries] = useState([])
  const [inquiryId, setInquiryId] = useState('')

  const [fee, setFee] = useState('120000')
  const [houseArea, setHouseArea] = useState('200')
  const [plotArea, setPlotArea] = useState('490')

  const [quoteId, setQuoteId] = useState(null)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [face, setFace] = useState('journey')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile?.role !== 'admin') { navigate('/dashboard'); return }
      if (cancelled) return

      const [{ data: tpl, error: tplErr }, { data: inqs, error: inqErr }] = await Promise.all([
        supabase.from('quote_templates').select('content').eq('is_default', true).maybeSingle(),
        supabase.from('inquiries')
          .select('id, first_name, last_name, phone, email, city, contact2_name, contact2_phone, contact2_email, date')
          .order('date', { ascending: false }).limit(200),
      ])
      if (cancelled) return
      if (tplErr || !tpl?.content) {
        setError('לא נמצאה תבנית ברירת מחדל. צריך להריץ את docs/sql/quote-v2-phaseA.sql על הסביבה הזו.')
        setState('error'); return
      }
      if (inqErr) { setError('שגיאה בטעינת הפניות: ' + inqErr.message); setState('error'); return }
      setTemplate(tpl.content)
      setInquiries(inqs ?? [])
      setState('ready')
    }
    run()
    return () => { cancelled = true }
  }, [navigate])

  const inquiry = useMemo(
    () => inquiries.find(i => i.id === inquiryId) ?? null,
    [inquiries, inquiryId]
  )

  const content = useMemo(() => {
    if (!template || !inquiry) return null
    return buildQuoteV2Content(template, inquiry, { fee, houseArea, plotArea })
  }, [template, inquiry, fee, houseArea, plotArea])

  /* ── שמירת טיוטה ──────────────────────────────────────────────────
     ⚠️ על quotes יש אילוץ ייחודיות (inquiry_id, quote_number).
     QuoteBuilder של היום לעולם לא נתקל בו, כי הוא טוען תמיד את
     ההצעה הראשונה של הפנייה ומעדכן אותה — ו-quote_number: 1 מופיע
     שם רק כשאין לפנייה שום הצעה.

     כאן זה שונה: לפנייה כבר יש הצעת v1 (למשל זו של שלב 0), ואסור
     לדרוס אותה. לכן:
       · יש כבר **טיוטת** v2 לפנייה → מעדכנים אותה, כך שלחיצות חוזרות
         לא יוצרות כפילויות.
       · אין → הצעה **חדשה** עם המספר הפנוי הבא, max+1, שנופל
         חזרה ל-1 כשאין בכלל הצעות — בדיוק כמו ב-QuoteBuilder.

     ⚠️ status='draft' הוא חלק מהתנאי ולא קישוט. בלעדיו, פנייה שכבר
     יש לה הצעת v2 **חתומה** (draft_content שלה נשאר schema=2) הייתה
     נבחרת לעדכון, וה-draft_content של מסמך חתום היה נדרס — ו"שלח"
     היה תולה גרסה שנייה על הצעה חתומה. בדיקה שנייה על אותה פנייה
     חייבת לקבל הצעה חדשה משלה. */
  const saveDraft = async () => {
    if (!content) return
    setBusy('save'); setError('')
    try {
      const { data: v2rows, error: v2Err } = await supabase
        .from('quotes').select('id')
        .eq('inquiry_id', inquiryId)
        .eq('status', 'draft')
        .filter('draft_content->>schema', 'eq', '2')
        .order('quote_number', { ascending: true })
        .limit(1)
      if (v2Err) throw v2Err

      if (v2rows?.[0]?.id) {
        const { error: e } = await supabase.from('quotes')
          .update({ draft_content: content, updated_at: new Date().toISOString() })
          .eq('id', v2rows[0].id)
        if (e) throw e
        setQuoteId(v2rows[0].id)
        setLink('')
        navigate(`/quotes-v2/${v2rows[0].id}`)
        return
      }

      const { data: all, error: numErr } = await supabase
        .from('quotes').select('quote_number').eq('inquiry_id', inquiryId)
      if (numErr) throw numErr
      const nextNumber = (all ?? []).reduce((m, r) => Math.max(m, r.quote_number || 0), 0) + 1

      const { data: created, error: e } = await supabase.from('quotes')
        .insert([{ inquiry_id: inquiryId, quote_number: nextNumber, status: 'draft', draft_content: content }])
        .select('id').single()
      if (e) throw e
      setQuoteId(created.id)
      setLink('')
      navigate(`/quotes-v2/${created.id}`)
    } catch (e) {
      const raw = e?.message || String(e)
      setError(
        raw.includes('quotes_inquiry_id_quote_number_key')
          ? 'שמירה נכשלה: כבר קיימת הצעה עם אותו מספר לפנייה הזו. רענני את הדף ונסי שוב — אם זה חוזר, יש הצעה שנוצרה במקביל.'
          : raw.includes('row-level security') || raw.includes('permission')
            ? 'שמירה נכשלה: אין הרשאה. צריך להיות מחובר כ-admin.'
            : 'שמירה נכשלה: ' + raw
      )
    } finally { setBusy('') }
  }

  /* ── שליחה — אותה לוגיקה כמו ב-QuoteBuilder של היום ── */
  const send = async () => {
    if (!quoteId || !content) return
    setBusy('send'); setError('')
    try {
      // ארכוב גרסאות קודמות ושלילת הטוקנים שלהן
      const { data: prev } = await supabase
        .from('quote_versions').select('id, version_number')
        .eq('quote_id', quoteId).order('version_number', { ascending: false })
      for (const p of prev ?? []) {
        await supabase.from('quote_versions')
          .update({ form_token: null, is_archived: true }).eq('id', p.id)
      }
      const nextNumber = (prev?.[0]?.version_number ?? 0) + 1
      const token = crypto.randomUUID()

      const { error: insErr } = await supabase.from('quote_versions').insert([{
        quote_id: quoteId,
        version_number: nextNumber,
        content,
        form_token: token,
        sent_at: new Date().toISOString(),
      }])
      if (insErr) throw insErr

      const { error: stErr } = await supabase.from('quotes')
        .update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', quoteId)
      if (stErr) throw stErr

      setLink(`${window.location.origin}/quote/${token}`)
    } catch (e) {
      setError('שליחה נכשלה: ' + (e.message || e))
    } finally { setBusy('') }
  }

  if (state === 'checking') return <div style={{ ...WRAP, padding: 40 }}>טוען…</div>
  if (state === 'error') return <div style={{ ...WRAP, padding: 40, color: '#c0392b' }}>{error}</div>

  return (
    <div style={WRAP}>
      <div style={CARD}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500 }}>הצעת מחיר v2 — יצירה לבדיקה</h1>
          <span style={{ fontSize: 12, color: '#8a8680' }}>admin · מעבדה</span>
        </div>

        <div style={ROW}>
          <div style={{ ...FIELD, flex: '1 1 100%' }}>
            <span style={LABEL}>פנייה</span>
            <select
              style={INPUT}
              value={inquiryId}
              onChange={e => { setInquiryId(e.target.value); setQuoteId(null); setLink('') }}
            >
              <option value="">— בחר פנייה —</option>
              {inquiries.map(i => (
                <option key={i.id} value={i.id}>
                  {[i.first_name, i.last_name].filter(Boolean).join(' ') || '(ללא שם)'}
                  {i.date ? ` · ${new Date(i.date).toLocaleDateString('he-IL')}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={ROW}>
          <label style={FIELD}>
            <span style={LABEL}>שכר טרחה (₪)</span>
            <input style={INPUT} value={fee} inputMode="numeric" onChange={e => setFee(e.target.value)} />
          </label>
          <label style={FIELD}>
            <span style={LABEL}>שטח בית (מ״ר) — רשות</span>
            <input style={INPUT} value={houseArea} onChange={e => setHouseArea(e.target.value)} />
          </label>
          <label style={FIELD}>
            <span style={LABEL}>שטח מגרש (מ״ר) — רשות</span>
            <input style={INPUT} value={plotArea} onChange={e => setPlotArea(e.target.value)} />
          </label>
        </div>

        {inquiry && (
          <div style={NOTE}>
            {inquiry.contact2_name
              ? `שני לקוחות · ${inquiry.first_name} ו${String(inquiry.contact2_name).split(/\s+/)[0]} — שתי חתימות יידרשו`
              : 'לקוח אחד · חתימה אחת תידרש'}
            {inquiry.city ? ` · יישוב: ${inquiry.city}` : ' · ללא יישוב בפנייה'}
          </div>
        )}

        <div style={{ ...ROW, marginTop: 18 }}>
          <button type="button" style={BTN_SEC} disabled={!content || busy} onClick={saveDraft}>
            {busy === 'save' ? 'שומר…' : 'שמור טיוטה'}
          </button>
          <button type="button" style={BTN} disabled={!quoteId || busy} onClick={send}>
            {busy === 'send' ? 'שולח…' : 'שלח'}
          </button>
          {quoteId && !link && <span style={{ ...NOTE, marginTop: 0 }}>הטיוטה נשמרה. אפשר לשלוח.</span>}
        </div>

        {error && <div style={{ ...NOTE, color: '#c0392b' }}>{error}</div>}

        {link && (
          <div style={{ marginTop: 18, padding: '14px 16px', background: '#f3f1ee', borderRadius: 10 }}>
            <div style={{ ...LABEL, marginBottom: 6 }}>הקישור ללקוח</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <input readOnly style={{ ...INPUT, flex: '1 1 260px', direction: 'ltr', textAlign: 'start' }} value={link} />
              <button
                type="button"
                style={BTN_SEC}
                onClick={async () => {
                  try { await navigator.clipboard.writeText(link) } catch { /* ignore */ }
                  setCopied(true); setTimeout(() => setCopied(false), 1800)
                }}
              >{copied ? '✓ הועתק' : 'העתק'}</button>
              <a style={{ ...BTN_SEC, textDecoration: 'none' }} href={link} target="_blank" rel="noreferrer">פתח</a>
            </div>
          </div>
        )}
      </div>

      {content && (
        <>
          <div style={{ ...CARD, marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={LABEL}>תצוגה מקדימה</span>
            <button type="button" style={face === 'journey' ? BTN : BTN_SEC} onClick={() => setFace('journey')}>📱 שיווקי</button>
            <button type="button" style={face === 'tower' ? BTN : BTN_SEC} onClick={() => setFace('tower')}>📄 כתוב</button>
          </div>
          <div style={{ maxWidth: 760, margin: '14px auto 0' }}>
            {face === 'journey' ? (
              <div style={{ height: 760, display: 'flex', borderRadius: 14, overflow: 'hidden' }}>
                <QuoteJourneyV2 key={JSON.stringify(content.vars)} content={content} />
              </div>
            ) : (
              <div style={{ background: '#e6e2db', padding: '18px 10px 40px', borderRadius: 14 }}>
                <QuoteTowerV2 content={content} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
