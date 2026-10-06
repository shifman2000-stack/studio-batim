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
  }
}

export function useLabVars(opts) {
  return useMemo(() => buildLabVars(opts), [
    opts.twoClients, opts.hasHouse, opts.hasPlot, opts.hasSettlement,
  ])
}
