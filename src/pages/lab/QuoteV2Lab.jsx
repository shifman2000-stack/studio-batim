import { useState } from 'react'
import QuoteJourneyV2 from '../../components/quoteV2/QuoteJourneyV2'
import QuoteTowerV2 from '../../components/quoteV2/QuoteTowerV2'
import { useLabTemplate, useLabVars, LAB } from './useLabTemplate'

/* ═══════════════════════════════════════════════════════════════════════
   /lab/quote-v2 — מעבדה לשני הפנים של הצעת מחיר v2

   ⚠️ לא מקושר משום תפריט, ו-admin בלבד. הדף טוען את תבנית ברירת
   המחדל מ-quote_templates ומרנדר אותה דרך QuoteJourneyV2 (📱 שיווקי)
   או QuoteTowerV2 (📄 כתוב), עם נתוני לקוח **בדיוניים** שאפשר
   להחליף בלוח הבקרה המרחף.

   קריאה בלבד. אין כאן שום כתיבה, ואין קשר להצעות הקיימות.
   ═══════════════════════════════════════════════════════════════════════ */

const PANEL = {
  position: 'fixed', insetInlineStart: 12, bottom: 12, zIndex: 9999,
  background: 'rgba(20,20,20,.92)', color: '#fff', borderRadius: 12,
  padding: '12px 14px', font: '13px/1.5 Heebo, sans-serif',
  boxShadow: '0 8px 30px rgba(0,0,0,.45)', direction: 'rtl',
  maxWidth: 270, backdropFilter: 'blur(6px)',
}
const ROW = { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }
const BTN = {
  flex: 1, border: '1px solid rgba(255,255,255,.25)', background: 'transparent',
  color: '#fff', borderRadius: 7, padding: '5px 8px', font: 'inherit', cursor: 'pointer',
}
const BTN_ON = { ...BTN, background: '#d9774a', borderColor: '#d9774a' }
const LABEL = { minWidth: 62, color: '#9aa', fontSize: 12 }

/* מסך לבן שגולל בעצמו — הפן הכתוב אינו חי בתוך מכל הגלילה האפל
   של המסע, ו-#root הוא overflow:hidden (index.css:27). */
const TOWER_SCREEN = {
  flex: 1, minHeight: 0, overflow: 'auto',
  background: '#e6e2db', padding: '24px 12px 60px',
}

export default function QuoteV2Lab() {
  const { state, error, content } = useLabTemplate()

  const [face, setFace] = useState('journey')       // journey | tower
  const [twoClients, setTwoClients] = useState(true)
  const [hasHouse, setHasHouse] = useState(true)
  const [hasPlot, setHasPlot] = useState(true)
  const [hasSettlement, setHasSettlement] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)

  const clientCount = twoClients ? 2 : 1
  const vars = useLabVars({ twoClients, hasHouse, hasPlot, hasSettlement })

  /* key מאלץ רינדור נקי בכל שינוי — כך הציור והספירה מתחילים מאפס
     ולא נשארים תקועים במצב של הגלילה הקודמת. */
  const renderKey = `${face}-${clientCount}-${hasHouse}-${hasPlot}-${hasSettlement}`

  const printUrl = '/lab/quote-v2/print'
    + `?clients=${clientCount}`
    + (hasHouse ? '' : '&nohouse=1')
    + (hasPlot ? '' : '&noplot=1')
    + (hasSettlement ? '' : '&nocity=1')

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
      {face === 'journey' ? (
        <QuoteJourneyV2
          key={renderKey}
          content={content}
          vars={vars}
          clientCount={clientCount}
        />
      ) : (
        <div style={TOWER_SCREEN}>
          <QuoteTowerV2
            key={renderKey}
            content={content}
            vars={vars}
            clientCount={clientCount}
          />
        </div>
      )}

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
            <span style={LABEL}>פן</span>
            <button type="button" style={face === 'journey' ? BTN_ON : BTN} onClick={() => setFace('journey')}>📱 שיווקי</button>
            <button type="button" style={face === 'tower' ? BTN_ON : BTN} onClick={() => setFace('tower')}>📄 כתוב</button>
          </div>

          <div style={ROW}>
            <span style={LABEL}>לקוחות</span>
            <button type="button" style={!twoClients ? BTN_ON : BTN} onClick={() => setTwoClients(false)}>{LAB.name1}</button>
            <button type="button" style={twoClients ? BTN_ON : BTN} onClick={() => setTwoClients(true)}>{LAB.name1} ו{LAB.name2}</button>
          </div>

          <div style={ROW}>
            <span style={LABEL}>שטח בית</span>
            <button type="button" style={hasHouse ? BTN_ON : BTN} onClick={() => setHasHouse(true)}>{LAB.houseArea}</button>
            <button type="button" style={!hasHouse ? BTN_ON : BTN} onClick={() => setHasHouse(false)}>ריק</button>
          </div>

          <div style={ROW}>
            <span style={LABEL}>שטח מגרש</span>
            <button type="button" style={hasPlot ? BTN_ON : BTN} onClick={() => setHasPlot(true)}>{LAB.plotArea}</button>
            <button type="button" style={!hasPlot ? BTN_ON : BTN} onClick={() => setHasPlot(false)}>ריק</button>
          </div>

          <div style={ROW}>
            <span style={LABEL}>יישוב</span>
            <button type="button" style={hasSettlement ? BTN_ON : BTN} onClick={() => setHasSettlement(true)}>{LAB.settlement}</button>
            <button type="button" style={!hasSettlement ? BTN_ON : BTN} onClick={() => setHasSettlement(false)}>ריק</button>
          </div>

          <div style={ROW}>
            <a href={printUrl} target="_blank" rel="noreferrer" style={{ ...BTN, textAlign: 'center', textDecoration: 'none' }}>
              ⎙ פתח דף הדפסה
            </a>
          </div>

          <div style={{ ...ROW, color: '#9aa', fontSize: 11, marginTop: 10 }}>
            שכר טרחה: {LAB.fee.toLocaleString('en-US')} ₪ · קריאה בלבד
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
