import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import '../components/quoteV2/editor/editor.css'

import { Modal, Toast } from '../components/quoteV2/editor/bits'
import SectionOpening from '../components/quoteV2/editor/SectionOpening'
import SectionPrice from '../components/quoteV2/editor/SectionPrice'
import SectionStages from '../components/quoteV2/editor/SectionStages'
import SectionTerms from '../components/quoteV2/editor/SectionTerms'
import LibraryDrawer from '../components/quoteV2/editor/LibraryDrawer'
import PreviewModal from '../components/quoteV2/editor/PreviewModal'
import SendDialog from '../components/quoteV2/editor/SendDialog'

import { clientCountOf, varsOf, buildQuoteV2Content } from '../lib/quoteV2/content'
import { isFrozen, freeze, unfreeze, templateRawOf } from '../lib/quoteV2/linked'
import { buildTemplateUpdate } from '../lib/quoteV2/templateSync'
import { stagesOf, termGroupsOf } from '../lib/quoteV2/validate'
import * as ops from '../lib/quoteV2/editorOps'
import {
  sampleVars, sampleClients, SAMPLE, hasAlternates, grammarBoxes,
  buildTemplateFromEditor, describeTemplateDiff,
} from '../lib/quoteV2/templateEdit'

/* ═══════════════════════════════════════════════════════════════════════
   /quotes-v2/:quoteId — עורך ההצעות של עינב (שלב E)

   מקור האמת לפריסה, לסדר ולניסוח: docs/mockups/quote-editor.html.
   המודל וההחלטות: docs/quote-v2-design.md, פרק C.

   admin בלבד. בשלב הזה מגיעים לכאן רק דרך המעבדה; חיבור למסך
   הפנייה הוא שלב F.

   שלושה כללים שמחזיקים את הקובץ הזה קטן:
   · כל שינוי תוכן עובר דרך editorOps — פונקציות טהורות, בדוקות.
   · כל שדה טקסט עובר דרך LinkedField, שהוא היחיד שיודע שיש תחביר.
   · התצוגה המקדימה מרנדרת את הרכיבים האמיתיים, לא העתק שלהם.
   ═══════════════════════════════════════════════════════════════════════ */

const AUTOSAVE_MS = 800

/* עוטף תוכן תבנית כ-content_v2 מלא עם נתוני דוגמה, כדי שכל רכיבי
   הסעיפים והתצוגה המקדימה יעבדו בלי שום תנאי מיוחד. */
function asEditable(tplContent, twoClients) {
  return {
    ...tplContent,
    clients: sampleClients(twoClients),
    property: { settlement: SAMPLE.settlement, houseArea: SAMPLE.houseArea, plotArea: SAMPLE.plotArea },
    vars: sampleVars(twoClients),
    totals: { fee: SAMPLE.fee, currency: 'ILS', vatIncluded: false },
    clientResponse: { extrasSelected: [], consentChecked: false, signatures: [] },
    meta: { ...(tplContent.meta ?? {}), frozen: [] },
  }
}

