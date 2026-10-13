// src/pages/intro/introDemo.jsx
//
// The two things the intro screen needs in order to show REAL product
// screens to a client without touching anybody's data:
//
//   <PhoneFrame>   — a real 390×844 CSS viewport, scaled to fit.
//   useDemoReads() — fictional rows, for as long as an area is mounted.
//
// ── WHY A READ STUB AT ALL ───────────────────────────────────────────
// setSupabasePreviewMode(true) blocks every WRITE app-wide, which is
// what keeps this screen harmless. It does not touch reads — and it
// shouldn't. But a demo must not show another family's project either,
// and there is no demo row in the database to point at (creating one
// would be a write).
//
// So each demo area swaps `supabase.from` for a reader over the table
// below, and puts the original back on unmount — the exact same shape
// as the write guard it sits next to. Three properties make it safe:
//   * It is only ever active while a demo area is mounted.
//   * The data is a constant in this file. No real name can reach it.
//   * The write guard is on at the same time, so even a write that
//     somehow got past the stub would be a no-op.
//
// ⚠️ The restore is unconditional (the effect's cleanup), so navigating
// away by ANY route — back control, browser back, closing the tab's
// React tree — leaves the client exactly as it was found.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase, setSupabasePreviewMode } from '../../supabaseClient'

/* ── The fictional family ────────────────────────────────────────────
   Invented, and deliberately not a name any client could mistake for
   their own neighbour: "משפחת ישראלי" reads as an example the way
   "ישראל ישראלי" does on a sample ID card. */
export const DEMO_PROJECT_ID = '00000000-0000-4000-8000-00000000d3m0'
export const DEMO_CLIENT_ID  = '00000000-0000-4000-8000-00000000c11e'

const DEMO_ROWS = {
  projects: [{
    id: DEMO_PROJECT_ID,
    name: 'משפחת ישראלי',
    parent_project_id: null,
    gantt_state: {
      programma: 'done', tikun_rishoni: 'done', bchira_skitsa: 'done',
      tiyuv_skitsa: 'done', ishur_rishoni: 'done', tlat_meimad: 'current',
      tik_meida: 'done',
    },
    client_visible_tabs: {
      file: true, shared: true, meetings: true, progress: true,
      documents: true, finishing: false, contractor: false, quantities: false,
    },
    whatsapp_group_url: null,
    show_programming_questionnaire: true,
  }],
  client_users: [{ id: DEMO_CLIENT_ID, project_id: DEMO_PROJECT_ID, first_name: 'דנה' }],
  /* ⚠️ נדרש: בלי שורה כאן השאלון נופל ל-"בקרוב", כי מסך הלקוח
     האמיתי מניח ששורה כבר נוצרה כשהדליקו את השאלון לפרויקט.
     ריק במכוון — הלקוחות אמורים לראות טופס נקי. */
  programming_questionnaires: [{
    id: '00000000-0000-4000-8000-00000000q001',
    project_id: DEMO_PROJECT_ID,
    answers: {},
    status: 'draft',
    submitted: false,
    submitted_at: null,
  }],
  /* Everything else answers "nothing yet", which is honest: a first
     meeting is exactly the moment when there is nothing in there. */
}

const ok = (data) => Promise.resolve({ data, error: null })

function demoFrom(table) {
  const rows = DEMO_ROWS[table] ?? []
  /* A Proxy rather than a hand-written builder: the portal chains a
     different set of filters on every screen, and a missing method
     would read as a crash in front of a client. Every unknown method
     returns the builder; only the resolvers answer. */
  const b = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => ok(rows).then(res, rej)
      if (prop === 'single' || prop === 'maybeSingle') return () => ok(rows[0] ?? null)
      return () => b
    },
  })
  return b
}

/* ── The swap, kept outside React ──────────────────────────────────
   savedFrom is module level, and is only ever written when the current
   client is NOT already the demo one. That single guard is what makes
   the restore safe no matter how React orders things: a second install
   can never overwrite the real client with the demo one and leave the
   app unable to find its way back.

   (Measured: with the "real" value held in a ref instead, leaving the
   area left supabase.from still pointing at the demo reader — the ref
   had captured the demo function on a later mount.) */
let savedFrom = null

function installDemo() {
  if (supabase.from !== demoFrom) {
    savedFrom = supabase.from
    supabase.from = demoFrom
  }
  setSupabasePreviewMode(true)
}

function restoreReal() {
  if (savedFrom && supabase.from === demoFrom) supabase.from = savedFrom
  savedFrom = null
  setSupabasePreviewMode(false)
}

/**
 * Demo reads + the write guard, both for exactly this component's life.
 *
 * ⚠️ The install happens DURING RENDER, not only in an effect, and that
 * is not sloppiness. React runs a child's effects BEFORE its parent's,
 * so an effect alone would install the stub only after ClientPortal and
 * the questionnaire had already fired their load queries — against the
 * real database, with a project id that does not exist. Measured: the
 * questionnaire fell back to its "בקרוב" placeholder every time.
 *
 * The effect re-installs (StrictMode unmounts and remounts effects in
 * development, and its cleanup puts the real client back) and owns the
 * restore.
 */
export function useDemoReads() {
  installDemo()
  useEffect(() => {
    installDemo()
    return restoreReal
  }, [])
}

/**
 * A phone, at its real size, scaled down to whatever room it is given.
 *
 * The scale is measured rather than assumed: the areas give this a
 * different box on a TV and on a laptop, and a hard-coded factor would
 * leave the phone cropped on one of them.
 */
export function PhoneFrame({ children }) {
  const fitRef = useRef(null)
  const [scale, setScale] = useState(0.6)

  useLayoutEffect(() => {
    const el = fitRef.current
    if (!el) return undefined
    const measure = () => {
      const { width, height } = el.getBoundingClientRect()
      if (!width || !height) return
      /* 408×862 = the 390×844 screen plus the 9px bezel on each side. */
      setScale(Math.min(width / 408, height / 862))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="im-phone-fit" ref={fitRef}>
      <div className="im-phone" style={{ transform: `scale(${scale})` }}>
        <div className="im-phone-screen">{children}</div>
      </div>
    </div>
  )
}
