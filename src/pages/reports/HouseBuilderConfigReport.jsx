// src/pages/reports/HouseBuilderConfigReport.jsx
//
// Admin-only report under the "דוחות" tab:
//   "אפיון מערכת בונה הבית"
//
// PHASE 3 — every room field is editable: name, sizes S/M/L, showSize,
// defaultSize, the "גודל קבוע" toggle (fixedArea, mutually exclusive
// with sized-mode), container toggle + allowedChildren / autoChildren
// / requiredTypes as chip multi-selects (auto ⊆ allowed, required ⊆
// allowed; nesting containers refused by both UI and validator), and
// the full props editor (add / remove / reorder fields; edit title,
// noTitle, single/multi type; add / remove / reorder / edit options).
// validateConfig grew per-room invariants; save is still blocked
// until the errors banner clears.
//
// PHASE 2 — floors (name inline) + per-floor palette (add / remove /
// reorder) + "create new room type" are editable in the working copy.
//
// PHASE 1 (baseline) — read-only display + save-round-trip.
//   * Load the ACTIVE house_builder_config row on mount.
//   * A "שמור" button UPDATEs the same object back to the DB (proves
//     the read → display → save cycle end-to-end + confirms RLS lets
//     an admin write).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { DEFAULT_CALC_PARAMS } from '../../lib/houseSizeConfig'
import '../ReportTable.css'

/* Design tokens (mirrors theme.css). Kept as constants so the inline
   styles below stay readable. */
const CREAM     = '#f7f5f2'
const CHARCOAL  = '#1a1a18'
const SAGE      = '#7a9478'
const SAGE_DARK = '#5d7259'
const BORDER    = 'rgba(26,26,24,0.13)'
const MUTED     = '#8a8680'
const AMBER     = '#c98a3a'
const DANGER    = '#c94b4b'

/* The ONE hardcoded container-in-container exception. HouseBuilderV2.jsx
   allows nesting "יחידת סוויטה" inside "יחידת דיור" UNCONDITIONALLY in
   code (see DWELLING_UNIT_TYPE / SUITE_UNIT_TYPE there) — this config's
   allowedChildren value for that pairing has NO effect on the live
   builder either way. The literals are mirrored here only so the
   report's allowedChildren editor and validators can recognize and
   allow the one legitimate exception instead of flagging it as invalid
   nesting; this is not a second source of truth for the behavior
   itself, which stays entirely code-enforced. */
const DWELLING_UNIT_TYPE = 'יחידת דיור'
const SUITE_UNIT_TYPE    = 'יחידת סוויטה'

