// src/components/ContractorPreviewOverlay.jsx
//
// Admin-only "תצוגת קבלן" preview — opened from the project settings
// modal (ProjectsKanban.jsx), next to "תצוגת לקוח". Renders the REAL
// contractor portal (ContractorPortal + ContractorDocuments, both
// unmodified) inside the same mobile device frame, as the project's
// assigned contractor would see it — without a contractor auth session
// and without any risk of writing data.
//
// Built on the same three pieces as the client preview:
//   · the device frame and banner markup + ClientPreviewOverlay.css
//   · usePreviewWindow() — spawn position and dragging
//   · setSupabasePreviewMode(true) — the transport-level write guard
//
// ── THE PART THAT IS NOT SHARED, AND WHY ────────────────────────────
// A contractor sees far less than staff, and almost none of that
// narrowing lives in the portal's own code — it lives in RLS. The
// contractor screens therefore query broadly on purpose and let the
// database cut the result down (ContractorDocuments says so in its own
// header: "this screen never re-filters ... and has no 'hidden'
// branch").
//
// An admin running this preview is authenticated as STAFF, so those
// policies do not apply and the same queries would return rows the
// contractor can never reach — hidden documents, documents outside the
// execution-plans sub-stage, and every historical version instead of
// just the latest. A preview that shows more than the real thing is
// worse than no preview.
//
// So the three policies are reproduced here, explicitly, over a scoped
// `supabase.from` installed for the overlay's lifetime:
//
//   contractor_can_read_execution_plan_documents
//     contractor_access IN ('view','sign','approve')
//     AND project_id IN contractor_project_ids()
//     AND sub_stage_id IN execution_plans_sub_stage_ids()
//
//   contractor_can_read_latest_version
//     the document is visible per the above
//     AND id = latest_document_version_id(document_id)
//       ( = order by uploaded_at desc, id desc limit 1 per document )
//
// ⚠️ If those policies change, this file has to change with them. It is
// a MIRROR of the database rules, not a second source of truth — the
// database remains the only thing that actually enforces them.
//
// `execution_plans_sub_stage_ids()` is a SQL function, and rpc() is one
// of the calls the preview guard no-ops, so the sub-stage ids are read
// with a plain SELECT on sub_stages (name = 'תוכניות לביצוע') before
// the guard goes on — the same definition the function has.

import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { supabase, setSupabasePreviewMode } from '../supabaseClient'
import { ContractorContext } from './ContractorRoute'
import ContractorPortal from '../pages/ContractorPortal'
import { usePreviewWindow, usePreviewEscape } from './previewWindow'
import './ClientPreviewOverlay.css'

/* Mirrors execution_plans_sub_stage_ids(). */
const EXECUTION_PLANS_SUB_STAGE = 'תוכניות לביצוע'
/* Mirrors the contractor_access list in both read policies. */
const CONTRACTOR_VISIBLE_ACCESS = ['view', 'sign', 'approve']

/**
 * Wraps a PostgREST builder so the rows it resolves to pass through
 * `transform` first. Every chain method is forwarded and returns the
 * wrapper, so callers keep chaining normally and never learn about it.
 *
 * ⚠️ The transform runs on the RESOLVED rows, not as another filter, so
 * it works for rules PostgREST cannot express — "latest version per
 * document" being the one that matters here.
 */
function wrapRows(builder, transform, extraSelect = '') {
  const CHAIN = [
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is',
    'in', 'contains', 'not', 'or', 'filter', 'order', 'limit', 'range',
  ]
  const wrapper = {
    then(onOk, onErr) {
      return Promise.resolve(builder).then(res => {
        if (res?.error || !Array.isArray(res?.data)) return res
        return { ...res, data: transform(res.data) }
      }).then(onOk, onErr)
    },
    catch(onErr) { return this.then(undefined, onErr) },
    finally(fn) { return this.then(v => { fn?.(); return v }, e => { fn?.(); throw e }) },
  }
  /* ⚠️ select() is special: the rules need columns the screen does not
     ask for (sub_stage_id, project_id). They are appended to the
     caller's own list — PostgREST REPLACES on a second select(), so
     they cannot be requested in a separate call. Extra columns in the
     response are harmless; the screen reads the ones it named. */
  wrapper.select = (cols, ...rest) => {
    const merged = extraSelect ? `${cols}, ${extraSelect}` : cols
    const next = builder.select(merged, ...rest)
    if (next) builder = next
    return wrapper
  }
  for (const m of CHAIN) {
    wrapper[m] = (...args) => {
      const next = builder[m]?.(...args)
      if (next) builder = next
      return wrapper
    }
  }
  for (const m of ['maybeSingle', 'single']) {
    wrapper[m] = (...args) => builder[m]?.(...args)
  }
  return wrapper
}

