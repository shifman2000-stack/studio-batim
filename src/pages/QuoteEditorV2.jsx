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

import { clientCountOf, varsOf } from '../lib/quoteV2/content'
import { isFrozen, freeze, unfreeze, templateRawOf } from '../lib/quoteV2/linked'
import { buildTemplateUpdate } from '../lib/quoteV2/templateSync'
import { stagesOf, termGroupsOf } from '../lib/quoteV2/validate'
import * as ops from '../lib/quoteV2/editorOps'

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

export default function QuoteEditorV2() {
  const { quoteId } = useParams()
  const navigate = useNavigate()

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

      setQuote(q.data)
      setTemplate(tpl.data?.content ?? null)
      setLibrary(lib.data ?? [])
      setContent(q.data.draft_content)
      setLastSent(versions?.[0] ?? null)
      setState('ready')
    }
    run()
    return () => { cancelled = true }
  }, [quoteId, navigate])

  /* ── נעילה ───────────────────────────────────────────────────── */
  const signed = !!lastSent?.is_signed
  const readOnly = signed

  /* ── שמירה אוטומטית ──────────────────────────────────────────── */
  useEffect(() => {
    if (state !== 'ready' || !dirty.current || readOnly) return
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
  }, [content, state, quoteId, readOnly])

  const update = useCallback(fn => {
    dirty.current = true
    setContent(prev => (typeof fn === 'function' ? fn(prev) : fn))
  }, [])

  const flash = t => { setToast(t); setTimeout(() => setToast(''), 1800) }

  /* ── נגזרות ──────────────────────────────────────────────────── */
  const vars = useMemo(() => varsOf(content), [content])
  const nClients = useMemo(() => clientCountOf(content), [content])
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
    bind: (id, field, raw) => ({
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
    }),
  }), [content, template, vars, nClients, update])

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

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); flash('הקישור הועתק') }
    catch { flash('לא הצלחתי להעתיק — אפשר לסמן ולהעתיק ידנית') }
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
        <h1>הצעת מחיר <small>{who ? '· ' + who : ''}</small></h1>
        <span className={'qe-saved' + (saved === 'השמירה נכשלה' ? ' err' : '')}>
          {readOnly ? 'הצעה חתומה — קריאה בלבד' : saved}
        </span>
        <span className="qe-sp" />
        <button type="button" className="qe-b" onClick={() => setDialog({ kind: 'preview' })}>👁 תצוגה מקדימה</button>
        {!readOnly && (
          <button type="button" className="qe-b pri" onClick={() => { setLink(''); setSendError(''); setDialog({ kind: 'send' }) }}>
            שליחה ללקוח
          </button>
        )}
      </div>

      <div className="qe-wrap">
        {readOnly ? (
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
          onFee={v => update(c => ops.setFee(c, v))}
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

      <Toast text={toast} />
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