export default function HouseBuilderConfigReport() {
  const navigate = useNavigate()
  const [role, setRole] = useState(null)

  /* Load-state machine — one of 'loading' | 'ready' | 'empty' | 'error'.
     'empty' == the table has no is_active=true row (a valid state the
     view has to handle without crashing). */
  const [phase,   setPhase]   = useState('loading')
  const [errMsg,  setErrMsg]  = useState('')

  /* Local WORKING copy of the loaded config. Phase 2 mutates this
     object via the setters below; save UPDATEs the whole thing back
     to the DB in one call. `originalConfig` is the snapshot of what
     we last synced with the DB — dirty = current !== original. */
  const [configId, setConfigId]           = useState(null)
  const [version,  setVersion]            = useState(null)
  const [config,   setConfig]             = useState(null)
  const [originalConfig, setOriginalConfig] = useState(null)

  /* Save-state — one of 'idle' | 'saving' | 'saved' | 'error'. */
  const [saveState, setSaveState] = useState('idle')
  const [saveError, setSaveError] = useState('')

  /* Accordion state — start EMPTY (everything collapsed). Independent
     toggles: opening one doesn't close others. Not persisted; resets
     to fully-collapsed on every mount.
       * openSections: which of the three top-level panels are open,
         keyed by 'floors' | 'palette' | 'rooms'.
       * openFloors:   which floor cards inside the "palette" section
         are open, keyed by floor key. Separate set so a floor key
         can't collide with a section or room key.
       * openRooms:    which room-type cards are open, keyed by type. */
  const [openSections, setOpenSections] = useState(() => new Set())
  const [openFloors,   setOpenFloors]   = useState(() => new Set())
  const [openRooms,    setOpenRooms]    = useState(() => new Set())

  const toggleSection = (key) => setOpenSections(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleFloor = (key) => setOpenFloors(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleRoom = (key) => setOpenRooms(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  /* ── Admin guard — same pattern as InquiriesReport / HoursReport. */
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')
    }
    init()
  }, [])

  /* ── Load the active row once admin is confirmed. */
  useEffect(() => {
    if (role !== 'admin') return
    let cancelled = false
    const load = async () => {
      setPhase('loading')
      setErrMsg('')
      try {
        const { data, error } = await supabase
          .from('house_builder_config')
          .select('id, config, version')
          .eq('is_active', true)
          .maybeSingle()
        if (cancelled) return
        if (error) {
          setErrMsg(error.message || 'שגיאה בטעינת הקונפיג')
          setPhase('error')
          return
        }
        if (!data) {
          setPhase('empty')
          return
        }
        setConfigId(data.id)
        setVersion(data.version)
        /* Deep-clone via JSON so the local working copy is fully
           detached from the DB object. A SECOND deep-clone into
           `originalConfig` freezes what "clean" means for dirty
           tracking — mutations to `config` never leak into it.
           calcParams is normalized identically into BOTH clones — a
           row saved before "פרמטרי מחשבון" existed (or with only some
           of the three keys) shows the fallback defaults without
           tripping the dirty indicator on load. */
        const normalizeCalcParams = (c) => ({
          ...c,
          calcParams: {
            ...DEFAULT_CALC_PARAMS,
            ...((c && c.calcParams && typeof c.calcParams === 'object') ? c.calcParams : {}),
          },
        })
        const cloneCurrent  = normalizeCalcParams(JSON.parse(JSON.stringify(data.config || {})))
        const cloneOriginal = normalizeCalcParams(JSON.parse(JSON.stringify(data.config || {})))
        setConfig(cloneCurrent)
        setOriginalConfig(cloneOriginal)
        setPhase('ready')
      } catch (e) {
        if (cancelled) return
        setErrMsg(e.message || String(e))
        setPhase('error')
      }
    }
    load()
    return () => { cancelled = true }
  }, [role])

  /* ── Working-copy mutators ─────────────────────────────────────
     All mutators use functional setState so callers don't have to
     sequence updates. Nothing here touches the DB — mutations stay
     in the local working copy until "שמור" runs the UPDATE. */

  /* Calculator params ("פרמטרי מחשבון") — corridorsPct / wallsPct /
     toleranceDeviationPct. Each field updates independently. */
  const updateCalcParam = (key, value) => {
    setConfig(c => ({
      ...c,
      calcParams: { ...(c.calcParams || DEFAULT_CALC_PARAMS), [key]: value },
    }))
  }

  /* Floors: update just the display name of one floor. Adding /
     removing floors and changing key/isYard are OUT OF SCOPE for
     phase 2 (per spec — floor structure is more sensitive). */
  const updateFloorName = (floorKey, nextName) => {
    setConfig(c => ({
      ...c,
      floors: (c.floors || []).map(f =>
        f && f.key === floorKey ? { ...f, name: nextName } : f
      ),
    }))
  }

  const addToFloorPalette = (floorKey, type) => {
    if (!type) return
    setConfig(c => {
      const cur = Array.isArray(c.palette?.[floorKey]) ? c.palette[floorKey] : []
      if (cur.includes(type)) return c
      return { ...c, palette: { ...(c.palette || {}), [floorKey]: [...cur, type] } }
    })
  }

  const removeFromFloorPalette = (floorKey, index) => {
    setConfig(c => {
      const cur = Array.isArray(c.palette?.[floorKey]) ? c.palette[floorKey] : []
      const next = cur.filter((_, i) => i !== index)
      return { ...c, palette: { ...(c.palette || {}), [floorKey]: next } }
    })
  }

  const moveFloorPaletteItem = (floorKey, index, direction) => {
    setConfig(c => {
      const cur    = Array.isArray(c.palette?.[floorKey]) ? c.palette[floorKey] : []
      const target = index + direction
      if (target < 0 || target >= cur.length) return c
      const next = [...cur]
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...c, palette: { ...(c.palette || {}), [floorKey]: next } }
    })
  }

  /* Create a new room type in config.rooms with sensible defaults.
     `nameInput` is the user-supplied Hebrew display name; `keyInput`
     is an optional explicit key (auto-derived from the name when
     empty — the existing config already uses Hebrew display names AS
     the code keys, so identity is the natural default). Returns an
     error string on failure so the caller can surface it inline. */
  const createRoomType = (nameInput, keyInput) => {
    const name = (nameInput || '').trim()
    const key  = ((keyInput  || '').trim()) || name
    if (!name) return 'חסר שם לסוג החלל.'
    if (!key)  return 'חסר מפתח לסוג החלל.'
    /* Read the current config from the closure (state on the last
       render) for the duplicate check — React's async setState timing
       means the return value can't wait on the updater's decision. */
    if (config && config.rooms && Object.prototype.hasOwnProperty.call(config.rooms, key)) {
      return `כבר קיים סוג חלל עם המפתח "${key}".`
    }
    setConfig(c => {
      const rooms = c.rooms || {}
      /* Belt & suspenders inside the updater — if a fast retry fires
         two creates before a re-render, refuse to silently overwrite. */
      if (Object.prototype.hasOwnProperty.call(rooms, key)) return c
      const newDef = {
        name,
        sizes:            { S: 0, M: 0, L: 0 },
        fixedArea:        null,
        excludeFromAreaCalc: false,
        showSize:         true,
        defaultSize:      'M',
        isContainer:      false,
        allowedChildren:  [],
        autoChildren:     [],
        requiredTypes:    [],
        props:            [],
      }
      return { ...c, rooms: { ...rooms, [key]: newDef } }
    })
    return null
  }

  /* Single generic entry point for every per-room-def edit. Sub-
     components (SizeEditor / ContainerEditor / PropsEditor) call
     `onUpdate(def => nextDef)` with a small pure function and never
     have to know the outer state shape. */
  const updateRoomDef = (type, updater) => {
    setConfig(c => {
      const rooms = c.rooms || {}
      const current = rooms[type]
      if (!current) return c
      const next = updater(current)
      if (next === current) return c
      return { ...c, rooms: { ...rooms, [type]: next } }
    })
  }

  /* ── Dirty tracking + validation ───────────────────────────────
     Cheap enough at this size (a few dozen keys) that stringify is
     fine and correct. Recomputes only when the working copy changes. */
  const dirty = useMemo(() => {
    if (!config || !originalConfig) return false
    return JSON.stringify(config) !== JSON.stringify(originalConfig)
  }, [config, originalConfig])

  const validationErrors = useMemo(
    () => (config ? validateConfig(config) : []),
    [config]
  )

  /* Per-section / per-room issue markers — surface a red dot on the
     accordion header when the collapsed contents contain a validation
     error, so the admin can find them without opening every panel.
     The top-of-page banner keeps listing ALL error messages regardless. */
  const roomsWithIssues = useMemo(() => {
    const set = new Set()
    if (!config || !config.rooms) return set
    for (const [t, d] of Object.entries(config.rooms)) {
      if (roomHasIssue(t, d, config.rooms)) set.add(t)
    }
    return set
  }, [config])

  const sectionWarnings = useMemo(() => {
    if (!config) return { floors: false, palette: false, rooms: false }
    const rooms = config.rooms || {}
    const roomKeys = new Set(Object.keys(rooms))
    return {
      calcParams: calcParamsHasIssue(config.calcParams),
      /* No section-1 (floor structure) validation runs today; the flag
         stays false so no misleading dot appears. */
      floors:  false,
      palette: paletteHasIssue(config.palette, roomKeys),
      rooms:   roomsWithIssues.size > 0,
    }
  }, [config, roomsWithIssues])

  /* ── Save — in-place UPDATE against the active row.
     Phase 2: blocks when the working copy is invalid, and refreshes
     `originalConfig` on success so the dirty indicator resets. */
  const handleSave = async () => {
    if (!config) return
    /* Save-time validation — belt & suspenders. The UI already
       disables the button when this array is non-empty, but a
       defensive check catches any state where dirty edits + a
       fast-clicked keyboard user could slip in. */
    if (validationErrors.length > 0) {
      setSaveState('error')
      setSaveError(validationErrors[0])
      return
    }
    setSaveState('saving')
    setSaveError('')
    try {
      const { error } = await supabase
        .from('house_builder_config')
        .update({ config })
        .eq('is_active', true)
      if (error) {
        setSaveState('error')
        setSaveError(error.message || 'שגיאה בשמירה')
        return
      }
      /* Refresh the clean-snapshot so "dirty" resets. Use a fresh
         deep-clone so future mutations of `config` don't leak. */
      setOriginalConfig(JSON.parse(JSON.stringify(config)))
      setSaveState('saved')
      /* Auto-fade the "saved" indicator after a beat. */
      setTimeout(() => setSaveState('idle'), 2500)
    } catch (e) {
      setSaveState('error')
      setSaveError(e.message || String(e))
    }
  }

  if (role !== 'admin') return null

  return (
    <div className="report-table-page" dir="rtl" style={{ background: CREAM, minHeight: '100vh' }}>
      <div className="report-header-row">
        <h1 className="report-page-title">אפיון מערכת בונה הבית</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>← חזרה לדוחות</button>
      </div>

      {phase === 'loading' && (
        <p style={{ color: MUTED, padding: '24px 0' }}>טוען...</p>
      )}

      {phase === 'error' && (
        <div style={panelBoxStyle('#c94b4b')}>
          <div style={{ fontWeight: 600, color: '#c94b4b', marginBottom: 6 }}>שגיאה בטעינת הקונפיג</div>
          <div style={{ fontSize: 13, color: CHARCOAL }}>{errMsg}</div>
        </div>
      )}

      {phase === 'empty' && (
        <div style={panelBoxStyle(SAGE)}>
          <div style={{ fontWeight: 600, color: SAGE_DARK, marginBottom: 6 }}>לא נמצאה שורת קונפיג פעילה</div>
          <div style={{ fontSize: 13, color: CHARCOAL }}>
            הטבלה <code>public.house_builder_config</code> ריקה או שאין שורה עם <code>is_active = true</code>.
            הרץ את סקריפט ה־seed כדי להוסיף שורה ראשונה, ואז רענן את הדף.
          </div>
        </div>
      )}

      {phase === 'ready' && config && (
        <>
          {/* Action bar — metadata + dirty indicator + save button */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '10px 12px', marginBottom: 14,
            background: '#ffffff',
            border: `1px solid ${dirty ? AMBER : BORDER}`,
            borderRadius: 8,
            transition: 'border-color 0.15s',
          }}>
            <div style={{ fontSize: 13, color: MUTED }}>
              מזהה שורה: <b style={{ color: CHARCOAL }}>{configId}</b>
              &nbsp;·&nbsp;
              גרסה: <b style={{ color: CHARCOAL }}>{version}</b>
              &nbsp;·&nbsp;
              is_active: <b style={{ color: SAGE_DARK }}>true</b>
            </div>
            <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {dirty && saveState === 'idle' && (
                <span style={{ color: AMBER, fontSize: 13, fontWeight: 600 }}>
                  יש שינויים שלא נשמרו
                </span>
              )}
              {saveState === 'saved' && (
                <span style={{ color: SAGE_DARK, fontSize: 13 }}>נשמר ✓</span>
              )}
              {saveState === 'error' && (
                <span style={{ color: DANGER, fontSize: 13 }}>שגיאה: {saveError}</span>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={saveState === 'saving' || !dirty || validationErrors.length > 0}
                title={
                  validationErrors.length > 0 ? validationErrors[0]
                    : (!dirty ? 'אין שינויים לשמור' : 'שמור את הקונפיג')
                }
                style={{
                  background: (!dirty || validationErrors.length > 0) ? '#eeebe6' : (dirty ? AMBER : SAGE),
                  color:      (!dirty || validationErrors.length > 0) ? MUTED     : '#ffffff',
                  border: `1px solid ${
                    validationErrors.length > 0 ? DANGER
                      : (dirty ? AMBER : SAGE_DARK)
                  }`,
                  borderRadius: 8,
                  padding: '8px 16px', fontFamily: 'inherit', fontSize: 14,
                  fontWeight: dirty ? 700 : 400,
                  cursor: (saveState === 'saving' || !dirty || validationErrors.length > 0) ? 'not-allowed' : 'pointer',
                  opacity: saveState === 'saving' ? 0.7 : 1,
                  transition: 'background 0.15s, color 0.15s',
                }}
              >
                {saveState === 'saving' ? 'שומר...' : 'שמור'}
              </button>
            </div>
          </div>

          {/* Validation errors banner — blocks save while non-empty. */}
          {validationErrors.length > 0 && (
            <div style={{
              background: '#ffffff', border: `1px solid ${DANGER}`,
              borderInlineStart: `4px solid ${DANGER}`,
              borderRadius: 8, padding: '10px 14px', marginBottom: 14,
            }}>
              <div style={{ fontWeight: 700, color: DANGER, marginBottom: 6, fontSize: 14 }}>
                לא ניתן לשמור — יש שגיאות אימות ({validationErrors.length}):
              </div>
              <ul style={{ margin: 0, paddingInlineStart: 20, color: CHARCOAL, fontSize: 13, lineHeight: 1.6 }}>
                {validationErrors.map((msg, i) => (
                  <li key={i}>{msg}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Section 0 — calculator params (מעברים / עובי קירות / אחוז סטייה מותר) */}
          <Section
            title="פרמטרי מחשבון"
            isOpen={openSections.has('calcParams')}
            onToggle={() => toggleSection('calcParams')}
            hasIssue={sectionWarnings.calcParams}
          >
            <CalcParamsEditor
              calcParams={config.calcParams || DEFAULT_CALC_PARAMS}
              onUpdate={updateCalcParam}
            />
          </Section>

          {/* Section 1 — floors (name inline-editable) */}
          <Section
            title="מפלסים"
            isOpen={openSections.has('floors')}
            onToggle={() => toggleSection('floors')}
            hasIssue={sectionWarnings.floors}
          >
            <FloorsTable
              floors={config.floors || []}
              onUpdateFloorName={updateFloorName}
            />
          </Section>

          {/* Section 2 — palette per floor (add / remove / reorder) */}
          <Section
            title="חללים לפי מפלס"
            isOpen={openSections.has('palette')}
            onToggle={() => toggleSection('palette')}
            hasIssue={sectionWarnings.palette}
          >
            <PalettePerFloor
              floors={config.floors || []}
              palette={config.palette || {}}
              rooms={config.rooms || {}}
              onAdd={addToFloorPalette}
              onRemove={removeFromFloorPalette}
              onMove={moveFloorPaletteItem}
              openFloors={openFloors}
              onToggleFloor={toggleFloor}
            />
          </Section>

          {/* Section 3 — rooms */}
          <Section
            title="מאפייני חללים"
            isOpen={openSections.has('rooms')}
            onToggle={() => toggleSection('rooms')}
            hasIssue={sectionWarnings.rooms}
          >
            <NewRoomTypeForm
              existingKeys={Object.keys(config.rooms || {})}
              onCreate={createRoomType}
            />
            <RoomsList
              rooms={config.rooms || {}}
              onUpdateRoom={updateRoomDef}
              openRooms={openRooms}
              onToggleRoom={toggleRoom}
              roomsWithIssues={roomsWithIssues}
            />
          </Section>
        </>
      )}
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════
   Sub-components
   ═════════════════════════════════════════════════════════════════ */

function Section({ title, children, isOpen, onToggle, hasIssue }) {
  const clickable = typeof onToggle === 'function'
  return (
    <section style={{
      background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 8,
      marginBottom: 16, overflow: 'hidden',
    }}>
      {/* Header — clickable button. Native <button> gets keyboard
          activation (Enter / Space) and focus ring for free. */}
      <button
        type="button"
        onClick={clickable ? onToggle : undefined}
        aria-expanded={!!isOpen}
        aria-controls={undefined}
        disabled={!clickable}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%',
          padding: '12px 16px',
          background: isOpen ? '#faf9f7' : '#ffffff',
          border: 'none',
          borderBottom: isOpen ? `1px solid ${BORDER}` : 'none',
          cursor: clickable ? 'pointer' : 'default',
          textAlign: 'right', direction: 'rtl',
          fontFamily: 'inherit',
          transition: 'background 0.15s',
        }}
      >
        {/* Chevron rendered FIRST so, in this RTL row, it lands on the
            visual-right — start-of-line in Hebrew reading order. */}
        {clickable && <Chevron open={!!isOpen} />}
        {hasIssue && <IssueDot title="יש שגיאות אימות בסעיף הזה" />}
        <h2 style={{
          margin: 0, fontSize: 17, fontWeight: 700, color: CHARCOAL,
          textAlign: 'right', flex: 1,
        }}>
          {title}
        </h2>
      </button>
      {/* Body — kept mounted at all times; hidden via CSS when collapsed
          so that any local state inside sub-editors (e.g. the "חלל אחר"
          add-row dropdown, the new-room-type form fields) isn't lost.
          Editors write their changes into the working-copy config via
          the top-level mutators, so unmounting would be safe too — but
          hide-via-display is the simplest way to guarantee zero data
          loss regardless of what state descendants might hold. */}
      <div
        role="region"
        aria-hidden={!isOpen}
        style={{
          padding: isOpen ? '14px 16px' : 0,
          display: isOpen ? 'block' : 'none',
        }}
      >
        {children}
      </div>
    </section>
  )
}

/* Small SVG chevron. Rotates 180° when open. Sage-tinted stroke so it
   reads as a decorative affordance, not a warning. RTL-agnostic — it's
   a vertical caret. */
function Chevron({ open }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke={SAGE_DARK} strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/* Red pill marker rendered on a collapsed section/room header when
   the corresponding contents fail validation. The always-on banner at
   the top of the page still lists every error; this dot is just a
   navigation aid so the admin can find the offending panel. */
function IssueDot({ title }) {
  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-block',
        width: 10, height: 10, borderRadius: '50%',
        background: DANGER,
        flexShrink: 0,
      }}
    />
  )
}

/* ─────────────────────────────────────────────────────────────────
   CalcParamsEditor — three numeric % fields feeding the house-size
   calculator (מעברים + עובי קירות added on top of the summed room
   areas — see estimateArea() in houseSizeConfig.js) and the
   questionnaire hub's target-size match/exceeds comparison
   (אחוז סטייה מותר — see ClientProgrammingQuestionnaire.jsx). Rendered
   with direction: rtl in a 3-column grid, so the FIRST field (מעברים)
   lands rightmost — matches the RTL convention used across this page.
   ───────────────────────────────────────────────────────────────── */
const CALC_PARAM_FIELDS = [
  { key: 'corridorsPct',           label: 'מעברים (%)',            hint: 'אחוז שמתווסף על סכום שטחי החללים בחישוב שטח הבית.' },
  { key: 'wallsPct',                label: 'עובי קירות (%)',        hint: 'אחוז נוסף שמתווסף על סכום שטחי החללים, לצד מעברים.' },
  { key: 'toleranceDeviationPct',  label: 'אחוז סטייה מותר (%)',   hint: 'הסטייה המותרת בין השטח המחושב ליעד הלקוח (שאלון פרוגרמה) — קובעת התאמה (ירוק) מול חריגה (אדום).' },
]

function CalcParamsEditor({ calcParams, onUpdate }) {
  const cp = (calcParams && typeof calcParams === 'object') ? calcParams : DEFAULT_CALC_PARAMS
  const setParam = (key, raw) => {
    const v = raw === '' ? 0 : Number(raw)
    onUpdate(key, Number.isFinite(v) ? v : 0)
  }
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))',
      gap: 12, direction: 'rtl',
    }}>
      {CALC_PARAM_FIELDS.map(f => (
        <div key={f.key}>
          <label style={formLabelStyle}>{f.label}</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={cp[f.key] ?? 0}
            onChange={(e) => setParam(f.key, e.target.value)}
            style={formInputStyle}
          />
          {f.hint && (
            <div style={{ color: MUTED, fontSize: 11, marginTop: 4 }}>{f.hint}</div>
          )}
        </div>
      ))}
    </div>
  )
}