/** שם התצוגה של בעל המקצוע — שם פרטי+משפחה, ואם אין, שם העסק. */
function displayNameOf(pro) {
  if (!pro) return ''
  return [pro.first_name, pro.last_name].filter(Boolean).join(' ').trim()
    || (pro.business_name || '').trim()
    || 'הקבלן'
}

export default function ContractorPreviewOverlay({ project, contractorId, onClose }) {
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [pro, setPro] = useState(null)
  const { pos, frameRef, startDrag, stopDragPropagation } = usePreviewWindow(phase === 'ready')
  usePreviewEscape(true, onClose)

  /* ⚠️ Module-level, not a ref: React runs a child's effects before the
     parent's, so a ref written in this component's effect would still be
     empty when ContractorPortal's own effect fires its first query. The
     scoped reader is therefore installed during RENDER, below, and this
     holds the original so it can always be put back. */
  const savedFrom = useRef(null)

  /* ── Identity + the data the scoped reader needs ──
     Runs before the write guard goes on, because it needs a real read
     of sub_stages. */
  const execIdsRef = useRef([])
  const projectIdsRef = useRef([])
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setPhase('loading')
      if (!project?.id || !contractorId) { setPhase('error'); return }

      const [{ data: prof }, { data: subs }, { data: links }] = await Promise.all([
        supabase.from('professionals')
          .select('id, first_name, last_name, business_name, portal_access')
          .eq('id', contractorId).maybeSingle(),
        supabase.from('sub_stages').select('id').eq('name', EXECUTION_PLANS_SUB_STAGE),
        /* Mirrors contractor_project_ids(): the projects this
           professional is the contractor on. */
        supabase.from('client_info').select('project_id').eq('contractor_id', contractorId),
      ])
      if (cancelled) return
      if (!prof) { setPhase('error'); return }

      execIdsRef.current = (subs || []).map(s => s.id)
      projectIdsRef.current = (links || []).map(r => r.project_id).filter(Boolean)
      setPro(prof)
      setPhase('ready')
    }
    load()
    return () => { cancelled = true }
  }, [project?.id, contractorId])

  /* ── The write guard, for the overlay's whole lifetime ──
     Off unconditionally on unmount — including an accidental one — so a
     preview can never leave the app locked down. */
  useEffect(() => {
    setSupabasePreviewMode(true)
    return () => setSupabasePreviewMode(false)
  }, [])

  /* ── The scoped reader ──
     Installed during RENDER (see savedFrom's comment) and removed on
     unmount. Only the two contractor-visible tables are narrowed; every
     other table the portal touches passes straight through. */
  if (phase === 'ready' && !savedFrom.current) {
    /* ⚠️ הרפרנס עצמו, בלי bind. supabase.from הוא פונקציית חץ
       ב-supabaseClient ואינו צריך this, ו-bind היה מחזיר פונקציה
       חדשה בכל פתיחה — כלומר שכבה נוספת בכל מחזור פתיחה/סגירה
       במקום שחזור מדויק. */
    const original = supabase.from
    savedFrom.current = original
    const scoped = (table) => {
      const b = original(table)
      if (table === 'project_documents') {
        return wrapRows(
          b,
          rows => rows.filter(d =>
            CONTRACTOR_VISIBLE_ACCESS.includes(d.contractor_access)
            && execIdsRef.current.includes(d.sub_stage_id)
            && projectIdsRef.current.includes(d.project_id)),
          'sub_stage_id, project_id',
        )
      }
      if (table === 'document_versions') {
        return wrapRows(b, rows => {
          const best = new Map()
          for (const v of rows) {
            const cur = best.get(v.document_id)
            const newer = !cur
              || String(v.uploaded_at ?? '') > String(cur.uploaded_at ?? '')
              || (String(v.uploaded_at ?? '') === String(cur.uploaded_at ?? '') && String(v.id) > String(cur.id))
            if (newer) best.set(v.document_id, v)
          }
          return [...best.values()]
        })
      }
      return b
    }
    supabase.from = scoped
  }
  useEffect(() => () => {
    if (savedFrom.current) { supabase.from = savedFrom.current; savedFrom.current = null }
  }, [])

  /* ── העץ הפנימי, בשורש משלו ──
     נבנה כשהתצוגה מוכנה, ומפורק בניקוי. ⚠️ ה-unmount נדחה
     ב-setTimeout: פירוק שורש בתוך מחזור ה-commit של React מייצר
     אזהרה, וזה בדיוק מה שקורה כשסוגרים את השכבה. */
  const mountRef = useRef(null)
  const rootRef = useRef(null)
  useEffect(() => {
    if (phase !== 'ready') return undefined
    const node = mountRef.current
    if (!node || rootRef.current) return undefined
    const root = createRoot(node)
    rootRef.current = root
    root.render(
      <ContractorContext.Provider
        value={{
          id: `preview-${contractorId}`,
          professional_id: contractorId,
          email: '',
          displayName: displayNameOf(pro),
          previewMode: true,
        }}
      >
        <MemoryRouter initialEntries={[`/contractor/${project.id}`]}>
          <Routes>
            <Route path="/contractor" element={<ContractorPortal />} />
            <Route path="/contractor/:projectId" element={<ContractorPortal />} />
          </Routes>
        </MemoryRouter>
      </ContractorContext.Provider>
    )
    return () => {
      rootRef.current = null
      setTimeout(() => root.unmount(), 0)
    }
  }, [phase, contractorId, project?.id, pro])

  const name = displayNameOf(pro)

  if (phase !== 'ready') {
    return (
      <div className="cpv-status-panel" dir="rtl" style={{ left: pos.x, top: pos.y }}>
        <div className="cpv-status-header" onMouseDown={startDrag}>
          <span>תצוגת קבלן</span>
          <button type="button" className="cpv-close-btn"
            onMouseDown={stopDragPropagation} onClick={onClose}
            aria-label="סגור תצוגת קבלן" title="סגור תצוגת קבלן">✕</button>
        </div>
        <p className="cpv-status-text">
          {phase === 'loading' ? 'טוען...' : 'שגיאה בטעינת הקבלן של הפרויקט.'}
        </p>
      </div>
    )
  }

  return (
    <div className="cpv-device-frame" dir="rtl" ref={frameRef} style={{ left: pos.x, top: pos.y }}>
      <div className="cpv-device-screen">
        <div className="cpv-device-notch" aria-hidden="true" />
        <div className="cpv-preview-banner" onMouseDown={startDrag}>
          <span className="cpv-preview-banner-text">
            תצוגה מקדימה · כך רואה {name} את המערכת
            {/* ⚠️ בעל מקצוע בלי גישה עדיין ניתן לתצוגה מקדימה — זו
                בדיוק השאלה "מה הוא יראה כשניתן לו גישה". */}
            {pro?.portal_access === false && (
              <><br />לבעל המקצוע אין עדיין גישה למערכת</>
            )}
          </span>
          <button type="button" className="cpv-close-btn cpv-close-btn--frame"
            onMouseDown={stopDragPropagation} onClick={onClose}
            aria-label="סגור תצוגת קבלן" title="סגור תצוגת קבלן">✕</button>
        </div>
        {/* ⚠️ מורכב בשורש React נפרד, ולא כילד של העץ הזה.
            ContractorPortal קורא ‎:projectId ומנווט — הוא חייב
            ‎MemoryRouter משלו, ו-react-router 6 זורק על Router בתוך
            Router. שורש נפרד מתחיל עץ בלי ה-BrowserRouter של
            האפליקציה בהקשר, ולכן ה-MemoryRouter שם חוקי; ה-URL של
            המנהלת לא זז. ראו mountRef למטה. */}
        <div className="cpv-portal-mount" ref={mountRef} />
      </div>
    </div>
  )
}
