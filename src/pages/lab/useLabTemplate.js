import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { deriveFirstNames } from '../../lib/quoteV2/resolve'

/* ═══════════════════════════════════════════════════════════════════════
   משותף לשני דפי המעבדה של הצעת מחיר v2 — /lab/quote-v2 ו-/lab/quote-v2/print

   שער admin + טעינת תבנית ברירת המחדל מ-quote_templates, בקריאה בלבד.
   נתוני הלקוח כאן **בדיוניים לגמרי** ואינם מגיעים משום פנייה אמיתית.
   ═══════════════════════════════════════════════════════════════════════ */

export const LAB = {
  name1: 'דנה',
  name2: 'יואב',
  settlement: 'כפר ורדים',
  houseArea: '200',
  plotArea: '490',
  fee: 120000,
  phone: '050-0000000',
  email: 'lab@example.com',
}

function todayHe() {
  const d = new Date()
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`
}

/** בונה את אובייקט ה-vars שהמרנדרים מקבלים, לפי מתגי המעבדה. */
export function buildLabVars({ twoClients, hasHouse, hasPlot, hasSettlement }) {
  return {
    firstNames: deriveFirstNames(twoClients ? [LAB.name1, LAB.name2] : [LAB.name1]),
    settlement: hasSettlement ? LAB.settlement : '',
    houseArea: hasHouse ? LAB.houseArea : '',
    plotArea: hasPlot ? LAB.plotArea : '',
    fee: LAB.fee,
    date: todayHe(),
    clientPhone: LAB.phone,
    clientEmail: LAB.email,
  }
}

/**
 * שער admin + טעינת התבנית. מחזיר { state, error, content }.
 * state: checking | loading | ready | error
 */
export function useLabTemplate() {
  const navigate = useNavigate()
  const [state, setState] = useState('checking')
  const [error, setError] = useState('')
  const [content, setContent] = useState(null)

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

  return { state, error, content }
}

/** קורא את מתגי המעבדה מה-query string, לשימוש בדף ההדפסה. */
export function readLabQuery(search) {
  const p = new URLSearchParams(search)
  return {
    twoClients: p.get('clients') !== '1',
    hasHouse: p.get('nohouse') !== '1',
    hasPlot: p.get('noplot') !== '1',
    hasSettlement: p.get('nocity') !== '1',
    signed: p.get('signed') === '1',
  }
}

/* חתימה מדומה למעבדה. SVG ולא PNG כדי שלא יהיה כאן בלוק base64
   ענק בקוד; שניהם data:image ושניהם מציירים זהה ב-Chromium. */
const scribble = (seed) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="190" height="70" viewBox="0 0 190 70">` +
    `<path d="M8 ${46 + seed * 4} C30 14,46 58,62 34 S90 6,98 ${40 + seed * 3} S120 60,136 24 S170 12,182 20" ` +
    `fill="none" stroke="#2c3f73" stroke-width="1.7" stroke-linecap="round"/></svg>`
  )

/**
 * clientResponse מדומה — רק למעבדה, לבדיקת הפן הכתוב אחרי חתימה.
 * ⚠️ לא נשלח לשום מקום ולא נשמר. הנתונים בדיוניים.
 */
export function buildLabSignedResponse(count) {
  const people = [
    { name: 'דנה כהן לוי', idNumber: '039182746' },
    { name: 'יואב כהן לוי', idNumber: '027465183' },
  ]
  return {
    extrasSelected: [],
    consentChecked: true,
    consentCheckedAt: new Date().toISOString(),
    signatures: Array.from({ length: count }, (_, i) => ({
      clientIndex: i,
      name: people[i]?.name ?? `חותם ${i + 1}`,
      idNumber: people[i]?.idNumber ?? '',
      image: scribble(i),
      signedAtClient: new Date().toISOString(),
    })),
  }
}

export function useLabVars(opts) {
  return useMemo(() => buildLabVars(opts), [
    opts.twoClients, opts.hasHouse, opts.hasPlot, opts.hasSettlement,
  ])
}