function FloorsTable({ floors, onUpdateFloorName }) {
  if (!Array.isArray(floors) || floors.length === 0) {
    return <div style={{ color: MUTED, fontSize: 13 }}>אין מפלסים.</div>
  }
  return (
    <table style={tableStyle}>
      <thead>
        <tr style={theadRowStyle}>
          <th style={thStyle}>שם המפלס</th>
          <th style={thStyle}>key</th>
          <th style={thStyle}>חצר?</th>
        </tr>
      </thead>
      <tbody>
        {floors.map((f, i) => (
          <tr key={f?.key || i} style={i % 2 === 0 ? tbodyRowEvenStyle : tbodyRowOddStyle}>
            <td style={tdStyle}>
              <input
                type="text"
                value={f?.name ?? ''}
                onChange={(e) => onUpdateFloorName && onUpdateFloorName(f?.key, e.target.value)}
                dir="rtl"
                style={{
                  width: '100%', background: '#ffffff',
                  border: `1px solid ${BORDER}`, borderRadius: 6,
                  padding: '4px 8px', fontFamily: 'inherit', fontSize: 13,
                  color: CHARCOAL, textAlign: 'right', boxSizing: 'border-box',
                }}
              />
            </td>
            {/* key + isYard are read-only in phase 2 — floor structure
                changes are deferred to a future phase. */}
            <td style={{ ...tdStyle, fontFamily: 'monospace', color: MUTED }}>{f?.key ?? '—'}</td>
            <td style={tdStyle}>{f?.isYard ? 'כן' : 'לא'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PalettePerFloor({ floors, palette, rooms, onAdd, onRemove, onMove, openFloors, onToggleFloor }) {
  if (!Array.isArray(floors) || floors.length === 0) {
    return <div style={{ color: MUTED, fontSize: 13 }}>אין מפלסים.</div>
  }
  const allRoomKeys = Object.keys(rooms || {})
  const openSet = openFloors instanceof Set ? openFloors : new Set()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {floors.map(f => {
        const key  = f?.key
        const list = Array.isArray(palette[key]) ? palette[key] : []
        return (
          <FloorPaletteCard
            key={key}
            floorKey={key}
            floorName={f?.name || key}
            list={list}
            allRoomKeys={allRoomKeys}
            onAdd={onAdd}
            onRemove={onRemove}
            onMove={onMove}
            isOpen={openSet.has(key)}
            onToggle={typeof onToggleFloor === 'function' ? () => onToggleFloor(key) : undefined}
          />
        )
      })}
    </div>
  )
}

function FloorPaletteCard({ floorKey, floorName, list, allRoomKeys, onAdd, onRemove, onMove, isOpen, onToggle }) {
  const [pendingType, setPendingType] = useState('')
  const clickable = typeof onToggle === 'function'

  /* Room types NOT already in this floor's palette, and never the
     marker itself. That's the pool the "הוסף חלל" dropdown shows. */
  const alreadyHere = new Set(list)
  const addableTypes = allRoomKeys
    .filter(t => !alreadyHere.has(t))
    .sort((a, b) => a.localeCompare(b, 'he'))

  const handleAdd = () => {
    if (!pendingType) return
    onAdd(floorKey, pendingType)
    setPendingType('')
  }

  return (
    <div style={{
      border: `1px solid ${BORDER}`, borderRadius: 6,
      background: CREAM, overflow: 'hidden',
    }}>
      {/* Clickable accordion header. Chevron comes FIRST so, in this
          RTL row, it lands on the visual-right — matches the top-level
          section and per-room headers. */}
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-expanded={!!isOpen}
        onClick={clickable ? onToggle : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        } : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px',
          background: isOpen ? '#faf9f7' : 'transparent',
          borderBottom: isOpen ? `1px dashed ${BORDER}` : 'none',
          cursor: clickable ? 'pointer' : 'default',
          direction: 'rtl',
        }}
      >
        {clickable && <Chevron open={!!isOpen} />}
        <div style={{ fontWeight: 600, color: CHARCOAL, flex: 1 }}>
          {floorName}
          <span style={{ fontSize: 12, color: MUTED, fontWeight: 400 }}>
            &nbsp;· {list.length} סוגי חללים
          </span>
        </div>
      </div>
      {/* Body — hidden via display:none when collapsed so the pending
          "הוסף חלל" dropdown selection survives a toggle. */}
      <div
        aria-hidden={!isOpen}
        style={{
          padding: isOpen ? '10px 12px' : 0,
          display: isOpen ? 'block' : 'none',
        }}
      >
      {list.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 13 }}>אין פריטים בפלטה.</div>
      ) : (
        <ol style={{
          display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0,
          listStyle: 'none', direction: 'rtl',
        }}>
          {list.map((type, i) => {
            const canUp   = i > 0
            const canDown = i < list.length - 1
            return (
              <li key={`${type}-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#ffffff',
                border: `1px solid ${BORDER}`,
                borderRadius: 8, padding: '3px 8px', fontSize: 13,
                color: CHARCOAL,
              }}>
                <span style={{ color: MUTED, fontSize: 12, minWidth: 22 }}>{i + 1}.</span>
                <span style={{ flex: 1 }}>
                  {type}
                </span>
                <IconBtn
                  title="הזז למעלה (קדימה בסדר)"
                  disabled={!canUp}
                  onClick={() => onMove(floorKey, i, -1)}
                >▲</IconBtn>
                <IconBtn
                  title="הזז למטה (אחורה בסדר)"
                  disabled={!canDown}
                  onClick={() => onMove(floorKey, i, +1)}
                >▼</IconBtn>
                <IconBtn
                  title="הסר מפלטת המפלס"
                  danger
                  onClick={() => onRemove(floorKey, i)}
                >✕</IconBtn>
              </li>
            )
          })}
        </ol>
      )}

      {/* Add-row: dropdown of types NOT yet in this floor + a + button. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
        paddingTop: 10, borderTop: `1px dashed ${BORDER}`,
      }}>
        <select
          value={pendingType}
          onChange={(e) => setPendingType(e.target.value)}
          disabled={addableTypes.length === 0}
          dir="rtl"
          style={{
            flex: 1, minWidth: 0,
            background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 6,
            padding: '5px 8px', fontFamily: 'inherit', fontSize: 13,
            color: CHARCOAL, textAlign: 'right', boxSizing: 'border-box',
          }}
        >
          <option value="">
            {addableTypes.length === 0 ? 'כל סוגי החללים כבר בפלטה' : 'בחרו סוג חלל להוספה…'}
          </option>
          {addableTypes.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!pendingType}
          style={{
            background: pendingType ? SAGE : '#eeebe6',
            color:      pendingType ? '#ffffff' : MUTED,
            border: `1px solid ${pendingType ? SAGE_DARK : BORDER}`,
            borderRadius: 6, padding: '5px 12px', fontFamily: 'inherit', fontSize: 13,
            cursor: pendingType ? 'pointer' : 'not-allowed',
          }}
        >
          הוסף
        </button>
      </div>
      </div>
    </div>
  )
}

function IconBtn({ children, onClick, disabled, title, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        background: 'transparent',
        color: disabled ? '#c9c5be' : (danger ? DANGER : SAGE_DARK),
        border: `1px solid ${disabled ? BORDER : (danger ? DANGER : BORDER)}`,
        borderRadius: 4, padding: '2px 6px', fontSize: 11, lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        minWidth: 22,
      }}
    >
      {children}
    </button>
  )
}

function NewRoomTypeForm({ existingKeys, onCreate }) {
  const [name, setName]   = useState('')
  const [key,  setKey]    = useState('')
  const [err,  setErr]    = useState('')
  const existingSet = new Set(existingKeys || [])

  const submit = () => {
    setErr('')
    /* Client-side duplicate check for a nicer message before the
       mutator's own guard fires. The mutator returns a message on
       collision too, so this is belt & suspenders. */
    const effectiveKey = (key.trim() || name.trim())
    if (!name.trim()) { setErr('חסר שם.'); return }
    if (!effectiveKey) { setErr('חסר מפתח.'); return }
    if (existingSet.has(effectiveKey)) {
      setErr(`כבר קיים סוג חלל עם המפתח "${effectiveKey}".`)
      return
    }
    const mutErr = onCreate(name, key)
    if (mutErr) { setErr(mutErr); return }
    setName('')
    setKey('')
  }

  return (
    <div style={{
      border: `1px dashed ${SAGE}`, borderRadius: 8, background: '#ffffff',
      padding: '10px 12px', marginBottom: 14,
    }}>
      <div style={{ fontWeight: 700, color: SAGE_DARK, marginBottom: 8, fontSize: 14 }}>
        + הוסף סוג חלל חדש
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 8, alignItems: 'end',
      }}>
        <div>
          <label style={formLabelStyle}>שם (חובה)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setErr('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="למשל: פינת קריאה"
            dir="rtl"
            style={formInputStyle}
          />
        </div>
        <div>
          <label style={formLabelStyle}>
            מפתח (אופציונלי — ברירת מחדל: השם)
          </label>
          <input
            type="text"
            value={key}
            onChange={(e) => { setKey(e.target.value); setErr('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
            placeholder="למשל: פינת קריאה"
            dir="rtl"
            style={formInputStyle}
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim()}
          style={{
            background: name.trim() ? SAGE : '#eeebe6',
            color:      name.trim() ? '#ffffff' : MUTED,
            border: `1px solid ${name.trim() ? SAGE_DARK : BORDER}`,
            borderRadius: 8, padding: '8px 14px', fontFamily: 'inherit', fontSize: 13,
            fontWeight: 600,
            cursor: name.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          צור
        </button>
      </div>
      {err && (
        <div style={{ color: DANGER, fontSize: 12.5, marginTop: 8 }}>
          {err}
        </div>
      )}
      <div style={{ color: MUTED, fontSize: 11.5, marginTop: 6 }}>
        סוג חלל חדש נוצר עם ברירות מחדל: sizes 0/0/0, showSize: true, defaultSize: M,
        ללא container, ללא מאפיינים. עריכת מידות ומאפיינים תתאפשר בשלב הבא (phase 3).
      </div>
    </div>
  )
}

function RoomsList({ rooms, onUpdateRoom, openRooms, onToggleRoom, roomsWithIssues }) {
  const entries = Object.entries(rooms || {})
  if (entries.length === 0) {
    return <div style={{ color: MUTED, fontSize: 13 }}>אין חללים.</div>
  }
  /* Stable order — alphabetical by key so the page reads consistently
     across loads and doesn't reshuffle when a name is edited. */
  entries.sort(([a], [b]) => a.localeCompare(b, 'he'))
  const openSet   = openRooms       instanceof Set ? openRooms       : new Set()
  const issuesSet = roomsWithIssues instanceof Set ? roomsWithIssues : new Set()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map(([type, def]) => (
        <RoomRow
          key={type}
          type={type}
          def={def || {}}
          allRooms={rooms || {}}
          onUpdate={(updater) => onUpdateRoom(type, updater)}
          isOpen={openSet.has(type)}
          onToggle={typeof onToggleRoom === 'function' ? () => onToggleRoom(type) : undefined}
          hasIssue={issuesSet.has(type)}
        />
      ))}
    </div>
  )
}

function RoomRow({ type, def, allRooms, onUpdate, isOpen, onToggle, hasIssue }) {
  const isCont  = def.isContainer === true
  const isFixed = typeof def.fixedArea === 'number' && def.fixedArea > 0
  const clickable = typeof onToggle === 'function'

  /* ── name field ── */
  const setName = (name) => onUpdate(d => ({ ...d, name }))

  /* ── container toggle. Turning OFF clears the three child lists so
        stale references never linger in a non-container room. */
  const setIsContainer = (on) => onUpdate(d => ({
    ...d,
    isContainer: !!on,
    ...(on ? {} : { allowedChildren: [], autoChildren: [], requiredTypes: [] }),
  }))

  return (
    <div style={{
      border: `1px solid ${BORDER}`, borderRadius: 6,
      background: CREAM, overflow: 'hidden',
    }}>
      {/* ── Collapsible header. Clicking anywhere on the row (except
            interactive descendants) toggles open/closed. The name input
            and container checkbox stop propagation so they stay usable
            when the row is open. ── */}
      <div
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-expanded={!!isOpen}
        onClick={clickable ? onToggle : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        } : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '10px 12px',
          background: isOpen ? '#faf9f7' : 'transparent',
          borderBottom: isOpen ? `1px dashed ${BORDER}` : 'none',
          cursor: clickable ? 'pointer' : 'default',
          direction: 'rtl',
        }}
      >
        {/* Chevron + issue-dot come FIRST so, in this RTL row, they
            land on the visual-right — start-of-line in Hebrew reading
            order, matching the top-level section headers. */}
        {clickable && <Chevron open={!!isOpen} />}
        {hasIssue && <IssueDot title="יש שגיאות אימות בחלל הזה" />}
        <input
          type="text"
          value={def.name ?? ''}
          onChange={(e) => setName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="שם החלל"
          dir="rtl"
          style={{
            flex: '2 1 220px', minWidth: 0,
            background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 6,
            padding: '6px 10px', fontFamily: 'inherit', fontSize: 14,
            fontWeight: 700, color: CHARCOAL, textAlign: 'right', boxSizing: 'border-box',
          }}
        />
        <span style={{ color: MUTED, fontFamily: 'monospace', fontSize: 12 }}>
          key: {type}
        </span>
        {isCont && (
          <span style={{
            fontSize: 11.5, color: SAGE_DARK,
            background: 'rgba(122,148,120,0.14)', border: `1px solid ${SAGE}`,
            borderRadius: 999, padding: '2px 8px',
          }}>
            חלל על
          </span>
        )}
        <label
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12.5, color: CHARCOAL,
            marginInlineStart: 'auto', userSelect: 'none', cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={isCont}
            onChange={(e) => setIsContainer(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
          />
          חלל על (container)
        </label>
      </div>

      {/* Body — kept mounted; hidden via display:none when collapsed so
          child editors (e.g. PropsEditor's per-field UI, ChipMultiSelect's
          selection state) don't lose local state on toggle. */}
      <div
        aria-hidden={!isOpen}
        style={{
          padding: isOpen ? '12px 14px' : 0,
          display: isOpen ? 'block' : 'none',
        }}
      >
        {/* ── Sizes / fixed-area section ── */}
        <SizeEditor def={def} isFixed={isFixed} onUpdate={onUpdate} />

        {/* ── Container settings (only when isContainer) ── */}
        {isCont && (
          <ContainerEditor
            type={type}
            def={def}
            allRooms={allRooms}
            onUpdate={onUpdate}
          />
        )}

        {/* ── Props (characterization fields) ── */}
        <PropsEditor def={def} onUpdate={onUpdate} />
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   SizeEditor — S/M/L + defaultSize + showSize + fixedArea toggle.
   Fixed-area mode is mutually exclusive with the sized selector; the
   UI ensures the config never carries both at once.
   ───────────────────────────────────────────────────────────────── */
function SizeEditor({ def, isFixed, onUpdate }) {
  const setSize = (dim, raw) => {
    /* '' → 0 is a poor UX; keep the raw string coerced to number when
       possible, else 0 so validation catches it. */
    const v = raw === '' ? 0 : Number(raw)
    onUpdate(d => ({
      ...d,
      sizes: { ...(d.sizes || {}), [dim]: (Number.isFinite(v) ? v : 0) },
    }))
  }
  const setShowSize    = (b) => onUpdate(d => ({ ...d, showSize:    !!b }))
  const setDefaultSize = (k) => onUpdate(d => ({ ...d, defaultSize: k }))

  const toggleFixed = (on) => onUpdate(d => {
    if (on) {
      /* Turning ON: fixedArea takes over. Preserve any prior numeric
         fixedArea, else default to 9 (matches the current fixed room
         "פינת משפחה" — sensible starting point). showSize goes false
         so the two invariants stay consistent. */
      const prev = typeof d.fixedArea === 'number' && d.fixedArea > 0 ? d.fixedArea : 9
      return { ...d, fixedArea: prev, showSize: false }
    }
    /* Turning OFF: fixedArea clears; showSize returns to true so the
       sized selector is usable again by default. */
    return { ...d, fixedArea: null, showSize: true }
  })
  const setFixedArea = (raw) => {
    const v = raw === '' ? 0 : Number(raw)
    onUpdate(d => ({ ...d, fixedArea: Number.isFinite(v) ? v : 0 }))
  }
  const setExcludeFromAreaCalc = (b) => onUpdate(d => ({ ...d, excludeFromAreaCalc: !!b }))

  return (
    <div style={{ marginBottom: 14 }}>
      <SectionLabel>גודל</SectionLabel>

      {/* Fixed-area toggle + exclude-from-area-calc toggle — same row */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: CHARCOAL, userSelect: 'none', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={isFixed}
            onChange={(e) => toggleFixed(e.target.checked)}
          />
          גודל קבוע
          <span style={{ color: MUTED, fontSize: 11.5 }}>
            (מסתיר את בורר ה-S/M/L אצל הלקוח)
          </span>
        </label>

        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: CHARCOAL, userSelect: 'none', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={def.excludeFromAreaCalc === true}
            onChange={(e) => setExcludeFromAreaCalc(e.target.checked)}
          />
          שטח לא נספר
          <span style={{ color: MUTED, fontSize: 11.5 }}>
            (שטח חלל זה לא ייספר בעת חישוב שטח הבית)
          </span>
        </label>
      </div>

      {isFixed ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ color: MUTED, fontSize: 12 }}>fixedArea (מ״ר):</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={def.fixedArea ?? ''}
            onChange={(e) => setFixedArea(e.target.value)}
            style={{
              width: 100, background: '#ffffff',
              border: `1px solid ${BORDER}`, borderRadius: 6,
              padding: '5px 8px', fontFamily: 'inherit', fontSize: 13,
              color: CHARCOAL, textAlign: 'right', boxSizing: 'border-box',
            }}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* S/M/L number inputs */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, minmax(90px, 1fr))', gap: 8,
          }}>
            {['S','M','L'].map(dim => (
              <div key={dim}>
                <label style={{
                  display: 'block', fontSize: 11.5, color: MUTED, marginBottom: 3,
                }}>
                  {dim} ({dim === 'S' ? 'קטן' : dim === 'M' ? 'בינוני' : 'גדול'})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={def.sizes?.[dim] ?? 0}
                  onChange={(e) => setSize(dim, e.target.value)}
                  style={{
                    width: '100%', background: '#ffffff',
                    border: `1px solid ${BORDER}`, borderRadius: 6,
                    padding: '5px 8px', fontFamily: 'inherit', fontSize: 13,
                    color: CHARCOAL, textAlign: 'right', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}
          </div>

          {/* showSize + defaultSize */}
          <div style={{
            display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
          }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, color: CHARCOAL, userSelect: 'none', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={def.showSize !== false}
                onChange={(e) => setShowSize(e.target.checked)}
              />
              הצג בורר גודל ללקוח (showSize)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 12 }}>defaultSize:</span>
              <div style={{ display: 'flex', gap: 2 }}>
                {['S','M','L'].map(k => {
                  const selected = def.defaultSize === k
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setDefaultSize(k)}
                      style={{
                        background: selected ? SAGE : '#ffffff',
                        color:      selected ? '#ffffff' : CHARCOAL,
                        border: `1px solid ${selected ? SAGE_DARK : BORDER}`,
                        padding: '4px 12px', fontFamily: 'inherit', fontSize: 12,
                        cursor: 'pointer', minWidth: 34,
                      }}
                    >
                      {k}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   ContainerEditor — three chip multi-selects. allowedChildren is the
   source pool for the other two (auto ⊆ allowed, required ⊆ allowed).
   ───────────────────────────────────────────────────────────────── */
function ContainerEditor({ type, def, allRooms, onUpdate }) {
  /* Non-container types other than self — the source pool for
     allowedChildren. Sorted Hebrew-locale for a stable dropdown. */
  const nonContainerPool = Object.keys(allRooms || {})
    .filter(k => k !== type && allRooms[k]?.isContainer !== true)
    .sort((a, b) => a.localeCompare(b, 'he'))

  /* The ONE exception: "יחידת סוויטה" is always allowed inside "יחידת
     דיור" — enforced unconditionally in HouseBuilderV2.jsx regardless
     of what's configured here. Shown in the pool (so the "no
     containers" filter doesn't look inconsistent with the live
     builder) but pinned via ChipMultiSelect's `locked` — toggling it
     off here wouldn't change the live builder's behavior, so we don't
     offer that false affordance. Defensive check on the type existing
     as a container in case it's ever renamed/removed. */
  const isDwelling = type === DWELLING_UNIT_TYPE && allRooms?.[SUITE_UNIT_TYPE]?.isContainer === true
  const allowedChildrenPool = isDwelling
    ? [...nonContainerPool, SUITE_UNIT_TYPE].sort((a, b) => a.localeCompare(b, 'he'))
    : nonContainerPool
  const lockedChildren = isDwelling ? new Set([SUITE_UNIT_TYPE]) : undefined

  const allowed = Array.isArray(def.allowedChildren) ? def.allowedChildren : []

  /* When allowedChildren shrinks we prune auto/required to stay valid;
     mutators enforce that so the child sub-editors can be dumb. */
  const setAllowed = (nextAllowed) => onUpdate(d => {
    const nextSet = new Set(nextAllowed)
    return {
      ...d,
      allowedChildren: nextAllowed,
      autoChildren:  (d.autoChildren  || []).filter(t => nextSet.has(t)),
      requiredTypes: (d.requiredTypes || []).filter(t => nextSet.has(t)),
    }
  })
  const setAuto     = (arr) => onUpdate(d => ({ ...d, autoChildren:  arr }))
  const setRequired = (arr) => onUpdate(d => ({ ...d, requiredTypes: arr }))

  return (
    <div style={{ marginBottom: 14 }}>
      <SectionLabel>הגדרות container</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ChipMultiSelect
          label="allowedChildren"
          hint={isDwelling
            ? 'סוגי חללים שמותר להכניס לתוך היחידה (containers אינם ברשימה — אין nesting, פרט ל"יחידת סוויטה" שמותרת תמיד ביחידת דיור ומוטמעת בקוד; לא ניתן להסיר אותה כאן).'
            : 'סוגי חללים שמותר להכניס לתוך היחידה (containers אינם ברשימה — אין nesting).'}
          pool={allowedChildrenPool}
          value={allowed}
          onChange={setAllowed}
          locked={lockedChildren}
        />
        <ChipMultiSelect
          label="autoChildren"
          hint="ילדים שנוצרים אוטומטית בעת יצירת היחידה (ניתן לבחור רק מתוך allowedChildren)."
          pool={allowed}
          value={(def.autoChildren || []).filter(t => allowed.includes(t))}
          onChange={setAuto}
          disabledMsg={allowed.length === 0 ? 'אין ילדים מותרים להגדרה.' : null}
        />
        <ChipMultiSelect
          label="requiredTypes"
          hint="סוגים שאין למחוק את האחרון שלהם ביחידה (ניתן לבחור רק מתוך allowedChildren)."
          pool={allowed}
          value={(def.requiredTypes || []).filter(t => allowed.includes(t))}
          onChange={setRequired}
          disabledMsg={allowed.length === 0 ? 'אין ילדים מותרים להגדרה.' : null}
        />
      </div>
    </div>
  )
}

/* `locked` (optional Set) — chips whose membership is enforced
   elsewhere (in code, not by this config) and so must always render
   as included and can't be toggled off here. Used for the "יחידת
   סוויטה תמיד מותרת ביחידת דיור" exception; every other call site
   passes no `locked` and behaves exactly as before. */
function ChipMultiSelect({ label, hint, pool, value, onChange, disabledMsg, locked }) {
  const valueSet  = new Set(value || [])
  const lockedSet = locked instanceof Set ? locked : new Set()
  const toggle = (t) => {
    if (lockedSet.has(t)) return
    const next = new Set(valueSet)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    /* Preserve pool order in output so consumers see a stable list. */
    onChange(pool.filter(x => next.has(x)))
  }
  /* Locked chips count as "on" for the header tally even when they're
     not literally in `value`, so the count matches what's visibly
     checked. */
  const effectiveCount = new Set([...valueSet, ...lockedSet]).size
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4,
      }}>
        <span style={{ fontSize: 12.5, color: SAGE_DARK, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color: MUTED }}>({effectiveCount}/{pool.length})</span>
      </div>
      {hint && (
        <div style={{ color: MUTED, fontSize: 11.5, marginBottom: 6 }}>{hint}</div>
      )}
      {disabledMsg ? (
        <div style={{ color: MUTED, fontSize: 12, fontStyle: 'italic' }}>{disabledMsg}</div>
      ) : pool.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 12, fontStyle: 'italic' }}>אין אפשרויות.</div>
      ) : (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 4, direction: 'rtl',
        }}>
          {pool.map(t => {
            const isLocked = lockedSet.has(t)
            const on = valueSet.has(t) || isLocked
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                title={isLocked ? 'מותר תמיד — מוטמע בקוד, לא ניתן לשינוי כאן' : undefined}
                style={{
                  background: on ? SAGE : '#ffffff',
                  color:      on ? '#ffffff' : CHARCOAL,
                  border: `1px solid ${on ? SAGE_DARK : BORDER}`,
                  borderRadius: 12, padding: '3px 10px',
                  fontFamily: 'inherit', fontSize: 12,
                  cursor: isLocked ? 'default' : 'pointer',
                  opacity: isLocked ? 0.85 : 1,
                }}
              >
                {t}{isLocked ? ' 🔒' : ''}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   PropsEditor — ordered list of characterization fields. Each field
   has a title / noTitle / type / options list. Mutations flow up via
   onUpdate(def => nextDef) so the outer store stays the source of
   truth.
   ───────────────────────────────────────────────────────────────── */
function PropsEditor({ def, onUpdate }) {
  const props = Array.isArray(def.props) ? def.props : []

  const addField = () => onUpdate(d => ({
    ...d,
    props: [...(Array.isArray(d.props) ? d.props : []), {
      title: '', noTitle: false, type: 'multi', options: [],
    }],
  }))
  const removeField = (i) => onUpdate(d => ({
    ...d,
    props: (d.props || []).filter((_, idx) => idx !== i),
  }))
  const moveField = (i, dir) => onUpdate(d => {
    const list = [...(d.props || [])]
    const j = i + dir
    if (j < 0 || j >= list.length) return d
    ;[list[i], list[j]] = [list[j], list[i]]
    return { ...d, props: list }
  })
  const patchField = (i, patch) => onUpdate(d => ({
    ...d,
    props: (d.props || []).map((g, idx) => idx === i ? { ...g, ...patch } : g),
  }))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <SectionLabel style={{ margin: 0 }}>מאפיינים</SectionLabel>
        <span style={{ fontSize: 12, color: MUTED }}>({props.length})</span>
        <button
          type="button"
          onClick={addField}
          style={{
            marginInlineStart: 'auto',
            background: SAGE, color: '#ffffff',
            border: `1px solid ${SAGE_DARK}`, borderRadius: 6,
            padding: '4px 10px', fontFamily: 'inherit', fontSize: 12,
            cursor: 'pointer',
          }}
        >
          + הוסף שדה
        </button>
      </div>
      {props.length === 0 ? (
        <div style={{ color: MUTED, fontSize: 12.5, fontStyle: 'italic' }}>
          אין שדות מאפיין. שדה "מאפיין אחר" (טקסט חופשי) מתווסף אוטומטית בכל חלל
          ואינו חלק מהקונפיג.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {props.map((g, i) => (
            <PropFieldEditor
              key={i}
              group={g || {}}
              index={i}
              lastIndex={props.length - 1}
              onPatch={(patch) => patchField(i, patch)}
              onRemove={() => removeField(i)}
              onMoveUp={() => moveField(i, -1)}
              onMoveDown={() => moveField(i, +1)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function PropFieldEditor({ group, index, lastIndex, onPatch, onRemove, onMoveUp, onMoveDown }) {
  /* Options editing */
  const options = Array.isArray(group.options) ? group.options : []
  const addOption = () => onPatch({ options: [...options, ''] })
  const removeOption = (i) => onPatch({ options: options.filter((_, idx) => idx !== i) })
  const editOption   = (i, v) => onPatch({ options: options.map((o, idx) => idx === i ? v : o) })
  const moveOption   = (i, dir) => {
    const next = [...options]
    const j = i + dir
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onPatch({ options: next })
  }

  return (
    <div style={{
      border: `1px solid ${BORDER}`, borderRadius: 6, padding: '8px 10px',
      background: '#ffffff',
    }}>
      {/* Field-header row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap',
      }}>
        <span style={{ color: MUTED, fontSize: 11.5, minWidth: 34 }}>#{index + 1}</span>
        <input
          type="text"
          value={group.title ?? ''}
          onChange={(e) => onPatch({ title: e.target.value })}
          placeholder="כותרת השדה"
          dir="rtl"
          style={{
            flex: '2 1 200px', minWidth: 0,
            background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 6,
            padding: '4px 8px', fontFamily: 'inherit', fontSize: 13,
            color: CHARCOAL, textAlign: 'right', boxSizing: 'border-box',
          }}
        />
        {/* The single/multi selector and the noTitle checkbox were
            REMOVED. On the client's characterization screen every
            option is now an independent toggle and no group titles
            are rendered, so neither setting changes anything there —
            offering them would let Einav configure a no-op.
            The `type` and `noTitle` KEYS are deliberately left in the
            stored config JSON (untouched by this editor, still
            validated below); only their controls are gone. */}
        <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 4 }}>
          <IconBtn title="הזז למעלה" disabled={index === 0}          onClick={onMoveUp}>▲</IconBtn>
          <IconBtn title="הזז למטה" disabled={index === lastIndex} onClick={onMoveDown}>▼</IconBtn>
          <IconBtn title="מחק שדה" danger                            onClick={onRemove}>✕</IconBtn>
        </div>
      </div>

      {/* Options list */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
        }}>
          <span style={{ fontSize: 11.5, color: SAGE_DARK, fontWeight: 600 }}>
            אפשרויות ({options.length})
          </span>
          <button
            type="button"
            onClick={addOption}
            style={{
              marginInlineStart: 'auto',
              background: 'transparent', color: SAGE_DARK,
              border: `1px dashed ${SAGE}`, borderRadius: 4,
              padding: '2px 8px', fontFamily: 'inherit', fontSize: 11.5,
              cursor: 'pointer',
            }}
          >
            + הוסף אפשרות
          </button>
        </div>
        {options.length === 0 ? (
          <div style={{ color: MUTED, fontSize: 12, fontStyle: 'italic' }}>
            אין אפשרויות. הוסיפו לפחות אחת.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {options.map((opt, oi) => (
              <div key={oi} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ color: MUTED, fontSize: 11, minWidth: 24 }}>{oi + 1}.</span>
                <input
                  type="text"
                  value={opt ?? ''}
                  onChange={(e) => editOption(oi, e.target.value)}
                  placeholder="טקסט אפשרות"
                  dir="rtl"
                  style={{
                    flex: 1, minWidth: 0,
                    background: '#ffffff', border: `1px solid ${BORDER}`, borderRadius: 4,
                    padding: '3px 8px', fontFamily: 'inherit', fontSize: 12.5,
                    color: CHARCOAL, textAlign: 'right', boxSizing: 'border-box',
                  }}
                />
                <IconBtn title="הזז למעלה" disabled={oi === 0}                 onClick={() => moveOption(oi, -1)}>▲</IconBtn>
                <IconBtn title="הזז למטה" disabled={oi === options.length - 1} onClick={() => moveOption(oi, +1)}>▼</IconBtn>
                <IconBtn title="הסר אפשרות" danger                              onClick={() => removeOption(oi)}>✕</IconBtn>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SegmentedBtn({ children, selected, onClick, first, last }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: selected ? SAGE : '#ffffff',
        color:      selected ? '#ffffff' : CHARCOAL,
        border: `1px solid ${selected ? SAGE_DARK : BORDER}`,
        borderStartStartRadius: first ? 4 : 0,
        borderEndStartRadius:   first ? 4 : 0,
        borderStartEndRadius:   last  ? 4 : 0,
        borderEndEndRadius:     last  ? 4 : 0,
        padding: '3px 10px', fontFamily: 'inherit', fontSize: 12,
        cursor: 'pointer',
        marginInlineStart: first ? 0 : -1,
      }}
    >
      {children}
    </button>
  )
}

function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontSize: 12.5, color: SAGE_DARK, fontWeight: 600,
      marginBottom: 6, ...(style || {}),
    }}>
      {children}
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════
   Helpers
   ═════════════════════════════════════════════════════════════════ */

function panelBoxStyle(accent) {
  return {
    background:    '#ffffff',
    border:        `1px solid ${accent}`,
    borderInlineStart: `4px solid ${accent}`,
    borderRadius:  8,
    padding:       '12px 14px',
    margin:        '16px 0',
  }
}

/* Table styling — kept plain / local so we don't accidentally pick up
   sort/hover behaviour from the app-wide report tables. */
const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#ffffff',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  overflow: 'hidden',
}
const theadRowStyle = { background: '#eeebe6' }
const thStyle = {
  textAlign: 'right',
  padding: '8px 12px',
  fontWeight: 700,
  color: CHARCOAL,
  fontSize: 13,
  borderBottom: `1px solid ${BORDER}`,
}
const tdStyle = {
  padding: '8px 12px',
  fontSize: 13,
  color: CHARCOAL,
  textAlign: 'right',
}
const tbodyRowEvenStyle = { background: '#ffffff' }
const tbodyRowOddStyle  = { background: '#faf9f7' }

const formLabelStyle = {
  display: 'block',
  fontSize: 11.5,
  color: MUTED,
  marginBottom: 3,
}
const formInputStyle = {
  width: '100%',
  background: '#ffffff',
  border: `1px solid ${BORDER}`,
  borderRadius: 6,
  padding: '6px 10px',
  fontFamily: 'inherit',
  fontSize: 13,
  color: CHARCOAL,
  textAlign: 'right',
  boxSizing: 'border-box',
}

/* ═════════════════════════════════════════════════════════════════
   Validation
   ═════════════════════════════════════════════════════════════════
   Returns a (possibly empty) array of Hebrew error messages. The
   save button is disabled while this array is non-empty. Called on
   every working-copy change via useMemo so the banner surfaces
   issues the moment they appear. */
/* Focused per-panel issue detectors. These mirror the checks in
   validateConfig but return a single boolean so the accordion can
   flag which collapsed panel(s) contain problems. Short-circuit as
   soon as any issue is found. The full error text still comes from
   validateConfig — this is purely a navigation aid. */
function calcParamsHasIssue(calcParams) {
  const cp = (calcParams && typeof calcParams === 'object') ? calcParams : {}
  for (const key of ['corridorsPct', 'wallsPct', 'toleranceDeviationPct']) {
    const v = cp[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return true
  }
  return false
}

function paletteHasIssue(palette, roomKeys) {
  const p = (palette && typeof palette === 'object') ? palette : {}
  const known = roomKeys instanceof Set ? roomKeys : new Set(roomKeys || [])
  for (const [, list] of Object.entries(p)) {
    if (!Array.isArray(list)) return true
    for (const t of list) {
      if (!known.has(t)) return true
    }
  }
  return false
}

function roomHasIssue(type, def, allRooms) {
  if (!type || !type.trim()) return true
  if (!def || typeof def !== 'object') return true
  const rooms = (allRooms && typeof allRooms === 'object') ? allRooms : {}
  const known = new Set(Object.keys(rooms))

  const isContainer = def.isContainer === true
  const hasFixed = typeof def.fixedArea === 'number' && Number.isFinite(def.fixedArea) && def.fixedArea > 0
  const showSize = def.showSize === true

  if (!isContainer) {
    if (showSize && hasFixed) return true
    if (hasFixed && (typeof def.fixedArea !== 'number' || !Number.isFinite(def.fixedArea) || def.fixedArea <= 0)) return true
    if (showSize) {
      const sz = def.sizes && typeof def.sizes === 'object' ? def.sizes : {}
      for (const dim of ['S','M','L']) {
        const v = sz[dim]
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return true
      }
      if (def.defaultSize != null && !['S','M','L'].includes(def.defaultSize)) return true
    }
  }

  if (isContainer) {
    const allowed  = Array.isArray(def.allowedChildren) ? def.allowedChildren : []
    const auto     = Array.isArray(def.autoChildren)    ? def.autoChildren    : []
    const required = Array.isArray(def.requiredTypes)   ? def.requiredTypes   : []
    const allowedSet = new Set(allowed)
    for (const c of allowed) {
      if (!known.has(c)) return true
      if (rooms[c] && rooms[c].isContainer === true) {
        const isAllowedException = type === DWELLING_UNIT_TYPE && c === SUITE_UNIT_TYPE
        if (!isAllowedException) return true
      }
    }
    for (const c of auto)     if (!allowedSet.has(c)) return true
    for (const c of required) if (!allowedSet.has(c)) return true
  } else {
    const anyChildren =
      (Array.isArray(def.allowedChildren) && def.allowedChildren.length) ||
      (Array.isArray(def.autoChildren)    && def.autoChildren.length)    ||
      (Array.isArray(def.requiredTypes)   && def.requiredTypes.length)
    if (anyChildren) return true
  }

  if (Array.isArray(def.props)) {
    for (const g of def.props) {
      if (!g || typeof g !== 'object') return true
      if (g.type !== 'single' && g.type !== 'multi') return true
      if (!Array.isArray(g.options) || g.options.length === 0) return true
      for (const o of g.options) {
        if (typeof o !== 'string' || !o.trim()) return true
      }
      const titleEmpty = typeof g.title !== 'string' || !g.title.trim()
      if (titleEmpty && g.noTitle !== true) return true
    }
  }

  return false
}

function validateConfig(cfg) {
  const errors = []
  if (!cfg || typeof cfg !== 'object') {
    return ['הקונפיג ריק או פגום.']
  }
  const rooms = (cfg.rooms && typeof cfg.rooms === 'object') ? cfg.rooms : {}
  const roomKeys = Object.keys(rooms)

  /* Calculator params — must be non-negative finite numbers. */
  const calcParams = (cfg.calcParams && typeof cfg.calcParams === 'object') ? cfg.calcParams : {}
  const calcParamLabels = {
    corridorsPct:          'מעברים',
    wallsPct:               'עובי קירות',
    toleranceDeviationPct: 'אחוז סטייה מותר',
  }
  for (const [key, label] of Object.entries(calcParamLabels)) {
    const v = calcParams[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      errors.push(`הפרמטר "${label}" חייב להיות מספר לא-שלילי.`)
    }
  }

  /* Empty room-type keys — Object keys can't collide (JS overwrites),
     but an empty string is possible via user input. */
  for (const k of roomKeys) {
    if (!k || !k.trim()) {
      errors.push('קיים סוג חלל עם מפתח ריק.')
      break
    }
  }
  /* Duplicate keys can't exist in a plain object, but if we ever
     switch storage the check needs to stay — cheap belt & suspenders. */
  const seen = new Set()
  for (const k of roomKeys) {
    if (seen.has(k)) errors.push(`מפתח כפול לסוג חלל: "${k}".`)
    seen.add(k)
  }

  /* Palette entries must reference existing room keys. */
  const palette = (cfg.palette && typeof cfg.palette === 'object') ? cfg.palette : {}
  const knownKeys = new Set(roomKeys)
  const floors    = Array.isArray(cfg.floors) ? cfg.floors : []

  /* Prefer the floor's display name over its key when we have it,
     so the error is easier to read in Hebrew. */
  const floorLabel = (fk) => {
    const f = floors.find(x => x && x.key === fk)
    return f && f.name ? `"${f.name}"` : `"${fk}"`
  }

  for (const [floorKey, list] of Object.entries(palette)) {
    const label = floorLabel(floorKey)
    if (!Array.isArray(list)) {
      errors.push(`הפלטה של ${label} איננה מערך.`)
      continue
    }
    for (const type of list) {
      if (!knownKeys.has(type)) {
        errors.push(`ב-${label} מוגדר סוג חלל "${type}" שאיננו קיים ברשימת החללים.`)
      }
    }
  }

  /* ── Per-room invariants (phase 3) ────────────────────────────
     Runs once per room definition. Uses the display name in
     messages when available so a Hebrew admin sees "בחלל 'מטבח'"
     rather than an internal code key. */
  for (const [type, def] of Object.entries(rooms)) {
    if (!def || typeof def !== 'object') continue
    const roomLabel = def.name ? `"${def.name}"` : `"${type}"`

    /* Size-related invariants — only meaningful for regular room types:
         · containers use children-sum, so skip;
         · placeholder rooms with showSize=false AND no fixedArea (e.g.
           the "חלל אחר" marker) don't participate in size selection —
           skip too, so we don't demand S/M/L for pseudo-rooms.
       Everything else falls into one of two categories:
         · showSize=true → must have S/M/L (sized-mode);
         · fixedArea>0   → must be positive (fixed-mode);
       and the two categories are mutually exclusive. */
    if (def.isContainer !== true) {
      const hasFixed = typeof def.fixedArea === 'number' && Number.isFinite(def.fixedArea) && def.fixedArea > 0
      const showSize = def.showSize === true
      const inSizedMode = showSize
      const inFixedMode = hasFixed

      if (inSizedMode && inFixedMode) {
        errors.push(`בחלל ${roomLabel}: לא ניתן להגדיר גם "גודל קבוע" וגם showSize=true בו-זמנית.`)
      }

      if (inFixedMode) {
        if (typeof def.fixedArea !== 'number' || !Number.isFinite(def.fixedArea) || def.fixedArea <= 0) {
          errors.push(`בחלל ${roomLabel}: הערך של "גודל קבוע" חייב להיות מספר חיובי.`)
        }
      }

      if (inSizedMode) {
        const sz = def.sizes && typeof def.sizes === 'object' ? def.sizes : {}
        for (const dim of ['S','M','L']) {
          const v = sz[dim]
          if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
            errors.push(`בחלל ${roomLabel}: ערך ${dim} חייב להיות מספר לא-שלילי.`)
          }
        }
        if (def.defaultSize != null && !['S','M','L'].includes(def.defaultSize)) {
          errors.push(`בחלל ${roomLabel}: defaultSize חייב להיות אחד מבין S/M/L.`)
        }
      }
    }

    /* Container invariants: children reference existing non-container
       keys; auto/required subset of allowed. */
    if (def.isContainer === true) {
      const allowed  = Array.isArray(def.allowedChildren) ? def.allowedChildren : []
      const auto     = Array.isArray(def.autoChildren)    ? def.autoChildren    : []
      const required = Array.isArray(def.requiredTypes)   ? def.requiredTypes   : []
      const allowedSet = new Set(allowed)
      for (const c of allowed) {
        if (!knownKeys.has(c)) {
          errors.push(`בחלל-על ${roomLabel}: allowedChildren מפנה לסוג "${c}" שאיננו קיים.`)
        } else if (rooms[c] && rooms[c].isContainer === true) {
          const isAllowedException = type === DWELLING_UNIT_TYPE && c === SUITE_UNIT_TYPE
          if (!isAllowedException) {
            errors.push(`בחלל-על ${roomLabel}: allowedChildren מכיל container ("${c}") — אין nesting של containers.`)
          }
        }
      }
      for (const c of auto) {
        if (!allowedSet.has(c)) {
          errors.push(`בחלל-על ${roomLabel}: autoChildren מכיל "${c}" שאיננו ב-allowedChildren.`)
        }
      }
      for (const c of required) {
        if (!allowedSet.has(c)) {
          errors.push(`בחלל-על ${roomLabel}: requiredTypes מכיל "${c}" שאיננו ב-allowedChildren.`)
        }
      }
    } else {
      /* Non-containers must not carry stale child lists — the UI
         clears them on toggle-off, but validate defensively too. */
      const anyChildren =
        (Array.isArray(def.allowedChildren) && def.allowedChildren.length) ||
        (Array.isArray(def.autoChildren)    && def.autoChildren.length)    ||
        (Array.isArray(def.requiredTypes)   && def.requiredTypes.length)
      if (anyChildren) {
        errors.push(`בחלל ${roomLabel}: החלל אינו container אך מוגדרות לו רשימות ילדים.`)
      }
    }

    /* Props invariants — each field has a valid type, options, and
       (title || noTitle). */
    if (Array.isArray(def.props)) {
      def.props.forEach((g, i) => {
        const fLabel = `שדה ${i + 1} בחלל ${roomLabel}`
        if (!g || typeof g !== 'object') {
          errors.push(`${fLabel}: מוגדר לא-אובייקט.`)
          return
        }
        if (g.type !== 'single' && g.type !== 'multi') {
          errors.push(`${fLabel}: type חייב להיות single או multi.`)
        }
        if (!Array.isArray(g.options) || g.options.length === 0) {
          errors.push(`${fLabel}: חייבת להיות לפחות אפשרות אחת.`)
        } else {
          /* Individual options must be non-empty strings. */
          g.options.forEach((o, oi) => {
            if (typeof o !== 'string' || !o.trim()) {
              errors.push(`${fLabel}: אפשרות ${oi + 1} ריקה.`)
            }
          })
        }
        const titleEmpty = typeof g.title !== 'string' || !g.title.trim()
        if (titleEmpty && g.noTitle !== true) {
          errors.push(`${fLabel}: כותרת ריקה מותרת רק כאשר noTitle=true.`)
        }
      })
    }
  }

  return errors
}