export default function QuoteEditorV2({ mode = 'quote' }) {
  const { quoteId } = useParams()
  const navigate = useNavigate()
  /* מצב תבנית: אותו עורך בדיוק, אבל על שורת quote_templates
     במקום על הצעה, ועם לקוח לדוגמה. ההבדלים מרוכזים ב-isTpl. */
  const isTpl = mode === 'template'

  const [state, setState] = useState('checking')   // checking | loading | ready | error
  const [error, setError] = useState('')
  const [quote, setQuote] = useState(null)
  const [template, setTemplate] = useState(null)
  const [library, setLibrary] = useState([])
  const [lastSent, setLastSent] = useState(null)

  const [content, setContent] = useState(null)
  const [saved, setSaved] = useState('✓ נשמר')
  const [open, setOpen] = useState(null)
  const [toast, setToast] = useState('')
  const [dialog, setDialog] = useState(null)       // {kind, ...}
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [link, setLink] = useState('')

  const dirty = useRef(false)
  const timer = useRef(null)

  /* ── מצב תבנית בלבד ── */
  const [twoClients, setTwoClients] = useState(true)
  const [undo, setUndo] = useState(null)        // { previous } אחרי שמירה
  const [inquiry, setInquiry] = useState(null) // רק למצב הצעה
  const [tplRow, setTplRow] = useState(null)
  const [backups, setBackups] = useState([])
  const [tplDirty, setTplDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const pristine = useRef(null)        // תוכן התבנית כפי שנטען
  const origRaw = useRef({})           // נוסח מקורי לכל שדה שנערך
  const plural = useRef({})            // הניסוח ברבים לשדות דקדוקיים
  const edited = useRef(new Set())     // נתיבי השדות שנערכו

  /* ── טעינה ───────────────────────────────────────────────────── */
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

      if (isTpl) {
        const [tpl, lib, bks] = await Promise.all([
          supabase.from('quote_templates').select('id, name, content').eq('is_default', true).maybeSingle(),
          supabase.from('quote_library_items').select('id, type, title, payload, tags, archived'),
          supabase.from('quote_templates').select('id, name, content, updated_at')
            .eq('is_default', false).order('updated_at', { ascending: false }).limit(5),
        ])
        if (cancelled) return
        if (tpl.error || !tpl.data?.content?.sections) {
          setError('לא נמצאה תבנית ברירת מחדל.'); setState('error'); return
        }
        pristine.current = tpl.data.content
        setTplRow({ id: tpl.data.id, name: tpl.data.name })
        setLibrary(lib.data ?? [])
        setBackups(bks.data ?? [])
        setTemplate(tpl.data.content)
        setContent(asEditable(tpl.data.content, true))
        setState('ready')
        return
      }

      const [q, tpl, lib] = await Promise.all([
        supabase.from('quotes')
          .select('id, inquiry_id, quote_number, status, draft_content')
          .eq('id', quoteId).maybeSingle(),
        supabase.from('quote_templates').select('content').eq('is_default', true).maybeSingle(),
        supabase.from('quote_library_items').select('id, type, title, payload, tags, archived'),
      ])
      if (cancelled) return

      if (q.error || !q.data) { setError('ההצעה לא נמצאה.'); setState('error'); return }
      if (q.data.draft_content?.schema !== 2) {
        setError('זו אינה הצעת v2. העורך הזה מטפל רק בהצעות בפורמט החדש.')
        setState('error'); return
      }

      const { data: versions } = await supabase
        .from('quote_versions')
        .select('version_number, sent_at, is_signed, form_token, is_archived')
        .eq('quote_id', quoteId)
        .order('version_number', { ascending: false })

      /* נטען רק כדי לאפשר "התחלה מחדש מהתבנית" — בנייה מחדש חייבת
         את נתוני הפנייה, בדיוק כמו ביצירת הטיוטה. */
      const { data: inq } = await supabase.from('inquiries')
        .select('id, first_name, last_name, phone, email, city, contact2_name, contact2_phone, contact2_email')
        .eq('id', q.data.inquiry_id).maybeSingle()
      setInquiry(inq ?? null)

      setQuote(q.data)
      setTemplate(tpl.data?.content ?? null)
      setLibrary(lib.data ?? [])
      setContent(q.data.draft_content)
      setLastSent(versions?.[0] ?? null)
      setState('ready')
    }
    run()
    return () => { cancelled = true }
  }, [quoteId, navigate, isTpl])

  /* ── נעילה ───────────────────────────────────────────────────── */
  const signed = !isTpl && !!lastSent?.is_signed
  const readOnly = signed

  /* ── שמירה אוטומטית ──────────────────────────────────────────── */
  useEffect(() => {
    if (isTpl || state !== 'ready' || !dirty.current || readOnly) return
    setSaved('שומר…')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const { error: e } = await supabase.from('quotes')
        .update({ draft_content: content, updated_at: new Date().toISOString() })
        .eq('id', quoteId)
      setSaved(e ? 'השמירה נכשלה' : '✓ נשמר')
      if (e) console.error('autosave:', e)
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer.current)
  }, [content, state, quoteId, readOnly, isTpl])

  const update = useCallback(fn => {
    dirty.current = true
    setTplDirty(true)
    setContent(prev => (typeof fn === 'function' ? fn(prev) : fn))
  }, [])

  const flash = t => { setToast(t); setTimeout(() => setToast(''), 1800) }

  /* ── נגזרות ──────────────────────────────────────────────────── */
  const vars = useMemo(
    () => (isTpl ? sampleVars(twoClients) : varsOf(content)), [content, isTpl, twoClients])
  const nClients = useMemo(
    () => (isTpl ? (twoClients ? 2 : 1) : clientCountOf(content)), [content, isTpl, twoClients])
  const opening = ops.sectionByType(content, 'opening')
  const scope = ops.sectionByType(content, 'scope')
  const extras = ops.sectionByType(content, 'extras')
  const stages = useMemo(() => stagesOf(content), [content])
  const allStages = ops.sectionByType(content, 'stages')?.items ?? []
  const groups = useMemo(() => termGroupsOf(content), [content])
  const poolOn = useMemo(() => ops.isPoolOn(content, library), [content, library])

  /* ── גשר השדות המקושרים ──────────────────────────────────────── */
  const f = useMemo(() => ({
    frozen: (id, field) => isFrozen(content, id, field),

    bind: (id, field, raw) => {
      const path = `${id}.${field}`

      /* ── מצב תבנית ───────────────────────────────────────────────
         כאן אין "מקושר/קפוא": כל שדה מוצג פתור עם נתוני הדוגמה,
         וההמרה חזרה לנוסח תבנית קורית בשמירה. מה שצריך לזכור הוא
         (א) מי נערך, ו-(ב) מה היה הנוסח לפני — בלעדיו אי אפשר
         לדעת אילו משתנים וחלופות היו בשדה. */
      if (isTpl) {
        const remember = () => {
          if (!(path in origRaw.current)) origRaw.current[path] = raw ?? ''
          edited.current.add(path)
        }

        if (hasAlternates(origRaw.current[path] ?? raw)) {
          const stored = plural.current[path]
          const boxes = grammarBoxes(origRaw.current[path] ?? raw ?? '')
          return {
            value: raw,
            vars, clientCount: nClients,
            grammar: {
              singular: edited.current.has(path) ? raw : boxes.singular,
              plural: stored ?? boxes.plural,
              onChange: (which, v) => {
                remember()
                if (plural.current[path] === undefined) plural.current[path] = boxes.plural
                if (which === 'plural') { plural.current[path] = v; update(c => ({ ...c })) }
                else update(c => ops.patchById(c, id, { [field]: v }))
                if (which === 'singular' && !edited.current.has(path)) edited.current.add(path)
              },
            },
            onChange: () => {},
          }
        }

        return {
          value: raw,
          vars, clientCount: nClients,
          onChange: v => { remember(); update(c => ops.patchById(c, id, { [field]: v })) },
        }
      }

      /* ── מצב הצעה — ללא שינוי ── */
      return {
        value: raw,
        frozen: isFrozen(content, id, field),
        templateRaw: templateRawOf(template, id, field),
        vars,
        clientCount: nClients,
        onChange: v => update(c => freeze(ops.patchById(c, id, { [field]: v }), id, field)),
        onRestore: () => update(c => {
          const back = templateRawOf(template, id, field) ?? ''
          return unfreeze(ops.patchById(c, id, { [field]: back }), id, field)
        }),
      }
    },
  }), [content, template, vars, nClients, update, isTpl])

  /* ── שליחה ───────────────────────────────────────────────────── */
  const doSend = async ({ alsoTemplate }) => {
    setSending(true); setSendError('')
    try {
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

      if (alsoTemplate && template) {
        const next = buildTemplateUpdate(template, content)
        const { error: tErr } = await supabase.from('quote_templates')
          .update({ content: next, updated_at: new Date().toISOString() })
          .eq('is_default', true)
        if (tErr) flash('ההצעה נשלחה, אבל עדכון התבנית נכשל')
        else setTemplate(next)
      }

      setLink(`${window.location.origin}/quote/${token}`)
      setLastSent({ version_number: nextNumber, sent_at: new Date().toISOString(), is_signed: false })
      setQuote(q => ({ ...q, status: 'sent' }))
    } catch (e) {
      const raw = e?.message || String(e)
      setSendError(raw.includes('row-level security') || raw.includes('permission')
        ? 'אין הרשאה. צריך להיות מחובר כ-admin.'
        : 'השליחה נכשלה: ' + raw)
    } finally { setSending(false) }
  }

  /* ── שמירת תבנית ──────────────────────────────────────────────
     הגיבוי נוצר **לפני** הדריסה, ונשמרים חמישה אחרונים. זו הרשת
     היחידה שיש כאן: ההצעות הבאות כולן ייוולדו מהנוסח הזה. */
  const buildNext = () => buildTemplateFromEditor(content, {
    edited: [...edited.current],
    origRaw: origRaw.current,
    plural: plural.current,
  })

  const openSaveConfirm = () => {
    const { content: next, warnings } = buildNext()
    setDialog({ kind: 'tplConfirm', next, warnings, changes: describeTemplateDiff(pristine.current, next) })
  }

  /* ⚠️ כל כתיבה כאן מאומתת בקריאה חוזרת לפני שמוצגת הצלחה.
     update בלי select מחזיר "בלי שגיאה" גם כשלא עודכנה אף שורה —
     למשל כשמדיניות RLS חוסמת בשקט — וזה בדיוק המצב שבו המשתמשת
     רואה "נשמר" ולא נשמר כלום. */
  const writeTemplate = async (nextContent) => {
    const stamp = new Date().toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })

    const { data: bRows, error: bErr } = await supabase.from('quote_templates')
      .insert([{ name: `גיבוי · ${stamp}`, is_default: false, content: pristine.current }])
      .select('id')
    if (bErr) throw new Error('יצירת הגיבוי נכשלה: ' + bErr.message)
    if (!bRows?.length) throw new Error('הגיבוי לא נוצר — ככל הנראה אין הרשאה לכתוב לתבניות.')

    const { data: uRows, error: uErr } = await supabase.from('quote_templates')
      .update({ content: nextContent, updated_at: new Date().toISOString() })
      .eq('id', tplRow.id)
      .select('id, content')
    if (uErr) throw new Error('שמירת התבנית נכשלה: ' + uErr.message)
    if (!uRows?.length) throw new Error('לא עודכנה אף שורה. ייתכן שאין הרשאה, או שהתבנית נמחקה.')
    if (JSON.stringify(uRows[0].content) !== JSON.stringify(nextContent)) {
      throw new Error('מה שנשמר במסד שונה ממה שנשלח. לא בוצע שינוי.')
    }

    /* סיבוב גיבויים — אחרי שהשמירה הצליחה, ולא לפניה. */
    const { data: all } = await supabase.from('quote_templates')
      .select('id, updated_at').eq('is_default', false)
      .order('updated_at', { ascending: false })
    for (const extra of (all ?? []).slice(5)) {
      await supabase.from('quote_templates').delete().eq('id', extra.id)
    }

    const { data: bks } = await supabase.from('quote_templates')
      .select('id, name, content, updated_at').eq('is_default', false)
      .order('updated_at', { ascending: false }).limit(5)
    return bks ?? []
  }

  const adoptTemplate = (nextContent, bks) => {
    pristine.current = nextContent
    origRaw.current = {}; plural.current = {}; edited.current = new Set()
    setTemplate(nextContent)
    setContent(asEditable(nextContent, twoClients))
    setTplDirty(false)
    setBackups(bks)
  }

  const doSaveTemplate = async (next) => {
    setBusy('save')
    try {
      const previous = pristine.current
      const bks = await writeTemplate(next)
      adoptTemplate(next, bks)
      setDialog(null)
      setUndo({ previous })
      flash('התבנית נשמרה')
    } catch (e) {
      /* השגיאה נשארת **בתוך הדיאלוג**, כדי שלא תיעלם עם טוסט חולף. */
      setDialog(d => (d ? { ...d, error: e.message || String(e) } : d))
    } finally { setBusy('') }
  }

  /** שחזור גרסה — יוצר גיבוי של הנוכחית לפני שהוא דורס אותה. */
  const restoreTemplate = async (contentToRestore) => {
    setBusy('restore')
    try {
      const bks = await writeTemplate(contentToRestore)
      adoptTemplate(contentToRestore, bks)
      setDialog(null)
      setUndo(null)
      flash('הגרסה שוחזרה')
    } catch (e) {
      setDialog(d => (d ? { ...d, error: e.message || String(e) } : d))
    } finally { setBusy('') }
  }

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); flash('הקישור הועתק') }
    catch { flash('לא הצלחתי להעתיק — אפשר לסמן ולהעתיק ידנית') }
  }

  /* ── אזהרה על יציאה עם שינויים שלא נשמרו ───────────────────── */
  useEffect(() => {
    if (!isTpl || !tplDirty) return
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isTpl, tplDirty])

  const leave = () => {
    if (tplDirty && !window.confirm('יש שינויים שלא נשמרו. לצאת בלי לשמור?')) return
    navigate('/reports')
  }

  /* ── מצבי טעינה ──────────────────────────────────────────────── */
  if (state === 'checking' || state === 'loading') {
    return <div className="qe"><div className="qe-wrap">טוען…</div></div>
  }
  if (state === 'error') {
    return <div className="qe"><div className="qe-wrap" style={{ color: '#c0653a' }}>{error}</div></div>
  }

  const who = [
    (content?.clients ?? []).map(c => [c.firstName, c.lastName].filter(Boolean).join(' ')).filter(Boolean).join(' ו'),
    content?.property?.settlement,
  ].filter(Boolean).join(' · ')

  return (
    <div className="qe">
      <div className="qe-top">
        {isTpl ? (
          <>
            <h1>טופס הצעת מחיר <small>· תבנית</small></h1>
            {tplDirty && <span className="qe-saved err">יש שינויים שלא נשמרו</span>}
            <span className="qe-sp" />
            <button type="button" className="qe-b" onClick={() => setDialog({ kind: 'preview' })}>👁 תצוגה מקדימה</button>
            <button type="button" className="qe-b" onClick={() => setDialog({ kind: 'tplVersions' })}>גרסאות קודמות</button>
            <button type="button" className="qe-b" onClick={leave}>יציאה</button>
            <button type="button" className="qe-b pri" disabled={!tplDirty || busy === 'save'} onClick={openSaveConfirm}>
              {busy === 'save' ? 'שומר…' : 'שמירת תבנית'}
            </button>
          </>
        ) : (
          <>
            <h1>הצעת מחיר <small>{who ? '· ' + who : ''}</small></h1>
            <span className={'qe-saved' + (saved === 'השמירה נכשלה' ? ' err' : '')}>
              {readOnly ? 'הצעה חתומה — קריאה בלבד' : saved}
            </span>
            <span className="qe-sp" />
            <button type="button" className="qe-b" onClick={() => setDialog({ kind: 'preview' })}>👁 תצוגה מקדימה</button>
            {!readOnly && template && inquiry && (
              <button type="button" className="qe-b" title="בונה מחדש את ההצעה מנוסח הטופס העדכני"
                onClick={() => setDialog({ kind: 'reset' })}>
                ↺ התחלה מחדש מהתבנית
              </button>
            )}
            {!readOnly && (
              <button type="button" className="qe-b pri" onClick={() => { setLink(''); setSendError(''); setDialog({ kind: 'send' }) }}>
                שליחה ללקוח
              </button>
            )}
          </>
        )}
      </div>

      <div className="qe-wrap">
        {isTpl && (
          <div className="qe-sample">
            <span>תצוגה עם לקוח לדוגמה</span>
            <span style={{ color: '#6b8a68' }}>
              {twoClients ? `${SAMPLE.name1} ו${SAMPLE.name2}` : SAMPLE.name1} · {SAMPLE.settlement} ·
              {' '}{SAMPLE.houseArea}/{SAMPLE.plotArea} מ״ר · {SAMPLE.fee.toLocaleString('en-US')} ₪
            </span>
            <span className="qe-sp" />
            <div className="qe-seg qe-seg--sm">
              <button type="button" className={!twoClients ? 'on' : ''}
                onClick={() => { setTwoClients(false); setContent(c => ({ ...c, clients: sampleClients(false), vars: sampleVars(false) })) }}>
                לקוח אחד
              </button>
              <button type="button" className={twoClients ? 'on' : ''}
                onClick={() => { setTwoClients(true); setContent(c => ({ ...c, clients: sampleClients(true), vars: sampleVars(true) })) }}>
                שני לקוחות
              </button>
            </div>
          </div>
        )}

        {isTpl ? (
          <div className="qe-tip">
            💡 כאן עורכים את <b>הטופס עצמו</b>. מה שיישמר כאן ייפתח בכל הצעה חדשה.
            שם הלקוח, היישוב, השטחים וסכום שכר הטרחה שמוצגים כאן הם דוגמה בלבד ואינם נשמרים —
            חלוקת האחוזים בין השלבים כן נשמרת.
          </div>
        ) : readOnly ? (
          <div className="qe-tip ro">
            ההצעה נחתמה. מסמך חתום לא נערך ולא מרונדר מחדש — ה-PDF השמור הוא המסמך.
          </div>
        ) : (
          <div className="qe-tip">
            💡 ברוב ההצעות מספיק לבדוק את המחיר ולשלוח. כל השאר כבר מוכן מהתבנית.
            {lastSent?.sent_at && (
              <> נשלחה גרסה {lastSent.version_number}; שליחה נוספת תיצור גרסה {lastSent.version_number + 1}.</>
            )}
          </div>
        )}

        <SectionOpening
          content={content} opening={opening} scope={scope} extras={extras}
          vars={vars} nClients={nClients} readOnly={readOnly} f={f}
          hideClientFields={isTpl}
          onClient={(i, patch) => update(c => ops.setClient(c, i, patch))}
          onRemoveSecond={() => update(ops.removeSecondClient)}
          onProperty={patch => update(c => ops.setProperty(c, patch))}
          onToggleExtra={id => update(c => ops.toggleExtra(c, id))}
          onAddExtra={() => setDialog({ kind: 'libExtra' })}
          onRemoveExtra={id => update(c => ops.removeExtra(c, id))}
          onPatch={(id, patch) => update(c => ops.patchById(c, id, patch))}
        />

        <SectionPrice
          stages={stages} fee={Number(content?.totals?.fee) || 0} readOnly={readOnly}
          feeNote={isTpl ? 'סכום לדוגמה — אינו נשמר בתבנית. האחוזים כן נשמרים.' : null}
          onFee={v => (isTpl
            ? setContent(c => ops.setFee(c, v))        /* לא מסמן dirty: לא נשמר */
            : update(c => ops.setFee(c, v)))}
          onPct={(id, v) => update(c => ops.setStagePct(c, id, v))}
        />

        <SectionStages
          stages={allStages} vars={vars} nClients={nClients} open={open} readOnly={readOnly} f={f}
          poolOn={poolOn}
          onToggle={id => setOpen(o => (o === id ? null : id))}
          onUp={id => update(c => ops.moveStage(c, id, -1))}
          onDown={id => update(c => ops.moveStage(c, id, 1))}
          onRemove={s => setDialog({ kind: 'rmStage', stage: s })}
          onAdd={() => setDialog({ kind: 'libStage' })}
          onPool={on => {
            update(c => ops.applyPoolVariant(c, library, on))
            flash(on ? 'הנוסח עודכן לכולל בריכה' : 'חזרנו לנוסח ברירת המחדל')
          }}
        />

        <SectionTerms
          groups={groups} vars={vars} nClients={nClients} open={open} readOnly={readOnly} f={f}
          onToggle={id => setOpen(o => (o === id ? null : id))}
          onGroupTitle={(id, v) => update(c => ops.patchById(c, id, { title: v }))}
          onGroupUp={id => update(c => ops.moveGroup(c, id, -1))}
          onGroupDown={id => update(c => ops.moveGroup(c, id, 1))}
          onRemoveGroup={g => setDialog({ kind: 'rmGroup', group: g })}
          onAddGroup={() => update(ops.addGroup(content).content)}
          onAddTerm={gid => { const r = ops.addTerm(content, gid); update(r.content); setOpen(r.id) }}
          onAddFromLibrary={gid => setDialog({ kind: 'libTerm', groupId: gid })}
          onRemoveTerm={t => setDialog({ kind: 'rmTerm', term: t })}
          onTermUp={id => update(c => ops.moveTerm(c, id, -1))}
          onTermDown={id => update(c => ops.moveTerm(c, id, 1))}
        />
      </div>

      {/* ── דיאלוגים ── */}
      {dialog?.kind === 'preview' && (
        <PreviewModal content={content} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'send' && (
        <SendDialog
          content={content} template={template} link={link}
          sending={sending} error={sendError}
          onSend={doSend} onCopy={copy}
          onClose={() => { setDialog(null); setLink('') }}
        />
      )}

      {dialog?.kind === 'libStage' && (
        <LibraryDrawer
          title="הוספת שלב" type="stage" items={library}
          emptyLabel="שלב ריק"
          onPick={row => {
            const r = ops.addStage(content, { ...row.payload, libraryId: row.id })
            update(r.content); setOpen(r.id); setDialog(null)
            flash('השלב נוסף — צריך לעדכן את האחוזים במחיר')
          }}
          onPickEmpty={() => {
            const r = ops.addStage(content)
            update(r.content); setOpen(r.id); setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'libTerm' && (
        <LibraryDrawer
          title="הוספת תנאי" type="term" items={library}
          emptyLabel="תנאי ריק"
          onPick={row => {
            const r = ops.addTerm(content, dialog.groupId, { ...row.payload, libraryId: row.id })
            update(r.content); setOpen(r.id); setDialog(null)
          }}
          onPickEmpty={() => {
            const r = ops.addTerm(content, dialog.groupId)
            update(r.content); setOpen(r.id); setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'libExtra' && (
        <LibraryDrawer
          title="הוספת שירות משלים" type="extra" items={library}
          emptyLabel="תוספת ריקה"
          onPick={row => {
            update(c => ops.addExtra(c, { ...row.payload, libraryId: row.id }))
            setDialog(null)
          }}
          onPickEmpty={() => { update(c => ops.addExtra(c)); setDialog(null) }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'rmStage' && (
        <Confirm
          title={`להסיר את השלב "${dialog.stage.formalName || 'ללא שם'}"?`}
          body="האחוזים שלו ישוחררו, וצריך יהיה לחלק אותם מחדש כדי להגיע ל-100%."
          onYes={() => { update(c => ops.removeStage(c, dialog.stage.id)); setDialog(null); flash('השלב הוסר') }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'rmTerm' && (
        <Confirm
          title="להסיר את התנאי?"
          body={dialog.term.formalTitle || dialog.term.question || ''}
          onYes={() => { update(c => ops.removeTerm(c, dialog.term.id)); setDialog(null); flash('התנאי הוסר') }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'rmGroup' && (
        <Confirm
          title={`למחוק את הנושא "${dialog.group.title}"?`}
          body={`יימחקו גם ${(dialog.group.items ?? []).length} התנאים שבו.`}
          onYes={() => { update(c => ops.removeGroup(c, dialog.group.id)); setDialog(null); flash('הנושא נמחק') }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'reset' && (
        <Modal onClose={() => setDialog(null)}>
          <h3>להתחיל מחדש מנוסח הטופס?</h3>
          <p>
            כל הטקסטים, השלבים והתנאים בהצעה הזו יוחלפו בנוסח העדכני של טופס הצעת המחיר,
            עם הפרטים של {[inquiry?.first_name, inquiry?.last_name].filter(Boolean).join(' ')}.
            שכר הטרחה והשטחים יישמרו. אי אפשר לבטל.
          </p>
          <div className="qe-row">
            <button type="button" className="qe-b pri" onClick={() => {
              update(buildQuoteV2Content(template, inquiry, {
                fee: content?.totals?.fee,
                houseArea: content?.property?.houseArea,
                plotArea: content?.property?.plotArea,
              }))
              setOpen(null)
              setDialog(null)
              flash('ההצעה נבנתה מחדש מהטופס')
            }}>בנייה מחדש</button>
            <button type="button" className="qe-b" onClick={() => setDialog(null)}>ביטול</button>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'tplConfirm' && (
        <Modal onClose={() => setDialog(null)}>
          <h3>שמירת התבנית</h3>
          <p>הצעות חדשות ייפתחו מעכשיו עם הנוסח הזה. הצעות שכבר נשלחו לא ישתנו.</p>

          {dialog.changes.length === 0
            ? <p style={{ color: '#8a8680' }}>לא זוהו שינויים לעומת הנוסח השמור.</p>
            : (
              <>
                <p style={{ margin: '14px 0 6px', fontWeight: 500 }}>
                  {dialog.changes.length === 1 ? 'שינוי אחד:' : `${dialog.changes.length} שינויים:`}
                </p>
                <div className="qe-vers">
                  {dialog.changes.map((c, i) => <div className="qe-ck" key={i}><span>·</span><span>{c}</span></div>)}
                </div>
              </>
            )}

          {dialog.warnings.length > 0 && (
            <div className="qe-warn">
              {dialog.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
            </div>
          )}

          {dialog.error && <div className="qe-warn" style={{ background: '#fae3da' }}>❌ {dialog.error}</div>}

          <div className="qe-row">
            <button type="button" className="qe-b pri" disabled={busy === 'save'}
              onClick={() => doSaveTemplate(dialog.next)}>
              {busy === 'save' ? 'שומר…' : 'שמירה'}
            </button>
            <button type="button" className="qe-b" onClick={() => setDialog(null)}>ביטול</button>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'tplVersions' && (
        <Modal onClose={() => setDialog(null)}>
          <h3>גרסאות קודמות</h3>
          {backups.length === 0
            ? <p style={{ color: '#8a8680' }}>עדיין אין גיבויים. גיבוי נוצר אוטומטית בכל שמירה.</p>
            : (
              <div className="qe-vers">
                {backups.map(b => (
                  <button key={b.id} type="button" className="qe-li"
                    onClick={() => setDialog({ kind: 'tplRestore', backup: b })}>
                    <div>
                      <b>{b.name}</b>
                      <span>{new Date(b.updated_at).toLocaleString('he-IL')}</span>
                    </div>
                    <span>שחזור</span>
                  </button>
                ))}
              </div>
            )}
          <div className="qe-row">
            <button type="button" className="qe-b" onClick={() => setDialog(null)}>סגירה</button>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'tplRestore' && (
        <Modal onClose={() => setDialog(null)}>
          <h3>לשחזר את "{dialog.backup.name}"?</h3>
          <p>הנוסח הנוכחי יישמר קודם כגיבוי, כך שאפשר יהיה לחזור אליו.</p>
          {dialog.error && <div className="qe-warn" style={{ background: '#fae3da' }}>❌ {dialog.error}</div>}
          <div className="qe-row">
            <button type="button" className="qe-b pri" disabled={busy === 'restore'}
              onClick={() => restoreTemplate(dialog.backup.content)}>
              {busy === 'restore' ? 'משחזר…' : 'שחזור'}
            </button>
            <button type="button" className="qe-b" onClick={() => setDialog(null)}>ביטול</button>
          </div>
        </Modal>
      )}

      {/* ⚠️ פעם אחת היה כאן כפתור "ביטול" שמשחזר מיד את הנוסח הקודם.
          בעברית "ביטול" נקרא כ"סגירה", והוא נלחץ מיד אחרי שמירה
          מוצלחת והחזיר את התבנית לאחור בלי אישור ובלי דרך לדעת.
          עכשיו הניסוח אומר מה שיקרה, ויש אישור לפני. */}
      {undo && (
        <div className="qe-toast show" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span>✓ התבנית נשמרה</span>
          <button type="button" className="qe-undo" style={{ color: '#f0b38a' }}
            onClick={() => setDialog({ kind: 'tplUndo' })}>
            החזרת הנוסח הקודם
          </button>
          <button type="button" className="qe-undo" style={{ color: '#9aa' }} onClick={() => setUndo(null)}>סגירה</button>
        </div>
      )}

      {dialog?.kind === 'tplUndo' && (
        <Modal onClose={() => setDialog(null)}>
          <h3>להחזיר את הנוסח שהיה לפני השמירה?</h3>
          <p>
            הנוסח שנשמר עכשיו יישמר כגיבוי, והתבנית תחזור למה שהיה לפניו.
            אפשר תמיד לחזור קדימה דרך "גרסאות קודמות".
          </p>
          {dialog.error && <div className="qe-warn">{dialog.error}</div>}
          <div className="qe-row">
            <button type="button" className="qe-b pri" disabled={busy === 'restore'}
              onClick={() => { const prev = undo?.previous; if (prev) restoreTemplate(prev) }}>
              {busy === 'restore' ? 'מחזיר…' : 'החזרה'}
            </button>
            <button type="button" className="qe-b" onClick={() => setDialog(null)}>השארת הנוסח החדש</button>
          </div>
        </Modal>
      )}

      <Toast text={undo ? '' : toast} />
    </div>
  )
}

function Confirm({ title, body, onYes, onClose }) {
  return (
    <Modal onClose={onClose}>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      <div className="qe-row">
        <button type="button" className="qe-b pri" onClick={onYes}>מחיקה</button>
        <button type="button" className="qe-b" onClick={onClose}>ביטול</button>
      </div>
    </Modal>
  )
}
