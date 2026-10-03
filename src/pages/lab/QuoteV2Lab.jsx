import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import QuoteJourneyV2 from '../../components/quoteV2/QuoteJourneyV2'
import { deriveFirstNames } from '../../lib/quoteV2/resolve'

/* ═══════════════════════════════════════════════════════════════════════
   /lab/quote-v2 — מעבדה לפן השיווקי של הצעת מחיר v2

   ⚠️ לא מקושר משום תפריט, ו-admin בלבד. הדף טוען את תבנית ברירת
   המחדל מ-quote_templates ומרנדר אותה דרך QuoteJourneyV2 עם נתוני
   לקוח **בדיוניים** שאפשר להחליף בלוח הבקרה המרחף.

   קריאה בלבד. אין כאן שום כתיבה, ואין קשר להצעות הקיימות.
   ═══════════════════════════════════════════════════════════════════════ */

const PANEL = {
  position: 'fixed', insetInlineStart: 12, bottom: 12, zIndex: 9999,
  background: 'rgba(20,20,20,.92)', color: '#fff', borderRadius: 12,
  padding: '12px 14px', font: '13px/1.5 Heebo, sans-serif',
  boxShadow: '0 8px 30px rgba(0,0,0,.45)', direction: 'rtl',
  maxWidth: 260, backdropFilter: 'blur(6px)',
}
const ROW = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }
const BTN = {
  flex: 1, border: '1px solid rgba(255,255,255,.25)', background: 'transparent',
  color: '#fff', borderRadius: 7, padding: '5px 8px', font: 'inherit', cursor: 'pointer',
}
const BTN_ON = { ...BTN, background: '#d9774a', borderColor: '#d9774a' }
const LABEL = { minWidth: 62, color: '#9aa', fontSize: 12 }

/* נתוני דמה. שמות בדיוניים בלבד — אין כאן אף לקוח אמיתי. */
const NAME_1 = 'דנה'
const NAME_2 = 'יואב'
const SETTLEMENT = 'כפר ורדים'
const HOUSE_AREA = '200'
const PLOT_AREA = '490'
const FEE = 120000

export default function QuoteV2Lab() {
  const navigate = useNavigate()
  const [state, setState] = useState('checking')   // checking | loading | ready | error
  const [error, setError] = useState('')
  const [content, setContent] = useState(null)

  const [twoClients, setTwoClients] = useState(true)
  const [hasHouse, setHasHouse] = useState(true)
  const [hasPlot, setHasPlot] = useState(true)
  const [hasSettlement, setHasSettlement] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (profile?.role !== 'admin') { navigate('/dashboard'); return }
      if (cancelled) return

      setState('loading')
      const { data, error: err } = await supabase
        .from('quote_templates')
        .select('name, content')
        .eq('is_default', true)
        .maybeSingle()
      if (cancelled) return
      if (err) {
        setError('שגיאה בטעינת התבנית: ' + err.message)
        setState('error')
        return
      }
      if (!data?.content) {
        setError('לא נמצאה תבנית ברירת מחדל. הרצת את docs/sql/quote-v2-phaseA.sql על Dev?')
        setState('error')
        return
      }
      setContent(data.content)
      setState('ready')
    }
    run()
    return () => { cancelled = true }
  }, [navigate])

  const clientCount = twoClients ? 2 : 1

  const vars = useMemo(() => ({
    firstNames: deriveFirstNames(twoClients ? [NAME_1, NAME_2] : [NAME_1]),
    settlement: hasSettlement ? SETTLEMENT : '',
    houseArea: hasHouse ? HOUSE_AREA : '',
    plotArea: hasPlot ? PLOT_AREA : '',
    fee: FEE,
  }), [twoClients, hasHouse, hasPlot, hasSettlement])

  /* key מאלץ רינדור נקי בכל שינוי — כך הציור והספירה מתחילים מאפס
     ולא נשארים תקועים במצב של הגלילה הקודמת. */
  const renderKey = `${clientCount}-${hasHouse}-${hasPlot}-${hasSettlement}`

  if (state === 'checking' || state === 'loading') {
    return <div dir="rtl" style={{ padding: 40, fontFamily: 'Heebo, sans-serif' }}>טוען…</div>
  }
  if (state === 'error') {
    return (
      <div dir="rtl" style={{ padding: 40, fontFamily: 'Heebo, sans-serif', color: '#c0392b' }}>
        {error}
      </div>
    )
  }

  return (
    <>
      <QuoteJourneyV2
        key={renderKey}
        content={content}
        vars={vars}
        clientCount={clientCount}
      />

      {panelOpen ? (
        <div style={PANEL}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <b>מעבדה · הצעה v2</b>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              style={{ ...BTN, flex: 'none', padding: '2px 8px' }}
            >הסתר</button>
          </div>

          <div style={ROW}>
            <span style={LABEL}>לקוחות</span>
            <button type="button" style={!twoClients ? BTN_ON : BTN} onClick={() => setTwoClients(false)}>דנה</button>
            <button type="button" style={twoClients ? BTN_ON : BTN} onClick={() => setTwoClients(true)}>דנה ויואב</button>
          </div>

          <div style={ROW}>
            <span style={LABEL}>שטח בית</span>
            <button type="button" style={hasHouse ? BTN_ON : BTN} onClick={() => setHasHouse(true)}>200</button>
            <button type="button" style={!hasHouse ? BTN_ON : BTN} onClick={() => setHasHouse(false)}>ריק</button>
          </div>

          <div style={ROW}>
            <span style={LABEL}>שטח מגרש</span>
            <button type="button" style={hasPlot ? BTN_ON : BTN} onClick={() => setHasPlot(true)}>490</button>
            <button type="button" style={!hasPlot ? BTN_ON : BTN} onClick={() => setHasPlot(false)}>ריק</button>
          </div>

          <div style={ROW}>
            <span style={LABEL}>יישוב</span>
            <button type="button" style={hasSettlement ? BTN_ON : BTN} onClick={() => setHasSettlement(true)}>כפר ורדים</button>
            <button type="button" style={!hasSettlement ? BTN_ON : BTN} onClick={() => setHasSettlement(false)}>ריק</button>
          </div>

          <div style={{ ...ROW, color: '#9aa', fontSize: 11, marginTop: 10 }}>
            שכר טרחה: {FEE.toLocaleString('en-US')} ₪ · קריאה בלבד
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          style={{ ...PANEL, ...BTN, maxWidth: 'none', padding: '8px 12px', cursor: 'pointer' }}
        >מעבדה</button>
      )}
    </>
  )
}
