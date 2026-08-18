// src/components/questionnaire/HouseBuilderV2.jsx
//
// PARALLEL, PHASE-1 rewrite of the house builder. Runs SIDE-BY-SIDE
// with the existing src/components/questionnaire/HouseBuilder.jsx —
// nothing about V1 is touched. A dev-only toggle in
// ClientProgrammingQuestionnaire.jsx picks which one to render for a
// given session; V1 is the default and is the only one exposed in
// production builds.
//
// Contract — DROP-IN with V1:
//   Same props (initialData, onChange, onBack, onDone, readOnly,
//   onManualSave, savingDraft, savedFlash, doneChecked, onDoneChange)
//   so the parent can swap the component with no other changes and
//   the SAME `answers.house` jsonb round-trips through either builder.
//
// Same config source: src/lib/houseBuilderConfigSource.js — every
// accessor V1 reads (floors, palette, room props, sizes, fixedArea,
// containers, defaultSize) is available here too. No parallel config.
//
// Phase 1 SCOPE:
//   * 3-step wizard shell: "הבית בגדול" → "החללים" → "אפיון".
//   * Dismissible guide bubble per step with the approved copy.
//   * Progress bar (3 dots/pills) at the top.
//   * Bottom nav with per-step primary CTA + "הקודם".
//   * Step bodies are minimal placeholders ("שלב N — בקרוב").
//   * No mutation of answers.house yet — Phase 1 is shell only.
//     The config load + prop hydration are wired so Phase 2 can plug
//     the real editors into each step without further plumbing.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  getFallbackConfig,
  loadHouseBuilderConfig,
} from '../../lib/houseBuilderConfigSource'
import {
  houseToJSON,
  houseFromJSON,
} from '../../lib/houseBuilderState'
/* ROOF_OPTIONS lives in the static config module — same source V1
   imports for its step-4 roof radio. NOT exposed via
   houseBuilderConfigSource (it's a fixed enum), so import direct.
   DEFAULT_PROPS is the same static fallback V1's PropsPanel uses
   when a room type isn't decorated in config.ROOM_PROPS. */
import { ROOF_OPTIONS, DEFAULT_PROPS } from '../../lib/houseBuilderConfig'
/* Same back-arrow glyph the questionnaire screen uses, so the two
   screens' back controls are pixel-identical (shared .cp-screen-back
   class + shared icon). */
import { IconBack } from '../icons/PortalIcons'

/* Size labels match V1's houseSizeConfig verbatim. DOM order
   [L, M, S] paints as visual [גדול | בינוני | קטן] under RTL — same
   as V1's PropsPanel size selector. */
/* Key under which a property group's selected options are stored.
   Retains the legacy 'r' prefix so houseFromJSON's string→[string]
   coercion of old single-select data lands on the key this screen
   reads. Single definition — writers and readers must agree. */
const propGroupKey = (gi) => 'r' + gi

const SIZE_KEYS_IN_ORDER = ['L', 'M', 'S']
const SIZE_LABELS_MAP    = { S: 'קטן', M: 'בינוני', L: 'גדול' }

/* The ONE allowed container-in-container combination: יחידת סוויטה
   may be added inside יחידת דיור. Every other combination (suite-in-
   suite, dwelling-in-dwelling, dwelling-in-suite, or anything inside
   an already-nested suite — whose own type is still יחידת סוויטה, not
   יחידת דיור, so the same check forbids it) stays forbidden exactly as
   before. See allowedChildTypes / addChildToContainer. Hardcoded
   literals, matching how this codebase already hardcodes specific
   type names elsewhere (e.g. "פינת משפחה" in FIXED_AREAS, "חלל אחר" as
   the custom-room marker). */
const DWELLING_UNIT_TYPE = 'יחידת דיור'
const SUITE_UNIT_TYPE    = 'יחידת סוויטה'

/* Preset segments for the "target size" selector. Each option stores
   a single number into answers.house.targetArea (same field V1
   writes) so data round-trips cleanly between builders. Values were
   picked so each label maps to a distinct, unambiguous number. The
   accompanying "אחר" text input takes any other positive number and
   writes to the same field. */
const TARGET_AREA_SEGMENTS = [
  { value: 160, label: 'עד 160 מ״ר' },
  { value: 180, label: '160-180'    },
  { value: 200, label: '180-200'    },
  { value: 250, label: 'מעל 200'    },
]
const TARGET_AREA_SEGMENT_VALUES = new Set(TARGET_AREA_SEGMENTS.map(o => o.value))

/* Border/color tokens re-used across V2 primitives, so segmented
   controls, chips, toggle rows and text inputs all read as ONE
   design system. These are V2's own tokens — the builder has no CSS
   file and styles everything inline. */
const INPUT_BORDER  = '#d9d6cd'   /* soft warm-grey — input / chip /
                                     segment border. */
const INPUT_TEXT    = '#4a4a48'   /* segment + chip label color. */
const INPUT_BG_SEL  = '#7a9478'   /* selected sage (identical to SAGE). */
const INPUT_BD_SEL  = '#5d7259'   /* selected border (identical to SAGE_DARK). */
const INPUT_HOVER   = 'rgba(122, 148, 120, 0.10)'  /* V1's segment hover tint. */

/* ── Design tokens (mirror theme.css + V1) ─────────────────────── */
const CREAM      = '#f7f5f2'
const CHARCOAL   = '#1a1a18'
const SAGE       = '#7a9478'
const SAGE_DARK  = '#5d7259'
const SAGE_LITE  = 'rgba(122, 148, 120, 0.14)'
const MUTED      = '#8a8680'
const BORDER     = 'rgba(26, 26, 24, 0.13)'
const DANGER     = '#c94b4b'   /* hover/active tint for the schematic's
                                  per-room delete affordance. Matches the
                                  danger red used by the app's other
                                  destructive controls. */

/* Uniform button size shared by every "room button" surface in step 2
   — the palette "+ סוג חלל" buttons, the current-rooms chips, and the
   compact chips inside the MiniHouse. Fixed width + height + single-
   line ellipsis so the grid reads as ONE tidy family regardless of
   room-name length. Kept as a module constant so the three call
   sites can't drift. */
const ROOM_BTN = {
  WIDTH:   100,
  HEIGHT:  32,
  RADIUS:  8,
  PADDING: '0 8px',
  FONT:    12.5,
  GAP:     4,
}

/* Per-step config: title (progress pill), guide bubble copy, primary
   CTA label. Kept together so a text tweak stays in one place. */
const STEPS = [
  {
    key:      'general',
    title:    'מאפיינים כלליים',
    titleSub: 'גודל וקומות',
    guide:    'בואו נגדיר כמה דברים בסיסיים כמו גודל הבית וכמה קומות',
    guideSub: 'אל דאגה, הכל ניתן לשינוי ועריכה',
    cta:      'סיימנו — בואו נעבור שלב',
  },
  {
    key:      'rooms',
    title:    'החדרים',
    titleSub: 'חדרים וחללים בכל קומה',
    guide:    'בואו נגדיר לכל קומה אילו חדרים יהיו בה.',
    guideSub: 'גם כאן לא לדאוג — תמיד אפשר להוסיף או לשנות',
    cta:      'עברו בעין על המבנה — ובואו נמשיך',
  },
  {
    key:      'chars',
    title:    'אפיון חדרים',
    titleSub: 'מאפיינים של כל חדר/חלל',
    guide:    'עכשיו בואו נעבור על כל חדר ונסמן את המאפיינים שלו',
    guideSub: 'זה בסדר גם לא לדעת הכל עכשיו, סמנו מה שאתם יודעים',
    cta:      'סיימנו! מוכנים לפגישה',
  },
]

const IconClose = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <line x1="18" y1="6"  x2="6"  y2="18" />
    <line x1="6"  y1="6"  x2="18" y2="18" />
  </svg>
)

const IconChevron = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
)

/* Trash bin — the delete affordance on each room box inside the
   MiniHouse schematic. Simplified vs the app's other trash glyphs
   (no lid handle, no inner tally lines): at the ~10px size these
   chips allow, those details turn to mud. */
const IconTrash = ({ size = 10 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <polyline points="3 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

/* BackToHubLink — round back-arrow (no text), the SINGLE back
   control on the builder's screens. Returns to the programming hub
   via onBack(); the parent's handleHouseBack switches view to
   'hub'.

   Deliberately IDENTICAL to the questionnaire screen's arrow: same
   shared .cp-screen-back class (40×40 sage circle), same IconBack
   glyph from PortalIcons, same size={20}, same aria-label/title.
   The portal's own shared arrow stays suppressed for this module
   (see showBackArrow in ClientPortal.jsx) so only one arrow shows. */
function BackToHubLink({ onBack }) {
  return (
    <button
      type="button"
      className="cp-screen-back"
      onClick={() => onBack && onBack()}
      aria-label="חזרה למרחב הפרוגרמה"
      title="חזרה למרחב הפרוגרמה"
    >
      <IconBack size={20} />
    </button>
  )
}

/**
 * @param {object}   props
 * @param {any|null} props.initialData     — answers.house on mount.
 * @param {function} [props.onChange]      — future: called on mutation.
 * @param {function} [props.onBack]        — parent's "↩ חזרה" (hub).
 * @param {function} [props.onDone]        — parent's finish handler.
 * @param {boolean}  [props.readOnly]      — locks all editing (Phase 2+).
 * @param {function} [props.onManualSave]  — "שמור טיוטה" button.
 * @param {boolean}  [props.savingDraft]   — save spinner state.
 * @param {boolean}  [props.savedFlash]    — "נשמר ✓" toast state.
 * @param {boolean}  [props.doneChecked]   — controlled finish flag.
 * @param {function} [props.onDoneChange]  — controlled finish toggle.
 */
export default function HouseBuilderV2({
  initialData   = null,
  onChange,
  onBack,
  onDone,
  readOnly      = false,
  onManualSave,
  savingDraft   = false,
  savedFlash    = false,
  doneChecked,            // eslint-disable-line no-unused-vars
  onDoneChange,           // eslint-disable-line no-unused-vars
} = {}) {
  /* Runtime config — seeded from the in-code fallback so the first
     render sees a fully-populated shape, then swapped to the
     DB-sourced config once loadHouseBuilderConfig resolves. Same
     pattern V1 uses. */
  const [config, setConfig] = useState(() => getFallbackConfig())
  useEffect(() => {
    let cancelled = false
    loadHouseBuilderConfig()
      .then(cfg => { if (!cancelled) setConfig(cfg) })
      .catch(e => console.warn('HouseBuilderV2 config load failed:', e))
    return () => { cancelled = true }
  }, [])
  const FLOOR_DEFS = config.FLOOR_DEFS || []
  const YARD_LABEL = config.YARD_LABEL || 'חצר'

  /* House state — hydrated ONCE from initialData at mount using the
     same codec V1 uses (houseFromJSON), and emitted back to the
     parent via houseToJSON on every mutation. Component becomes the
     source of truth after mount so parent re-renders from a save
     don't overwrite in-progress edits. All shape keys (floorsOn,
     yardOn, targetArea, general, rooms, transient) mirror V1's,
     so a swap between V1 and V2 preserves data on the SAME
     answers.house structure. */
  const [houseState, setHouseState] = useState(() => houseFromJSON(initialData))

  /* Single mutation entry point: patch state, emit JSON to parent.
     Keeps every field V2 doesn't own (rooms, transient) untouched
     because we spread from the previous state. */
  const patchState = (partial) => {
    setHouseState(prev => {
      const next = { ...prev, ...partial }
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
  }
  const patchGeneral = (partial) => {
    setHouseState(prev => {
      const next = { ...prev, general: { ...(prev.general || {}), ...partial } }
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
  }

  /* ── Block A — targetArea ────────────────────────────────────── */
  const currentTargetArea = houseState.targetArea
  const isPresetTarget = typeof currentTargetArea === 'number'
                         && TARGET_AREA_SEGMENT_VALUES.has(currentTargetArea)
  const isCustomTarget = typeof currentTargetArea === 'number' && !isPresetTarget
  /* Displayed in the size text input. Now that the preset segments
     are gone, EVERY saved number (including old values that were
     previously "preset" like 160/180/200/250) shows up in the
     freeform input so no data is hidden after the UI change. */
  const customTargetText = typeof currentTargetArea === 'number' ? String(currentTargetArea) : ''

  const pickTargetPreset = (v) => {
    if (readOnly) return
    /* Picking a preset ALWAYS wins — clears any custom text since a
       preset value can't also be "custom". Also supports toggle-off
       on re-click for consistency with the roof/elevator controls. */
    patchState({ targetArea: currentTargetArea === v ? null : v })
  }
  const setTargetCustom = (raw) => {
    if (readOnly) return
    /* Native number input — empty / non-numeric → clear the field.
       This automatically deselects the segmented control
       (isPresetTarget goes false because targetArea is null or a
       non-preset number). Whole numbers only, matching the existing
       persisted data (see houseFromJSON's targetArea guard). */
    if (raw === '') { patchState({ targetArea: null }); return }
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) patchState({ targetArea: Math.round(n) })
  }

  /* ── Block B — floors + yard ─────────────────────────────────── */
  const isFloorOn = (key) => !!(houseState.floorsOn && houseState.floorsOn[key])
  const toggleFloor = (key) => {
    if (readOnly) return
    /* Ground floor is permanent-on — mirrors V1's rule. */
    if (key === 'ground') return
    const cur = isFloorOn(key)
    const nextFloorsOn = { ...(houseState.floorsOn || {}) }
    if (cur) delete nextFloorsOn[key]
    else     nextFloorsOn[key] = true
    patchState({ floorsOn: nextFloorsOn })
  }
  const toggleYard = () => {
    if (readOnly) return
    patchState({ yardOn: !houseState.yardOn })
  }

  /* ── Block C — general (roof / floor heating / elevator) ─────── */
  const general = houseState.general || {}
  const setRoof = (opt) => {
    if (readOnly) return
    /* Toggle-off on re-click so users can unset without a "none" chip. */
    patchGeneral({ roof: general.roof === opt ? null : opt })
  }
  const toggleHeatingFloor = (floorKey) => {
    if (readOnly) return
    const cur = Array.isArray(general.floorHeatingFloors) ? general.floorHeatingFloors : []
    const next = cur.includes(floorKey)
      ? cur.filter(k => k !== floorKey)
      : [...cur, floorKey]
    patchGeneral({ floorHeatingFloors: next })
  }
  const setElevator = (val) => {
    if (readOnly) return
    /* Toggle-off on re-click of the currently-selected chip → null. */
    patchGeneral({ elevator: general.elevator === val ? null : val })
  }

  /* ── Step 2 — rooms ──────────────────────────────────────────── */

  /* Rooms are stored per area under state.rooms — exact V1 shape.
     Every room is { id, type, props: {}, freeProps: [], sizeKey? }.
     `id` comes from state.roomSeq (int); we bump it on add. Fixed-
     area types skip sizeKey entirely (V1 rule). Container types are
     NOT offered by this phase — houseFromJSON preserves them
     on the round-trip so any pre-existing container from V1 renders
     through untouched. */
  const DEFAULT_SIZE_KEY = 'M'
  const resolveInitialSizeKey = (t) => {
    if (config.hasFixedArea && config.hasFixedArea(t)) return null
    const d = config.getDefaultSize ? config.getDefaultSize(t) : null
    if (d === 'S' || d === 'M' || d === 'L') return d
    return DEFAULT_SIZE_KEY
  }

  /* Build a fresh room object, allocating its id from `seq`. Returns
     [room, nextSeq] so callers can chain allocations (a container +
     its auto children) off ONE sequence and never collide. */
  const makeRoom = (t, seq) => {
    const room = { id: seq, type: t, props: {}, freeProps: [] }
    const sizeKey = resolveInitialSizeKey(t)
    if (sizeKey != null) room.sizeKey = sizeKey
    return [room, seq + 1]
  }

  const addRoomToFloor = (floorKey, type) => {
    if (readOnly) return
    const t = String(type || '').trim()
    if (!floorKey || !t) return
    setHouseState(prev => {
      let seq = prev.roomSeq || 1
      const [room, afterRoom] = makeRoom(t, seq)
      seq = afterRoom
      /* Containers arrive holding their configured auto children
         (e.g. יחידת סוויטה always starts with a חדר שינה). Children
         draw ids from the SAME sequence, so numbering stays
         collision-free. Non-containers get NO `children` key — the
         serializer only emits one when the array exists, so a plain
         room's saved shape is byte-identical to before. */
      if (isContainerType(t)) {
        room.children = []
        const autoKids = (config.getContainerAutoChildren
          ? config.getContainerAutoChildren(t)
          : []) || []
        for (const childType of autoKids) {
          const [child, afterChild] = makeRoom(childType, seq)
          seq = afterChild
          room.children.push(child)
        }
      }
      const nextRooms = { ...(prev.rooms || {}) }
      nextRooms[floorKey] = [...(nextRooms[floorKey] || []), room]
      const next = { ...prev, roomSeq: seq, rooms: nextRooms }
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
  }
  const removeRoomFromFloor = (floorKey, roomId) => {
    if (readOnly) return
    setHouseState(prev => {
      const list = (prev.rooms || {})[floorKey] || []
      const nextList = list.filter(r => r.id !== roomId)
      const nextRooms = { ...(prev.rooms || {}), [floorKey]: nextList }
      const next = { ...prev, rooms: nextRooms }
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
  }

  /* ── Container children ──────────────────────────────────────────
     Children live in `container.children`. With the one allowed
     nesting exception (יחידת סוויטה inside יחידת דיור), a container id
     can now live at ANY depth — top-level on the floor, or nested one
     level inside another container's own children — so these can no
     longer assume "one level deeper than addRoomToFloor" and search
     the floor's top-level array only. */

  /* Recursively find a room by id anywhere in a room tree — a
     top-level room, or nested inside a container's children to any
     depth — or null if it isn't there. Read-only; pairs with
     updateRoomById below for the write side. */
  const findRoomById = (list, id) => {
    for (const r of list) {
      if (r.id === id) return r
      if (Array.isArray(r.children) && r.children.length > 0) {
        const found = findRoomById(r.children, id)
        if (found) return found
      }
    }
    return null
  }

  /* Recursively find a room by id anywhere in a room tree and return
     a NEW tree with that room replaced by `updater(room)`. Returns
     the SAME array reference when the id isn't found anywhere, so
     callers can detect a no-op cheaply. Shared by addChildToContainer
     / removeChildFromContainer (and reused by the step-3 queue
     helpers further below) so a container nested inside another
     container can be located and mutated exactly like a top-level
     one. */
  const updateRoomById = (list, id, updater) => {
    let changed = false
    const next = list.map(r => {
      if (r.id === id) {
        changed = true
        return updater(r)
      }
      if (Array.isArray(r.children) && r.children.length > 0) {
        const nextChildren = updateRoomById(r.children, id, updater)
        if (nextChildren !== r.children) {
          changed = true
          return { ...r, children: nextChildren }
        }
      }
      return r
    })
    return changed ? next : list
  }

  const addChildToContainer = (floorKey, containerId, type) => {
    if (readOnly) return
    const t = String(type || '').trim()
    if (!floorKey || !t) return
    setHouseState(prev => {
      const list = (prev.rooms || {})[floorKey] || []
      /* Defence in depth — mirrors allowedChildTypes' own filter: a
         container child is refused unless this is the one allowed
         exception (יחידת סוויטה inside יחידת דיור). The child palette
         already excludes every other combination; this refuses
         anyway — including double-nesting inside an already-nested
         suite, whose own type is still יחידת סוויטה (not יחידת דיור),
         so it fails this same check exactly like a top-level suite
         would. */
      if (isContainerType(t)) {
        const container = findRoomById(list, containerId)
        const isAllowedNesting = container
          && container.type === DWELLING_UNIT_TYPE
          && t === SUITE_UNIT_TYPE
        if (!isAllowedNesting) return prev
      }
      let seq = prev.roomSeq || 1
      const [child, afterChild] = makeRoom(t, seq)
      seq = afterChild
      /* A container child arrives holding its own configured auto
         children too — exactly like addRoomToFloor does for a
         top-level container (e.g. יחידת סוויטה always starts with a
         חדר שינה, whether it's top-level or nested inside a יחידת
         דיור). Children draw ids from the SAME shared sequence. */
      if (isContainerType(t)) {
        child.children = []
        const autoKids = (config.getContainerAutoChildren
          ? config.getContainerAutoChildren(t)
          : []) || []
        for (const autoType of autoKids) {
          const [grandchild, afterGrandchild] = makeRoom(autoType, seq)
          seq = afterGrandchild
          child.children.push(grandchild)
        }
      }
      const nextList = updateRoomById(list, containerId, (container) => ({
        ...container,
        children: [...(container.children || []), child],
      }))
      if (nextList === list) return prev   // containerId not found — no-op
      const next = {
        ...prev,
        roomSeq: seq,
        rooms:   { ...(prev.rooms || {}), [floorKey]: nextList },
      }
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
  }

  /* Required-type rule (ported from V1): a child whose type is listed
     in the container's requiredTypes cannot be removed when it is the
     LAST child of that type. Pure predicate — used to disable the UI
     control AND re-checked inside the mutation below, so the rule
     holds even if the control is bypassed. Takes the DIRECT parent —
     for a room inside a nested suite that's the suite, not the outer
     dwelling. */
  const canRemoveChild = (container, child) => {
    if (!container || !child) return false
    const required = (config.getContainerRequiredTypes
      ? config.getContainerRequiredTypes(container.type)
      : []) || []
    if (!required.includes(child.type)) return true
    const sameType = (container.children || []).filter(c => c.type === child.type).length
    return sameType > 1
  }

  const removeChildFromContainer = (floorKey, containerId, childId) => {
    if (readOnly) return
    setHouseState(prev => {
      const list = (prev.rooms || {})[floorKey] || []
      const container = findRoomById(list, containerId)
      if (!container) return prev
      const child = (container.children || []).find(c => c.id === childId)
      if (!child) return prev
      /* The guard lives HERE, not only in the UI — refuse the write. */
      if (!canRemoveChild(container, child)) return prev
      const nextList = updateRoomById(list, containerId, (c) => ({
        ...c,
        children: (c.children || []).filter(ch => ch.id !== childId),
      }))
      if (nextList === list) return prev
      const next = { ...prev, rooms: { ...(prev.rooms || {}), [floorKey]: nextList } }
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
  }

  /* Which floors + yard the mini-house should render — respects step-1
     toggles. Ground is permanent-on. Order: matches V1's AREA_KEYS
     (first → ground → basement → yard) so global room numbering
     matches V1. */
  const AREA_KEYS = ['first', 'ground', 'basement', 'yard']
  const activeAreas = AREA_KEYS.filter(k => {
    if (k === 'yard')   return !!houseState.yardOn
    if (k === 'ground') return true
    return isFloorOn(k)
  })

  /* Local UI state — which floor the palette is editing. Defaults to
     the topmost active floor (usually 'ground' on a fresh house). If
     the currently-active floor toggles off in step 1, snap to the
     first available one. */
  const [activeAreaKey, setActiveAreaKey] = useState(() => activeAreas[0] || 'ground')
  useEffect(() => {
    if (!activeAreas.includes(activeAreaKey)) {
      setActiveAreaKey(activeAreas[0] || 'ground')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAreas.join('|')])

  /* Global room numbering per type (matches V1's roomLabel — walk
     AREA_KEYS in order + within-floor insertion order + recurse into
     containers). One kitchen globally → "מטבח" without a number;
     more than one → "מטבח 1", "מטבח 2"...
     Rebuilt on every houseState.rooms change via useMemo. */
  const displayType = config.displayType || ((t) => t)
  const isContainerType = config.isContainer || (() => false)
  const roomLabelById = useMemo(() => {
    const label = {}                     // roomId → display label
    const seenByType = {}                // type → { orderedIds, running }
    const visit = (r) => {
      if (!r) return
      if (!seenByType[r.type]) seenByType[r.type] = []
      seenByType[r.type].push(r.id)
      if (Array.isArray(r.children)) r.children.forEach(visit)
    }
    for (const k of AREA_KEYS) {
      const list = (houseState.rooms && houseState.rooms[k]) || []
      list.forEach(visit)
    }
    for (const [type, ids] of Object.entries(seenByType)) {
      if (ids.length <= 1) {
        label[ids[0]] = displayType(type)
      } else {
        ids.forEach((id, i) => { label[id] = `${displayType(type)} ${i + 1}` })
      }
    }
    return label
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseState.rooms])
  const roomLabel = (room) => roomLabelById[room.id] || displayType(room.type)

  /* Palette entries for the active floor — from the runtime config
     (already stripped of the 'חלל אחר' marker by the adapter).
     Container types are NO LONGER filtered out: they're offered like
     any other type and, once added, render as an expanded group in
     the room list below. */
  const paletteRegular = (config.getPalette
    ? config.getPalette(activeAreaKey)
    : []) || []

  const activeAreaRooms = (houseState.rooms && houseState.rooms[activeAreaKey]) || []

  /* Which container's "add child" palette is currently open (room id
     | null), and which container is awaiting delete confirmation.
     Both are transient view state — never serialized. */
  const [childPaletteFor,   setChildPaletteFor]   = useState(null)
  const [confirmRemoveUnit, setConfirmRemoveUnit] = useState(null)

  /* Allowed children for a container, minus any container type —
     enforces "no container inside a container" at the palette level,
     with the ONE exception: יחידת סוויטה may be added inside יחידת
     דיור. A nested suite's OWN allowedChildTypes still strips every
     container (including סוויטה itself) because ITS type isn't יחידת
     דיור — so a suite that's already nested can't itself receive a
     nested container, automatically, with no extra check needed. */
  const allowedChildTypes = (containerType) => {
    const allowed = (config.getContainerAllowedChildren
      ? config.getContainerAllowedChildren(containerType)
      : []) || []
    const filtered = allowed.filter(t => !isContainerType(t))
    /* The ONE exception, added explicitly rather than merely passed
       through: יחידת סוויטה may always be added inside יחידת דיור,
       regardless of whether the admin-configured allowedChildren list
       happens to include it. No existing config data COULD list it —
       the combination was hard-blocked until this build, so no admin
       ever had the option to configure it in. A nested suite's own
       allowedChildTypes still strips every container (its type isn't
       יחידת דיור), so this can't be exploited to double-nest. */
    if (containerType === DWELLING_UNIT_TYPE && !filtered.includes(SUITE_UNIT_TYPE)) {
      return [...filtered, SUITE_UNIT_TYPE]
    }
    return filtered
  }

  /* Remove a whole unit. With children it takes them along, so ask
     first; an empty unit goes immediately. `parentContainerId` is null
     for a top-level unit (removed via removeRoomFromFloor) or the
     owning container's id for a nested unit (removed via
     removeChildFromContainer, which already re-checks canRemoveChild
     — a nested unit generally isn't a requiredType of its parent, but
     the guard applies uniformly regardless). */
  const requestRemoveUnit = (floorKey, room, parentContainerId = null) => {
    if (readOnly) return
    if ((room.children || []).length > 0) {
      setConfirmRemoveUnit({ floorKey, roomId: room.id, parentContainerId })
      return
    }
    if (parentContainerId) {
      removeChildFromContainer(floorKey, parentContainerId, room.id)
    } else {
      removeRoomFromFloor(floorKey, room.id)
    }
  }

  /* Confirm-remove-unit action — reads the pending target straight off
     confirmRemoveUnit state (set by requestRemoveUnit above) so every
     nesting level shares this ONE handler instead of each needing its
     own closure. */
  const confirmRemoveUnitNow = () => {
    if (!confirmRemoveUnit) return
    const { floorKey, roomId, parentContainerId } = confirmRemoveUnit
    if (parentContainerId) {
      removeChildFromContainer(floorKey, parentContainerId, roomId)
    } else {
      removeRoomFromFloor(floorKey, roomId)
    }
    setConfirmRemoveUnit(null)
  }

  /* "אחר" custom-room input on the active floor. Local text state;
     writes a room whose `type` is the user's free string on submit. */
  const [customRoomName, setCustomRoomName] = useState('')
  const submitCustomRoom = () => {
    const t = customRoomName.trim()
    if (!t) return
    addRoomToFloor(activeAreaKey, t)
    setCustomRoomName('')
  }

  /* ── Step 3 — guided per-room characterization ───────────────────
     One-at-a-time queue over every REGULAR room across all active
     areas. Container rooms (יחידת סוויטה / יחידת דיור) are NOT
     characterized as a unit — their children become individual queue
     items instead (V1 does the same via its per-room drill-down).
     A room is "characterized" once the user touches any of its
     controls in this step — that populates `characterizedIds` for
     the progress counter only; there are no required fields, so a
     touched-but-untouched-again room still counts. */

  /* Build the ordered queue of {areaKey, roomId, parentId?}. AREA_KEYS
     order + within-floor insertion order + recurse into container
     children mirrors V1's global roomLabel walk, so queue position N
     always shows the same room the label "סלון 2" points at. */
  /* Step-3 queue order — deliberately different from AREA_KEYS so
     Einav walks users through the house in the natural "start here"
     sequence: ground floor first (most rooms live there), then up
     to first floor, then down to basement, then the yard last.
     AREA_KEYS itself (first → ground → basement → yard) stays
     unchanged so mini-house top-to-bottom layout and the V1-parity
     global roomLabel numbering are preserved — this ordering is
     ONLY for the guided characterization queue. */
  const CHARACTERIZATION_ORDER = ['ground', 'first', 'basement', 'yard']
  /* Walk one container's children, recursing into a nested container
     (the one allowed case: יחידת סוויטה inside יחידת דיור) instead of
     skipping it — so the nested suite's own auto-created room enters
     the queue exactly like a top-level suite's does. parentId is
     always the DIRECT parent (the nested suite, not the outer
     dwelling), matching roomDisplayName's "יחידת סוויטה - חדר רחצה"
     heading convention. */
  const collectCharacterizableChildren = (room, areaKey, items) => {
    for (const child of (room.children || [])) {
      if (isContainerType(child.type)) {
        collectCharacterizableChildren(child, areaKey, items)
      } else {
        items.push({ areaKey, roomId: child.id, parentId: room.id })
      }
    }
  }
  const characterizationQueue = useMemo(() => {
    const items = []
    for (const areaKey of CHARACTERIZATION_ORDER) {
      const list = (houseState.rooms || {})[areaKey] || []
      for (const room of list) {
        if (isContainerType(room.type)) {
          /* Container itself is NOT characterized; enqueue its
             characterizable descendants instead (recursing through
             any nested container along the way). */
          collectCharacterizableChildren(room, areaKey, items)
        } else {
          items.push({ areaKey, roomId: room.id, parentId: null })
        }
      }
    }
    return items
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseState.rooms])

  /* Per-item lookup — returns the room object at (areaKey, roomId,
     parentId) in the CURRENT state, or null. Kept in state-scope so
     Step 3 always reads the live values. parentId may itself be
     nested (a suite inside a dwelling), so the parent is located via
     findRoomById rather than a shallow top-level search. */
  const findQueueRoom = (item) => {
    if (!item) return null
    const list = (houseState.rooms || {})[item.areaKey] || []
    if (item.parentId != null) {
      const parent = findRoomById(list, item.parentId)
      if (!parent) return null
      return (parent.children || []).find(c => c.id === item.roomId) || null
    }
    return list.find(r => r.id === item.roomId) || null
  }

  /* The container a queue item belongs to, or null for a top-level
     room. Resolved straight off item.parentId via findRoomById, since
     that container may itself be nested one level deep. */
  const findQueueContainer = (item) => {
    if (!item || item.parentId == null) return null
    const list = (houseState.rooms || {})[item.areaKey] || []
    return findRoomById(list, item.parentId)
  }

  /* Immutable in-tree update — applies `updater(room)` to the room at
     (areaKey, roomId, parentId), returning a new state tree. When
     parentId is set, the owning container is located (and rebuilt) via
     updateRoomById so a room inside a nested suite resolves correctly,
     not just a room inside a top-level container. */
  const updateQueueRoom = (state, item, updater) => {
    if (!item) return state
    const list = (state.rooms || {})[item.areaKey] || []
    if (item.parentId != null) {
      const nextList = updateRoomById(list, item.parentId, (parent) => ({
        ...parent,
        children: (parent.children || []).map(c =>
          c.id === item.roomId ? updater(c) : c
        ),
      }))
      return { ...state, rooms: { ...(state.rooms || {}), [item.areaKey]: nextList } }
    }
    const nextList = list.map(room => room.id === item.roomId ? updater(room) : room)
    return { ...state, rooms: { ...(state.rooms || {}), [item.areaKey]: nextList } }
  }

  /* Set of roomIds that have been TOUCHED in step 3 this session —
     powers the "N אופיינו" progress. Not persisted (the underlying
     room may already carry values from a prior session; we consider
     that "characterized" too and pre-seed the set on first mount). */
  const [characterizedIds, setCharacterizedIds] = useState(() => {
    const seed = new Set()
    /* Any room that already carries a sizeKey (non-default), any
       props keys, or any freeProps counts as characterized on entry.
       This way returning to a saved questionnaire shows an accurate
       count instead of resetting to 0. */
    const seedFromList = (list, isChild) => {
      for (const r of (list || [])) {
        if (isChild && !r) continue
        const hasProps      = r.props      && Object.keys(r.props).length > 0
        const hasFreeProps  = Array.isArray(r.freeProps) && r.freeProps.length > 0
        const hasSize       = typeof r.sizeKey === 'string' && r.sizeKey && r.sizeKey !== DEFAULT_SIZE_KEY
        if (hasProps || hasFreeProps || hasSize) seed.add(r.id)
      }
    }
    const rooms = (initialData && initialData.rooms) || {}
    for (const k of ['first', 'ground', 'basement', 'yard']) {
      const list = rooms[k] || []
      for (const r of list) {
        if (r && Array.isArray(r.children)) seedFromList(r.children, true)
        else seedFromList([r], false)
      }
    }
    return seed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })

  const markCharacterized = (roomId) => setCharacterizedIds(prev => {
    if (prev.has(roomId)) return prev
    const next = new Set(prev)
    next.add(roomId)
    return next
  })

  /* Per-room mutators — each wraps setHouseState + emits onChange +
     marks the room characterized.

     props shape: { [groupKey]: [selected option labels] } — ONE key
     per property group holding an array. Every option is an
     independent toggle; nothing is mutually exclusive any more, so
     the config's single/multi `type` is not consulted here at all.

     The group key keeps the legacy 'r'+gi spelling on purpose: that
     is where the old single-select shape stored its chosen string,
     so houseFromJSON's string→[string] coercion lands on the very
     key this screen reads back. */
  const setQueueRoomSize = (item, sizeKey) => {
    if (readOnly || !item) return
    if (!SIZE_LABELS_MAP[sizeKey]) return
    setHouseState(prev => {
      const next = updateQueueRoom(prev, item, r => ({ ...r, sizeKey }))
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
    markCharacterized(item.roomId)
  }
  /* Toggle ONE option inside ONE group. Selecting an option never
     clears a sibling — "אופי פתוח" and "אופי אינטימי" can both be on. */
  const toggleQueueRoomOption = (item, gi, opt) => {
    if (readOnly || !item) return
    const key = propGroupKey(gi)
    setHouseState(prev => {
      const next = updateQueueRoom(prev, item, r => {
        const cur  = Array.isArray((r.props || {})[key]) ? (r.props || {})[key] : []
        const nextArr = cur.includes(opt)
          ? cur.filter(x => x !== opt)
          : [...cur, opt]
        return { ...r, props: { ...(r.props || {}), [key]: nextArr } }
      })
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
    markCharacterized(item.roomId)
  }
  const addQueueRoomFreeProp = (item, text) => {
    if (readOnly || !item) return
    const t = (text || '').trim()
    if (!t) return
    setHouseState(prev => {
      const next = updateQueueRoom(prev, item, r => ({
        ...r,
        freeProps: [...(r.freeProps || []), t],
      }))
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
    markCharacterized(item.roomId)
  }
  const removeQueueRoomFreeProp = (item, idx) => {
    if (readOnly || !item) return
    setHouseState(prev => {
      const next = updateQueueRoom(prev, item, r => ({
        ...r,
        freeProps: (r.freeProps || []).filter((_, i) => i !== idx),
      }))
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
    markCharacterized(item.roomId)
  }
  /* Free-text "הערה" — a single note string per room, distinct from
     freeProps (a list of short selected-chip tags). Written straight
     through on every change, same as every other characterization
     control on this screen; the outer debounced auto-save / manual
     "שמור טיוטה" persists it like anything else in houseState. Does
     NOT call markCharacterized — a note is supplementary, not a
     "characteristic" (mirrors hasCharacterization's existing rule
     that sizeKey alone doesn't count either). */
  const setQueueRoomNote = (item, text) => {
    if (readOnly || !item) return
    setHouseState(prev => {
      const next = updateQueueRoom(prev, item, r => ({ ...r, note: text }))
      if (typeof onChange === 'function') onChange(houseToJSON(next))
      return next
    })
  }

  /* Step-3 queue cursor. Clamped in render if the queue shrinks
     (e.g., user goes back to step 2 and removes rooms). */
  const [charIndex, setCharIndex] = useState(0)
  /* If a floor toggles off and the queue shrinks past the cursor,
     snap the cursor back into bounds without user action. */
  useEffect(() => {
    if (charIndex >= characterizationQueue.length && characterizationQueue.length > 0) {
      setCharIndex(characterizationQueue.length - 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterizationQueue.length])

  /* Wizard step index (0 / 1 / 2 → STEPS entry). */
  const [stepIndex, setStepIndex] = useState(0)

  /* Reset scroll to the top on every step change (הבא/הקודם, or the
     step-number chips). Which thing actually needs resetting depends
     on how this component is hosted, and it isn't always the same:
       · The step body's own overflowY:auto (below) IS the scroller
         when nothing above bounds its height.
       · The standalone client portal has no internal height cap at
         all — the WINDOW scrolls.
       · The admin split-screen embed (MeetingSummariesTab) wraps this
         whole component in ITS OWN fixed-height, internally-scrolling
         panel — our own overflow never actually engages there, and
         the window doesn't move either.
     Rather than special-case each host, walk up from the step body to
     find whichever ancestor is ACTUALLY scrolled (scrollHeight >
     clientHeight) within a few hops and reset it; only fall back to
     the window when none is found, so we don't yank an unrelated
     outer page to the top when an inner container already owns it. */
  const stepBodyRef = useRef(null)
  useEffect(() => {
    stepBodyRef.current?.scrollTo(0, 0)

    let scrolledAncestor = false
    let node = stepBodyRef.current?.parentElement
    let hops = 0
    while (node && hops < 8) {
      const cs = window.getComputedStyle(node)
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        node.scrollTo(0, 0)
        scrolledAncestor = true
      }
      node = node.parentElement
      hops++
    }
    if (!scrolledAncestor) {
      window.scrollTo({ top: 0 })
    }
  }, [stepIndex])

  /* Intro / opening screen — shown once per mount BEFORE the wizard.
     Mirrors V1's INTRO landing (איך בונים את הבית? + 3 numbered
     steps + CTA). Not persisted — reopens on next mount, which is
     fine because users typically only see it once per session. */
  const [showIntro, setShowIntro] = useState(true)

  /* Per-step guide-bubble dismiss state — a Set of step keys the user
     has closed this session. Not persisted — reopens on next mount. */
  const [dismissedGuides, setDismissedGuides] = useState(() => new Set())
  const dismissGuide = (key) => setDismissedGuides(prev => {
    const next = new Set(prev)
    next.add(key)
    return next
  })

  const step        = STEPS[stepIndex]
  const isFirstStep = stepIndex === 0
  const isLastStep  = stepIndex === STEPS.length - 1
  const guideOpen   = !dismissedGuides.has(step.key)

  /* The footer is ALWAYS step navigation — steps 1→2→3 — in every
     step including step 3. Room-to-room navigation inside step 3's
     guided queue lives in its own inline text links on the room
     card (see Step3Characterization), so the two never compete. */
  const goNext = () => {
    if (isLastStep) {
      /* Finish ("סיימתי"). Hand the parent the CURRENT house JSON so
         it can persist the content and the house_done flag in one
         explicit save, then navigate back to the hub. Previously this
         called onDone() with no argument, which the parent's handler
         treated as "nothing to save" — so the button did nothing. */
      if (typeof onDone === 'function') onDone(houseToJSON(houseState))
      return
    }
    setStepIndex(i => Math.min(STEPS.length - 1, i + 1))
  }
  const goPrev = () => {
    if (isFirstStep) return
    setStepIndex(i => Math.max(0, i - 1))
  }

  /* ── Intro / opening screen ──
     3-step overview + CTA "בואו נתחיל" that dismisses the intro
     and enters the wizard. Restored from V1's INTRO but rewritten
     for V2's new 3-step order (was 4 in V1 — chapters were
     reorganized when heating+elevator moved to the questionnaire). */
  if (showIntro) {
    const INTRO_STEPS = [
      { n: '1', title: 'מגדירים את הבית',    text: 'בחרו את גודל הבית ואת המפלסים שיהיו בו: קומת קרקע, קומה א׳, מרתף, חצר.' },
      { n: '2', title: 'ממלאים חללים',      text: 'לכל מפלס — הוסיפו את החדרים והחללים שיהיו בו (סלון, מטבח, חדר ילדים...).' },
      { n: '3', title: 'מפרטים כל חלל',     text: 'עוברים חלל אחר חלל ומאפיינים את הגודל והתכונות של כל אחד.' },
    ]
    return (
      <div
        dir="rtl"
        style={{
          display:        'flex',
          flexDirection:  'column',
          minHeight:      480,
          background:     CREAM,
          color:          CHARCOAL,
          fontFamily:     'inherit',
          padding:        '18px 18px 32px',
        }}
      >
        {/* Header row — title at the RTL start (visual RIGHT), round
            back-arrow at the visual LEFT of the SAME row, vertically
            centered. The arrow returns to the programming hub:
            onBack() → parent's handleHouseBack → setView('hub'). */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          gap:            10,
          direction:      'rtl',
          marginBottom:   4,
        }}>
          <h1 style={{
            margin:     0,
            flex:       1,
            minWidth:   0,
            fontSize:   22,
            fontWeight: 700,
            color:      CHARCOAL,
            lineHeight: 1.25,
            textAlign:  'right',
            fontFamily: "'Playfair Display', 'Heebo', serif",
          }}>
            איך בונים את הבית?
          </h1>
          {typeof onBack === 'function' && (
            <BackToHubLink onBack={onBack} />
          )}
        </div>
        <p style={{
          margin:     '0 0 14px',
          fontSize:   13,
          color:      MUTED,
          lineHeight: 1.5,
          textAlign:  'right',
        }}>
          שלושה שלבים קצרים — כדי לתכנן את הבית שלכם ביחד
        </p>
        <ol style={{
          listStyle: 'none',
          padding:   0,
          margin:    '0 0 20px',
          display:   'flex',
          flexDirection: 'column',
          gap:       10,
        }}>
          {INTRO_STEPS.map(s => (
            <li
              key={s.n}
              style={{
                background:   '#ffffff',
                border:       `1px solid ${BORDER}`,
                borderRadius: 10,
                padding:      '12px 14px',
                display:      'flex',
                gap:          12,
                direction:    'rtl',
              }}
            >
              <span style={{
                flexShrink:     0,
                width:          32,
                height:         32,
                borderRadius:   999,
                background:     SAGE,
                color:          '#ffffff',
                display:        'inline-flex',
                alignItems:     'center',
                justifyContent: 'center',
                fontFamily:     "'Playfair Display', serif",
                fontSize:       15,
                fontWeight:     700,
              }}>
                {s.n}
              </span>
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: CHARCOAL, marginBottom: 2 }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
                  {s.text}
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p style={{
          margin:     '0 0 18px',
          fontSize:   12,
          color:      MUTED,
          lineHeight: 1.5,
          textAlign:  'center',
          fontStyle:  'italic',
        }}>
          אפשר לשנות הכל בכל שלב — פשוט שחקו עם זה 🙂
        </p>
        <button
          type="button"
          onClick={() => setShowIntro(false)}
          disabled={readOnly}
          style={{
            background:   SAGE,
            color:        '#ffffff',
            border:       `1px solid ${SAGE_DARK}`,
            borderRadius: 8,
            padding:      '12px 20px',
            fontFamily:   'inherit',
            fontSize:     15,
            fontWeight:   600,
            cursor:       readOnly ? 'not-allowed' : 'pointer',
            opacity:      readOnly ? 0.6 : 1,
            alignSelf:    'center',
            minWidth:     180,
          }}
        >
          בואו נתחיל
        </button>
      </div>
    )
  }

  return (
    <div
      dir="rtl"
      style={{
        display:        'flex',
        flexDirection:  'column',
        minHeight:      480,
        background:     CREAM,
        color:          CHARCOAL,
        fontFamily:     'inherit',
      }}
    >
      {/* ── Screen header — title row + subtitle ──────────────────
          Title sits at the RTL start (visual RIGHT) with the round
          back-arrow at the visual LEFT of the SAME row, vertically
          centered. The arrow returns to the programming hub:
          onBack() → parent's handleHouseBack → setView('hub'). */}
      <div style={{
        padding:   '12px 14px 4px',
        direction: 'rtl',
      }}>
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          gap:            10,
        }}>
          <h1 style={{
            margin:     0,
            flex:       1,
            minWidth:   0,
            fontSize:   20,
            fontWeight: 700,
            color:      CHARCOAL,
            lineHeight: 1.25,
            textAlign:  'right',
            fontFamily: "'Playfair Display', 'Heebo', serif",
          }}>
            מערכת בונה הבית
          </h1>
          {typeof onBack === 'function' && (
            <BackToHubLink onBack={onBack} />
          )}
        </div>
        <p style={{
          margin:     '4px 0 0',
          fontSize:   13,
          color:      MUTED,
          lineHeight: 1.5,
          textAlign:  'right',
        }}>
          בעזרת מערכת זו נאפיין ביחד כמה קומות יהיו לבית, ואיזה חדרים וחללים יהיו בו
        </p>
      </div>

      {/* ── Top progress bar — 3 steps ────────────────────────────── */}
      <div style={{
        display:       'flex',
        alignItems:    'stretch',
        /* Row gap trimmed from 8 → 4 and outer horizontal padding
           trimmed from 12 → 6 so each 1/3 pill has more room for
           its Hebrew title. Top padding trimmed 12 → 6 so the pills
           sit closer under the title row. */
        gap:           4,
        padding:       '6px 6px 8px',
      }}>
        {STEPS.map((s, i) => {
          const active     = i === stepIndex
          const done       = i < stepIndex
          const bg         = active ? SAGE : done ? SAGE_LITE : '#ffffff'
          const color      = active ? '#ffffff' : done ? SAGE_DARK : MUTED
          /* Sub-label sits inside the same pill under the main label —
             smaller and de-emphasised. On the ACTIVE pill it stays
             legible against sage (white a touch dimmed); on others it
             uses the muted token so the primary title reads first. */
          const subColor   = active ? 'rgba(255,255,255,0.85)' : MUTED
          const border     = active ? `1px solid ${SAGE_DARK}` : `1px solid ${BORDER}`
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStepIndex(i)}
              aria-current={active ? 'step' : undefined}
              title={`${s.title} — ${s.titleSub}`}
              style={{
                flex:        '1 1 0',
                minWidth:    0,
                background:  bg,
                color,
                border,
                borderRadius: 14,
                /* Horizontal padding trimmed 10 → 4 so the title
                   has ~12 more px per pill for text. Vertical
                   padding unchanged. */
                padding:     '8px 4px',
                fontFamily:  'inherit',
                cursor:      'pointer',
                transition:  'background 0.15s, color 0.15s',
                display:     'flex',
                flexDirection: 'column',
                alignItems:  'center',
                justifyContent: 'center',
                gap:         2,
                textAlign:   'center',
                overflow:    'hidden',
              }}
            >
              {/* Line 1: small "שלב N" tag on its own line so the
                  main title never has to share space with the step
                  number. Uses the same subColor as the sub-label so
                  it reads as meta info against the pill background. */}
              <span style={{
                fontSize:   9.5,
                fontWeight: 500,
                color:      subColor,
                lineHeight: 1.1,
                whiteSpace: 'nowrap',
                letterSpacing: '0.06em',
              }}>
                שלב {i + 1}
              </span>
              {/* Line 2: main title. Font trimmed 12.5 → 11.5 so
                  "מאפיינים כלליים" (the longest title) fits on one
                  line in the narrowest pill. Wrapping is ENABLED
                  (whiteSpace: normal) instead of ellipsis-truncated
                  — priority is visibility of the full title; if a
                  narrow viewport still can't fit it on one line,
                  the title wraps to a second line rather than
                  clipping with "...". */}
              <span style={{
                fontSize:      11.5,
                fontWeight:    active ? 700 : 500,
                whiteSpace:    'normal',
                overflowWrap:  'break-word',
                wordBreak:     'break-word',
                lineHeight:    1.2,
                maxWidth:      '100%',
              }}>
                {s.title}
              </span>
              {/* Line 3: sub-label, wraps on narrow viewports. */}
              <span style={{
                fontSize:   10.5,
                fontWeight: 400,
                color:      subColor,
                lineHeight: 1.25,
                whiteSpace: 'normal',
              }}>
                {s.titleSub}
              </span>
            </button>
          )
        })}
      </div>

      {/* Step counter — mirrors V1's subtle "שלב N מתוך 3" hint. */}
      <div style={{
        padding:   '0 14px 8px',
        fontSize:  12,
        color:     MUTED,
      }}>
        שלב {stepIndex + 1} מתוך {STEPS.length}
      </div>

      {/* ── Guide bubble — dismissible per step ─────────────────────
          Two lines: primary guide + smaller/lighter secondary line
          under it. Same sage-tinted card + close X on the visual-LEFT. */}
      {guideOpen && (
        <div
          role="note"
          style={{
            margin:       '0 12px 12px',
            padding:      '10px 14px 10px 34px',
            background:   SAGE_LITE,
            border:       `1px solid ${SAGE}`,
            borderInlineStart: `4px solid ${SAGE_DARK}`,
            borderRadius: 10,
            color:        CHARCOAL,
            position:     'relative',
          }}
        >
          <div style={{
            fontSize:   13.5,
            lineHeight: 1.5,
            fontWeight: 500,
          }}>
            {step.guide}
          </div>
          {step.guideSub && (
            <div style={{
              marginTop:  4,
              fontSize:   12,
              lineHeight: 1.45,
              color:      MUTED,
            }}>
              {step.guideSub}
            </div>
          )}
          <button
            type="button"
            onClick={() => dismissGuide(step.key)}
            aria-label="סגור הסבר"
            title="סגור הסבר"
            style={{
              position:       'absolute',
              /* Visual-LEFT in RTL — the "away" corner from reading start. */
              insetInlineEnd: 'auto',
              left:           6,
              top:            6,
              background:     'transparent',
              border:         'none',
              padding:        4,
              cursor:         'pointer',
              color:          SAGE_DARK,
              display:        'inline-flex',
              alignItems:     'center',
              justifyContent: 'center',
            }}
          >
            <IconClose size={12} />
          </button>
        </div>
      )}

      {/* ── Step body ─────────────────────────────────────────────── */}
      <div
        ref={stepBodyRef}
        style={{
          flex:      '1 1 auto',
          padding:   '14px 12px 20px',
          overflowY: 'auto',
          minHeight: 200,
          opacity:   readOnly ? 0.75 : 1,
        }}
      >
        {stepIndex === 0 ? (
          /* ─── Step 1 body — general/big-picture form.
                Compact, form-only (no schematic — that lives in step 2).
                Three blocks all writing to the same answers.house fields
                V1 writes (targetArea, floorsOn, yardOn, general.*). ─── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* ── Block A — גודל הבית ──
                Single freeform numeric input. The preset segments
                were dropped — Einav prefers to type a specific
                value directly. Single source of truth remains
                answers.house.targetArea (number|null). */}
            <Section title="גודל הבית" subtitle="הזינו גודל רצוי במ״ר (בערך) — ניתן לשנות מאוחר יותר">
              <TextInput
                type="number"
                min={1}
                value={customTargetText}
                onChange={setTargetCustom}
                placeholder="גודל במ״ר"
                readOnly={readOnly}
                inputMode="numeric"
                ariaLabel="גודל הבית במ״ר"
                style={{
                  width:        '100%',
                  padding:      '10px 12px',
                  fontSize:     14,
                  lineHeight:   1.2,
                  borderRadius: 8,
                  textAlign:    'right',
                  color:        CHARCOAL,
                }}
              />
            </Section>

            {/* ── Block B — קומות וחצר ── */}
            <Section title="קומות וחצר" subtitle="סמנו אילו מפלסים יהיו בבית (קומת קרקע קבועה תמיד)">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {FLOOR_DEFS.map(floor => {
                  /* Ground is permanent-on (matches V1). Render as a
                     locked row so users see it but can't uncheck. */
                  const isGround = floor.key === 'ground'
                  const checked  = isGround ? true : isFloorOn(floor.key)
                  return (
                    <ToggleRow
                      key={floor.key}
                      label={floor.label}
                      checked={checked}
                      onToggle={() => toggleFloor(floor.key)}
                      disabled={readOnly || isGround}
                      hint={isGround ? 'תמיד פעילה' : null}
                    />
                  )
                })}
                <ToggleRow
                  label={YARD_LABEL}
                  checked={!!houseState.yardOn}
                  onToggle={toggleYard}
                  disabled={readOnly}
                />
              </div>
            </Section>

            {/* ── Block C — סוג גג ──
                Roof is architecturally tied to the mini-house sketch
                (drives the roof SVG shape), so it stays in the
                builder. Heating + elevator moved out to their own
                questionnaire chapter — they're project-level toggles
                that don't drive the house drawing. */}
            <Section title="סוג גג" subtitle="בחרו את סוג הגג של הבית">
              <Segmented
                options={ROOF_OPTIONS.map(opt => ({ value: opt, label: opt }))}
                selected={general.roof || null}
                onSelect={setRoof}
                disabled={readOnly}
                ariaLabel="סוג גג"
              />
            </Section>

          </div>
        ) : stepIndex === 1 ? (
          /* ─── Step 2 body — rooms per floor.
                Sticky mini-house at top + segmented floor selector +
                palette of allowed types for the active floor. Writes
                to the SAME answers.house.rooms structure V1 uses. ─── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* ── Sticky mini-house ── */}
            <MiniHouse
              activeAreas={activeAreas}
              activeAreaKey={activeAreaKey}
              onSelectArea={setActiveAreaKey}
              rooms={houseState.rooms || {}}
              roof={(houseState.general && houseState.general.roof) || null}
              roomLabel={roomLabel}
              displayType={displayType}
              isContainerType={isContainerType}
              /* Per-room delete, straight on the schematic's boxes.
                 Containers route through requestRemoveUnit so a unit
                 holding children still raises the existing confirm
                 dialog before it (and they) disappear; plain rooms go
                 straight out. Passing undefined in readOnly hides the
                 bins altogether rather than rendering dead controls —
                 both mutations refuse readOnly writes anyway. */
              onRemoveRoom={readOnly ? undefined : (floorKey, room) => {
                if (isContainerType(room.type)) {
                  requestRemoveUnit(floorKey, room, null)
                } else {
                  removeRoomFromFloor(floorKey, room.id)
                }
              }}
            />

            {/* ── Floor selector (segmented, redundant with mini-house
                  taps but useful when the mini-house scrolls). Also
                  shows the room count per floor. ── */}
            <Section title="בחירת מפלס לעריכה" subtitle="הקישו על מפלס כדי לערוך את החדרים שבו">
              <Segmented
                options={activeAreas.map(k => {
                  const label = k === 'yard'
                    ? (YARD_LABEL || 'חצר')
                    : (FLOOR_DEFS.find(f => f.key === k)?.label || k)
                  const count = ((houseState.rooms || {})[k] || []).length
                  return { value: k, label: count > 0 ? `${label} (${count})` : label }
                })}
                selected={activeAreaKey}
                onSelect={setActiveAreaKey}
                disabled={readOnly}
                ariaLabel="בחירת מפלס לעריכה"
              />
            </Section>

            {/* ── Add rooms from palette ── */}
            <Section
              title={`הוספת חלל ל${activeAreaKey === 'yard' ? (YARD_LABEL || 'חצר') : (FLOOR_DEFS.find(f => f.key === activeAreaKey)?.label || 'מפלס')}`}
              subtitle="הקישו על סוג חלל כדי להוסיף אותו למפלס הפעיל"
            >
              {paletteRegular.length === 0 ? (
                <div style={{ fontSize: 13, color: MUTED }}>
                  אין סוגי חללים זמינים למפלס הזה.
                </div>
              ) : (
                <div style={{
                  display:             'grid',
                  /* Exactly 3 equal columns → 3 palette buttons per
                     row regardless of label length. `1fr` per column
                     works with roomButtonStyle's width:100% so each
                     PaletteButton fills its cell. */
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap:                 8,
                  direction:           'rtl',
                }}>
                  {paletteRegular.map(t => {
                    const count = activeAreaRooms.filter(r => r.type === t).length
                    return (
                      <PaletteButton
                        key={t}
                        label={displayType(t)}
                        count={count}
                        disabled={readOnly}
                        onClick={() => addRoomToFloor(activeAreaKey, t)}
                      />
                    )
                  })}
                </div>
              )}

              {/* Custom / free-text room — matches V1's "חלל אחר" affordance.
                  Type any name, tap ＋ → adds a room with that user-typed
                  type string. Reads/writes the same answers.house.rooms
                  shape as any other room. */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                marginTop: 10, direction: 'rtl',
              }}>
                <TextInput
                  value={customRoomName}
                  onChange={setCustomRoomName}
                  placeholder="חלל אחר — הזינו שם"
                  readOnly={readOnly}
                  ariaLabel="שם חלל מותאם"
                  style={{ flex: '1 1 auto', minWidth: 0 }}
                />
                <button
                  type="button"
                  onClick={submitCustomRoom}
                  disabled={readOnly || !customRoomName.trim()}
                  aria-label="הוסף חלל אחר"
                  style={{
                    background:   SAGE,
                    color:        '#ffffff',
                    border:       `1px solid ${SAGE_DARK}`,
                    borderRadius: 8,
                    padding:      '8px 14px',
                    fontFamily:   'inherit',
                    fontSize:     13,
                    fontWeight:   600,
                    cursor:       (readOnly || !customRoomName.trim()) ? 'not-allowed' : 'pointer',
                    opacity:      (readOnly || !customRoomName.trim()) ? 0.55 : 1,
                    flexShrink:   0,
                  }}
                >
                  ＋ הוסף
                </button>
              </div>
            </Section>

            {/* ── Units on the active floor ──────────────────────────
                  This used to be a "חללים נוכחיים במפלס" list holding
                  BOTH plain rooms (as RoomChips whose only purpose was
                  their × remove button) and units. Deleting a room now
                  happens directly on its box in the schematic above, so
                  the RoomChip half is gone.

                  The ContainerGroup half stays: it is NOT a deletion
                  list — it's the only place to add/remove a unit's
                  CHILDREN (and the only surface enforcing the
                  required-type rule via canRemoveChild). Children are
                  drawn inline as text inside the schematic's unit strip,
                  so they have no box of their own to host a bin.

                  Retitled from "חללים נוכחיים במפלס" because only units
                  render here now — the old title plus the old
                  "הקישו על × כדי להסיר חלל" subtitle would both describe
                  controls that no longer exist. Hidden entirely when the
                  floor has no units. ── */}
            {activeAreaRooms.some(room => isContainerType(room.type)) && (
              <Section
                title="יחידות במפלס"
                subtitle="הוסיפו או הסירו חללים בתוך כל יחידה"
              >
                <div style={{
                  display:             'grid',
                  /* Same 3-column rule as the palette so the units grid
                     reads as its symmetric counterpart. */
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap:                 8,
                  direction:           'rtl',
                }}>
                  {activeAreaRooms
                    .filter(room => isContainerType(room.type))
                    .map(room => (
                      /* Always-expanded group block (header / children /
                         add-child footer). There is no "enter the unit"
                         mode — the user never leaves the floor. The
                         group spans the full grid width so it reads as
                         a container, not a chip. */
                      <ContainerGroup
                        key={room.id}
                        room={room}
                        parentContainerId={null}
                        floorKey={activeAreaKey}
                        roomLabel={roomLabel}
                        isContainerType={isContainerType}
                        getChildTypes={allowedChildTypes}
                        displayType={displayType}
                        canRemoveChild={canRemoveChild}
                        childPaletteFor={childPaletteFor}
                        onTogglePalette={(id) =>
                          setChildPaletteFor(v => (v === id ? null : id))
                        }
                        onAddChild={addChildToContainer}
                        onRemoveChild={removeChildFromContainer}
                        onRequestRemoveUnit={requestRemoveUnit}
                        confirmRemoveUnit={confirmRemoveUnit}
                        onConfirmRemoveUnit={confirmRemoveUnitNow}
                        onCancelRemoveUnit={() => setConfirmRemoveUnit(null)}
                        disabled={readOnly}
                      />
                    ))}
                </div>
              </Section>
            )}

          </div>
        ) : (
          /* ─── Step 3 body — guided per-room characterization.
                One-at-a-time card over the ordered queue. Writes into
                the SAME answers.house.rooms shape V1 writes (per-room
                sizeKey / props / freeProps), so a swap between V1 and
                V2 preserves data. ─── */
          <Step3Characterization
            queue={characterizationQueue}
            index={Math.min(charIndex, Math.max(0, characterizationQueue.length - 1))}
            onIndexChange={setCharIndex}
            findQueueRoom={findQueueRoom}
            findQueueContainer={findQueueContainer}
            characterizedIds={characterizedIds}
            config={config}
            displayType={displayType}
            roomLabel={roomLabel}
            FLOOR_DEFS={FLOOR_DEFS}
            YARD_LABEL={YARD_LABEL}
            setQueueRoomSize={setQueueRoomSize}
            toggleQueueRoomOption={toggleQueueRoomOption}
            addQueueRoomFreeProp={addQueueRoomFreeProp}
            removeQueueRoomFreeProp={removeQueueRoomFreeProp}
            setQueueRoomNote={setQueueRoomNote}
            onFinish={() => { if (typeof onDone === 'function') onDone() }}
            readOnly={readOnly}
          />
        )}
      </div>

      {/* ── Bottom nav — IDENTICAL to the questionnaire's footer ──
          Same three-button row, same dimensions/colors/spacing:
            RIGHT  "הקודם"      — outline; disabled on step 1. On
                                  step 3 it walks BACK through the
                                  room queue before leaving the step.
            MIDDLE "שמור טיוטה" — shared .cp-shared-upload-btn class,
                                  wired to the parent's manual save.
            LEFT   "הבא"        — primary sage. Becomes "סיימתי" only
                                  at the very end (last step AND last
                                  room in the queue), where it fires
                                  the finish handler.
          Copied verbatim from ClientProgrammingQuestionnaire's nav
          row so the two modules' footers read as one design. */}
      <div style={{
        padding:    '10px 12px 14px',
        borderTop:  `1px solid ${BORDER}`,
        background: '#ffffff',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          justifyContent: 'space-between', flexWrap: 'nowrap',
          direction: 'rtl',
        }}>
          <button
            type="button"
            onClick={goPrev}
            disabled={isFirstStep || savingDraft}
            style={{
              flex:        '0 1 108px',
              minWidth:    100,
              background:  'none', border: '1px solid #d9d6cd', borderRadius: 8,
              padding:     '8px 4px', textAlign: 'center',
              cursor:      (isFirstStep || savingDraft) ? 'not-allowed' : 'pointer',
              fontFamily:  'inherit', fontSize: 14, color: '#4a4a48',
              opacity:     isFirstStep ? 0.4 : 1,
              boxSizing:   'border-box',
            }}
          >
            הקודם
          </button>

          <button
            type="button"
            className="cp-shared-upload-btn"
            onClick={() => onManualSave && onManualSave()}
            disabled={readOnly || savingDraft || typeof onManualSave !== 'function'}
            style={{
              flex:      '0 1 auto',
              minWidth:  88,
              padding:   '7px 10px',
              fontSize:  13.5,
              boxSizing: 'border-box',
            }}
          >
            {savingDraft ? 'שומר...' : 'שמור טיוטה'}
          </button>

          <button
            type="button"
            onClick={goNext}
            disabled={savingDraft}
            style={{
              flex:        '0 1 108px',
              minWidth:    100,
              background:  '#7a9478', border: '1px solid #5d7259', borderRadius: 8,
              padding:     '8px 4px', textAlign: 'center',
              cursor:      savingDraft ? 'not-allowed' : 'pointer',
              fontFamily:  'inherit', fontSize: 14, color: '#ffffff',
              fontWeight:  500,
              boxSizing:   'border-box',
            }}
          >
            {isLastStep ? 'סיימתי' : 'הבא'}
          </button>
        </div>

        {savedFlash && (
          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <span style={{ fontSize: 13, color: '#4a7f4a', fontWeight: 500 }}>
              נשמר ✓
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   Presentational sub-components — kept small and inline so the Step-1
   body reads clearly. Reused by future step bodies as well; hoisted
   here (module scope) so they're stable across renders.
   ───────────────────────────────────────────────────────────────── */

function Section({ title, subtitle, children }) {
  return (
    <section style={{
      background:   '#ffffff',
      border:       `1px solid ${BORDER}`,
      borderRadius: 10,
      padding:      '12px 14px',
    }}>
      <div style={{
        fontSize:   14,
        fontWeight: 700,
        color:      CHARCOAL,
        marginBottom: subtitle ? 2 : 8,
      }}>
        {title}
      </div>
      {subtitle && (
        <div style={{
          fontSize:   12,
          color:      MUTED,
          marginBottom: 10,
          lineHeight: 1.4,
        }}>
          {subtitle}
        </div>
      )}
      {children}
    </section>
  )
}

function FieldLabel({ children, style }) {
  return (
    <div style={{
      fontSize:   12.5,
      fontWeight: 600,
      color:      CHARCOAL,
      marginBottom: 6,
      ...style,
    }}>
      {children}
    </div>
  )
}

/* ── Segmented — joined single- OR multi-select bar (matches V1's
      .hb-segment tokens verbatim). Uses the EXACT V1 tokens: soft-grey
      #d9d6cd border, 20px pill rounding on the container, 6×10
      padding, 12.5px labels, sage fill on selected segments. RTL:
      direction:rtl on the row places the FIRST DOM segment at the
      visual-RIGHT. Inner separators via border-right on all non-first
      segments.

      Props:
        mode: 'single' (default) — `selected` is a value; picking a
              segment calls onSelect(value).
        mode: 'multi'            — `selected` is an array of values;
              picking a segment calls onSelect(value) and the caller
              toggles membership. Multiple segments can be sage-filled
              at once.
        fullWidth: true (default) — segments stretch (flex: 1 1 0) so
              the bar fills its container.
        fullWidth: false          — segments hug their content
              (flex: 0 0 auto) and the bar is `inline-flex` so it
              takes only as much width as needed. Use for compact
              single-select rows like yes/no. */
function Segmented({
  options, selected, onSelect, disabled, ariaLabel,
  mode = 'single', fullWidth = true,
}) {
  const isMulti = mode === 'multi'
  const selectedArr = isMulti && Array.isArray(selected) ? selected : null
  const isSel = (v) => isMulti
    ? (selectedArr ? selectedArr.includes(v) : false)
    /* Strict equality on single-mode — supports value:false correctly. */
    : v === selected
  return (
    <div
      role={isMulti ? 'group' : 'radiogroup'}
      aria-label={ariaLabel}
      style={{
        display:      fullWidth ? 'flex' : 'inline-flex',
        direction:    'rtl',
        width:        fullWidth ? '100%' : 'auto',
        background:   '#ffffff',
        border:       `1px solid ${INPUT_BORDER}`,
        borderRadius: 20,
        overflow:     'hidden',
        boxSizing:    'border-box',
        verticalAlign:'top',
      }}
    >
      {options.map((opt, i) => {
        const sel = isSel(opt.value)
        return (
          <button
            key={String(opt.value)}
            type="button"
            role={isMulti ? 'button' : 'radio'}
            aria-checked={isMulti ? undefined : sel}
            aria-pressed={isMulti ? sel : undefined}
            onClick={() => !disabled && onSelect(opt.value)}
            disabled={disabled}
            style={{
              flex:        fullWidth ? '1 1 0' : '0 0 auto',
              minWidth:    0,
              /* Padding trimmed 6/12 → 5/6 and font 12.5 → 11.5 so
                 4-way floor labels with counts like "קומה א' (13)"
                 fit without clipping on narrow mobile viewports. */
              padding:     '5px 6px',
              background:  sel ? INPUT_BG_SEL : '#ffffff',
              color:       sel ? '#ffffff'   : INPUT_TEXT,
              border:      'none',
              /* Under direction:rtl, border-right paints the inner
                 physical-right edge — i.e. the separator between the
                 segment at DOM-index i and the previous one at
                 visual-right. Skip on the first DOM segment (which
                 sits flush against the container's right edge). */
              borderRight: i > 0 ? `1px solid ${INPUT_BORDER}` : 'none',
              cursor:      disabled ? 'not-allowed' : 'pointer',
              opacity:     disabled ? 0.65 : 1,
              fontFamily:  'inherit',
              fontSize:    11.5,
              lineHeight:  1.2,
              textAlign:   'center',
              boxSizing:   'border-box',
              transition:  'background 0.12s, color 0.12s',
              whiteSpace:  'nowrap',
              overflow:    'hidden',
              textOverflow:'ellipsis',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── MultiToggle — standalone bordered chip for multi-select.
      Visually matches ONE segment cell / the "אחר" size input: same
      #d9d6cd border, 20px pill radius, 6×12 padding, 12.5px label,
      sage fill when selected. But each button carries its OWN full
      border and renders as a separate element — no shared container,
      no inner dividers — with a small gap between siblings signalling
      "pick any number" (vs. the joined segmented bar which signals
      "pick exactly one"). Used for floor-heating and any future
      multi-choice group. */
function MultiToggle({ selected, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick && onClick()}
      disabled={disabled}
      aria-pressed={!!selected}
      style={{
        background:   selected ? INPUT_BG_SEL : '#ffffff',
        color:        selected ? '#ffffff'   : INPUT_TEXT,
        border:       `1px solid ${selected ? INPUT_BD_SEL : INPUT_BORDER}`,
        borderRadius: 20,
        padding:      '6px 12px',
        fontFamily:   'inherit',
        fontSize:     12.5,
        lineHeight:   1.2,
        cursor:       disabled ? 'not-allowed' : 'pointer',
        opacity:      disabled ? 0.65 : 1,
        whiteSpace:   'nowrap',
        transition:   'background 0.12s, color 0.12s',
      }}
    >
      {label}
    </button>
  )
}

/* ── ToggleRow — full-width checkbox row for on/off floor + yard
      toggles. 8px radius + #d9d6cd border for consistency with
      Multi-Toggle and TextInput. Sage-light background when checked
      to provide visual selection feedback. */
function ToggleRow({ label, checked, onToggle, disabled, hint }) {
  return (
    <label
      style={{
        display:      'flex',
        alignItems:   'center',
        gap:          8,
        padding:      '8px 10px',
        background:   checked ? SAGE_LITE : '#ffffff',
        border:       `1px solid ${checked ? SAGE : INPUT_BORDER}`,
        borderRadius: 8,
        cursor:       disabled ? 'default' : 'pointer',
        opacity:      disabled ? 0.75 : 1,
        userSelect:   'none',
        direction:    'rtl',
      }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        onChange={onToggle}
        disabled={disabled}
        style={{ margin: 0, cursor: disabled ? 'default' : 'pointer', accentColor: SAGE_DARK }}
      />
      <span style={{ fontSize: 14, color: CHARCOAL, flex: 1 }}>
        {label}
      </span>
      {hint && (
        <span style={{ fontSize: 11.5, color: MUTED }}>
          {hint}
        </span>
      )}
    </label>
  )
}

/* ── TextInput — rounded-rectangle text field with V1's .hb-input
      styling verbatim: 8px radius, #d9d6cd border, 14px font, white
      surface, charcoal text, RTL alignment. Placeholder color left
      to browser default (soft muted gray, matches V1). */
function TextInput({
  value, onChange, placeholder, readOnly, inputMode, ariaLabel, style,
  type = 'text', min,
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange && onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      inputMode={inputMode}
      min={min}
      aria-label={ariaLabel}
      dir="rtl"
      style={{
        padding:      '8px 10px',
        border:       `1px solid ${INPUT_BORDER}`,
        borderRadius: 8,
        fontFamily:   'inherit',
        fontSize:     14,
        outline:      'none',
        background:   '#ffffff',
        color:        CHARCOAL,
        textAlign:    'right',
        boxSizing:    'border-box',
        ...style,
      }}
    />
  )
}

/* Shared base style for every "room button" surface — palette adds,
   current-room chips, mini-house floor chips. Fixed width + height,
   single-line ellipsis, moderate radius, #d9d6cd border. Sage-filled
   variant reserved for "selected/active" state; base variant is
   white with the neutral border. Keeps the three call sites truly
   uniform — a change here propagates everywhere. */
function roomButtonStyle({ selected = false, disabled = false } = {}) {
  return {
    boxSizing:      'border-box',
    /* Width flexes to fill the grid cell so a 3-column grid
       produces three equal-width buttons regardless of label
       length. Height stays fixed so rows are visually consistent. */
    width:          '100%',
    minWidth:       0,
    height:         ROOM_BTN.HEIGHT,
    /* Horizontal padding trimmed to 4px on each side (was 8px via
       ROOM_BTN.PADDING) so the room name gets ~8px more room to fit
       before SmartText has to abbreviate. Inner flex gap trimmed
       from 4 → 2 for the same reason. Text-fit priority beats
       whitespace here. */
    padding:        '0 4px',
    borderRadius:   ROOM_BTN.RADIUS,
    border:         `1px solid ${selected ? SAGE : INPUT_BORDER}`,
    background:     selected ? SAGE : '#ffffff',
    color:          selected ? '#ffffff' : INPUT_TEXT,
    fontFamily:     'inherit',
    fontSize:       ROOM_BTN.FONT,
    lineHeight:     1,
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            2,
    cursor:         disabled ? 'not-allowed' : 'pointer',
    opacity:        disabled ? 0.6 : 1,
    flexShrink:     0,
    transition:     'background 0.12s, border-color 0.12s, color 0.12s',
    direction:      'rtl',
    textAlign:      'center',
  }
}

/* Hebrew display-only abbreviation for room labels — used ONLY when a
   full label would overflow its button/chip. Rules:
     · leading "חדר "    → "ח. "   (e.g. "חדר ילדים"    → "ח. ילדים")
     · leading "פינת "   → "פ. "   (e.g. "פינת קפה"     → "פ. קפה")
     · leading "פינה "   → "פ. "
     · leading "שירותי " → "ש. "   (e.g. "שירותי אורחים" → "ש. אורחים")
     · leading "שירות "  → "ש. "
   Only touches the LEADING word — mid-string matches are left alone.
   Every rule requires a trailing space, which acts as a word
   boundary — so "שירותי" and "שירות" don't collide with each other.
   Never mutates the source data: the full label is still what's
   stored in answers.house.rooms and what SmartText reports via the
   `title` tooltip; this is purely display fallback for tight boxes. */
function abbreviate(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(/^חדר /, 'ח. ')
    .replace(/^פינת /, 'פ. ')
    .replace(/^פינה /, 'פ. ')
    .replace(/^שירותי /, 'ש. ')
    .replace(/^שירות /, 'ש. ')
}

/* SmartText — renders `text` and, when it would overflow its own
   container, swaps to the abbreviated form. Approach:
     · An always-mounted, position:absolute, visibility:hidden sibling
       carries the FULL text at the same font — its scrollWidth is the
       intrinsic width the full text needs.
     · The visible span's clientWidth is the room actually available
       (bounded by the parent flex/inline-flex layout).
     · If intrinsic > available, show `abbreviate(text)` instead of
       `text`.
     · A ResizeObserver re-runs the check when the container width
       changes (e.g. yard toggled on/off in step 1 narrows the mini-
       house columns).
     · CSS text-overflow: ellipsis stays on as a safety net for the
       extreme case where even the abbreviated form doesn't fit.
   `title={text}` on the outer span preserves the full name on hover
   so nothing is lost regardless of display state. */
function SmartText({ text, color, style }) {
  const contRef = useRef(null)
  const measRef = useRef(null)
  const [abbrev, setAbbrev] = useState(false)
  useLayoutEffect(() => {
    const cont = contRef.current
    const meas = measRef.current
    if (!cont || !meas) return
    const check = () => {
      const need = meas.scrollWidth
      const have = cont.clientWidth
      /* Small slack so we don't oscillate on a 1px edge case, and
         only ABBREVIATE when the full text is measurably wider than
         the available box. If abbreviating still doesn't fit, the
         CSS ellipsis on the outer span kicks in as fallback. */
      setAbbrev(need > have + 1)
    }
    check()
    const obs = new ResizeObserver(check)
    obs.observe(cont)
    return () => obs.disconnect()
  }, [text])
  const shown = abbrev ? abbreviate(text) : text
  return (
    <span
      ref={contRef}
      title={text}
      style={{
        display:      'inline-block',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap',
        minWidth:     0,
        position:     'relative',   // anchor for the hidden measurer
        color,
        ...style,
      }}
    >
      {shown}
      <span
        ref={measRef}
        aria-hidden="true"
        style={{
          position:      'absolute',
          visibility:    'hidden',
          whiteSpace:    'nowrap',
          pointerEvents: 'none',
          left:          0,
          top:           0,
        }}
      >
        {text}
      </span>
    </span>
  )
}

/* Room-button label span — inline, single-line, dynamically
   abbreviates via SmartText when the full text would overflow the
   fixed-width button. Kept as its own helper so every "room label"
   call site inherits the same overflow/abbreviate behaviour. */
function RoomBtnLabel({ children, color }) {
  const text = typeof children === 'string' ? children : String(children ?? '')
  return (
    <SmartText
      text={text}
      color={color}
      style={{ flex: '1 1 auto' }}
    />
  )
}

/* ── MiniTrashButton — the per-room delete affordance rendered inside
      the MiniHouse schematic, on both MiniChip (regular rooms) and
      MiniContainerLine (units). Shared so the two can't drift.

      · <span role="button">, NOT <button>: these render INSIDE the
        FloorBox <button>, and a button inside a button is invalid
        HTML. Same workaround the yard's collapse chevron already uses.
      · stopPropagation on click AND on the Enter/Space keydown, so
        hitting the bin never also fires FloorBox's onSelect (which
        would switch the active floor out from under the user).
      · Deliberately subtle — the chips are tiny. Muted by default,
        DANGER red on hover/focus so intent is obvious before the
        click lands.
      · RTL: rendered as the LAST flex child so it sits at the visual
        LEFT edge of the chip — the end of the reading flow, mirroring
        where RoomChip's × and the yard chevron already sit. As a flex
        sibling (not absolutely positioned) it reserves its own space,
        so it can never overlap the room's name/number label. */
function MiniTrashButton({ onRemove, label }) {
  const [hover, setHover] = useState(false)
  const activate = () => { if (typeof onRemove === 'function') onRemove() }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); activate() }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation(); activate()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        flexShrink:     0,
        width:          12,
        height:         12,
        marginInlineStart: 2,
        color:          hover ? DANGER : MUTED,
        opacity:        hover ? 1 : 0.75,
        cursor:         'pointer',
        lineHeight:     1,
        transition:     'color 0.12s, opacity 0.12s',
      }}
    >
      <IconTrash size={10} />
    </span>
  )
}

/* MiniContainerLine — a container inside the schematic's floor box.
   Unlike a regular room (a small MiniChip in one grid cell), a
   container spans the FULL width of the floor's chip grid and states
   its contents inline:

     "יחידת סוויטה: ח. שינה, ח. רחצה, ח. ארונות"

   · Children are abbreviated with the SAME rules used elsewhere in
     this component (abbreviate(): חדר→ח., פינה/פינת→פ., שירותי/
     שירות→ש.) so the strip stays short.
   · A childless container renders as just its label — no colon.
   · COMPACT (yard accordion expanded → the drawing is squeezed):
     label only, no colon, no children. Driven off the existing
     yardExpanded state — no width measurement, no ResizeObserver.
   · Whatever still overflows is clipped with ellipsis; the `title`
     always carries the FULL, UNABBREVIATED line.
   Same chip vocabulary as MiniChip — just wider. No new colors. */
function MiniContainerLine({ room, roomLabel, compact, onRemove }) {
  const kids      = room.children || []
  const parentLbl = roomLabel(room)
  const fullKids  = kids.map(c => roomLabel(c))
  const shortKids = fullKids.map(t => abbreviate(t))

  const shown =
    compact || fullKids.length === 0
      ? parentLbl
      : `${parentLbl}: ${shortKids.join(', ')}`
  /* Tooltip always shows the complete, unabbreviated truth — even
     in compact mode, where the children aren't rendered at all. */
  const full =
    fullKids.length === 0
      ? parentLbl
      : `${parentLbl}: ${fullKids.join(', ')}`

  return (
    <span
      title={full}
      style={{
        gridColumn:   '1 / -1',
        /* flex (was block) so the trash sits as a proper sibling at the
           visual-LEFT edge while the label text takes the rest. */
        display:      'flex',
        alignItems:   'center',
        width:        '100%',
        background:   '#ffffff',
        border:       `1px solid ${INPUT_BORDER}`,
        borderRadius: 6,
        padding:      '1px 6px',
        fontSize:     11,
        lineHeight:   1.4,
        color:        CHARCOAL,
        minWidth:     0,
        boxSizing:    'border-box',
        overflow:     'hidden',
      }}
    >
      <span style={{
        flex:         1,
        minWidth:     0,
        whiteSpace:   'nowrap',
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        textAlign:    'right',   /* RTL: reads from the visual RIGHT */
      }}>
        {shown}
      </span>
      {onRemove && (
        <MiniTrashButton onRemove={onRemove} label={`הסר ${parentLbl}`} />
      )}
    </span>
  )
}

/* MiniChip — the SMALL compact chip used ONLY inside the sticky
   mini-house schematic (per-floor room labels). Reverts the
   pre-uniform sizing: tiny font, 1×6 padding, radius 6, sage border,
   text uses SmartText so long names abbreviate before ellipsizing.
   The larger uniform ROOM_BTN size is reserved for the palette
   "add room" buttons and the current-rooms chips below the sketch. */
function MiniChip({ text, onRemove }) {
  return (
    <span
      title={text}
      style={{
        /* Fill the grid cell (was inline-flex sized to content).
           `display: flex` makes it a block-level flex box that grabs
           the full 1fr column allocated by the parent 3-col grid,
           so the row always shows exactly 3 evenly-sized chips. */
        display:      'flex',
        alignItems:   'center',
        justifyContent:'center',
        width:        '100%',
        background:   '#ffffff',
        border:       `1px solid ${INPUT_BORDER}`,
        borderRadius: 6,
        padding:      '1px 6px',
        fontSize:     11,
        lineHeight:   1.4,
        color:        CHARCOAL,
        minWidth:     0,
        boxSizing:    'border-box',
        whiteSpace:   'nowrap',
        overflow:     'hidden',
      }}
    >
      <SmartText
        text={text}
        color={CHARCOAL}
        /* flex:1 + minWidth:0 (was width:100%) so the label yields
           space to the trash sibling instead of pushing it out of the
           chip. Without the trash it behaves exactly as before. */
        style={{ flex: 1, minWidth: 0, textAlign: 'center' }}
      />
      {onRemove && (
        <MiniTrashButton onRemove={onRemove} label={`הסר ${text}`} />
      )}
    </span>
  )
}

/* ── PaletteButton — one entry in the "add rooms" palette. Not a
      toggle: each click ADDS one more room of this type. Optional
      count badge shows how many of this type live on the active
      floor. Uses the shared uniform ROOM_BTN size (fixed width +
      height + ellipsis) so the palette grid stays tidy regardless of
      label length. */
function PaletteButton({ label, count, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick && onClick()}
      disabled={disabled}
      style={roomButtonStyle({ selected: false, disabled })}
      title={label}
    >
      <span
        aria-hidden="true"
        style={{
          color:      SAGE_DARK,
          fontWeight: 700,
          fontSize:   13,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ＋
      </span>
      <RoomBtnLabel color={INPUT_TEXT}>{label}</RoomBtnLabel>
      {count > 0 && (
        <span style={{
          background:   SAGE_LITE,
          color:        SAGE_DARK,
          borderRadius: 999,
          /* Tightened from '1px 6px' → '0 4px' to give the room
             name another ~4px of horizontal room. Still readable —
             the pill is small (2-digit counts fit comfortably). */
          padding:      '0 4px',
          fontSize:     10.5,
          fontWeight:   700,
          lineHeight:   1.3,
          flexShrink:   0,
        }}>
          {count}
        </span>
      )}
    </button>
  )
}

/* ── RoomChip — one room in the "current rooms on this floor" list.
      Same uniform width + height as PaletteButton. Sage-filled by
      default (signals "already exists"); containers render neutral
      with a small "יחידה" tag; a × remove button sits at the visual-
      LEFT edge (fixed size — doesn't grow the button). */
function RoomChip({ label, isContainer, disabled, onRemove, blockedReason }) {
  const selected = !isContainer
  return (
    <span
      style={roomButtonStyle({ selected, disabled })}
      /* When removal is blocked by the required-type rule, surface
         WHY on hover instead of the plain room name. */
      title={blockedReason || label}
    >
      <RoomBtnLabel color={selected ? '#ffffff' : CHARCOAL}>{label}</RoomBtnLabel>
      {isContainer ? (
        <span style={{
          fontSize:   10,
          color:      MUTED,
          flexShrink: 0,
        }}>
          יחידה
        </span>
      ) : onRemove ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          disabled={disabled}
          aria-label={blockedReason || `הסר ${label}`}
          title={blockedReason || `הסר ${label}`}
          style={{
            background:   'transparent',
            border:       'none',
            padding:      0,
            /* Shrunk from 18×18 → 14×14 to give the room name
               ~4px more horizontal room. Still tap-friendly given
               the surrounding chip padding. */
            width:        14,
            height:       14,
            borderRadius: 999,
            display:      'inline-flex',
            alignItems:   'center',
            justifyContent:'center',
            color:        '#ffffff',
            cursor:       disabled ? 'not-allowed' : 'pointer',
            opacity:      disabled ? 0.55 : 1,
            lineHeight:   1,
            flexShrink:   0,
          }}
        >
          {/* Same IconTrash the schematic's room boxes use, so every
              delete control in the builder reads as one family. Colour
              stays white (inherited above) rather than the schematic's
              muted/DANGER pair — this chip sits on a SAGE fill, where
              grey or red would all but vanish. */}
          <IconTrash size={11} />
        </button>
      ) : null}
    </span>
  )
}

/* ── SizeRadio — one option of step 3's classic size radio group.
      RTL: the circle is the FIRST DOM child, so it paints to the
      visual RIGHT of its label. Selected = circle filled with the
      same sage used by the selected segment elsewhere; unselected =
      empty circle with the standard INPUT_BORDER. Deliberately
      compact — it reads as a small inline control, not a block. */
function SizeRadio({ label, selected, disabled, onSelect }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={!!selected}
      onClick={() => { if (!disabled) onSelect() }}
      disabled={disabled}
      style={{
        display:     'inline-flex',
        alignItems:  'center',
        gap:         6,
        background:  'none',
        border:      'none',
        padding:     '2px 0',
        margin:      0,
        fontFamily:  'inherit',
        fontSize:    13,
        color:       CHARCOAL,
        cursor:      disabled ? 'not-allowed' : 'pointer',
        opacity:     disabled ? 0.6 : 1,
        direction:   'rtl',
        lineHeight:  1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink:     0,
          width:          16,
          height:         16,
          borderRadius:   999,
          boxSizing:      'border-box',
          border:         `1px solid ${selected ? SAGE : INPUT_BORDER}`,
          background:     '#ffffff',
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          transition:     'border-color 0.12s',
        }}
      >
        {selected && (
          <span style={{
            width:        8,
            height:       8,
            borderRadius: 999,
            background:   SAGE,
          }} />
        )}
      </span>
      <span>{label}</span>
    </button>
  )
}

/* ── PropChip — one characteristic in step 3's flat "מאפיינים" grid.
      Every chip is an independent toggle (there is no single-select
      behaviour on this screen), so it carries no radio semantics —
      aria-pressed, not aria-checked.

      Reuses the file's existing chip vocabulary: selected = filled
      sage with white text, unselected = white with the standard
      INPUT_BORDER. Width comes from the parent 3-column grid; the
      label WRAPS inside the chip rather than forcing a column to
      grow, so the 3-per-row rhythm holds for long Hebrew labels.

      `onRemove` turns the chip into a custom ("מאפיין אחר") entry:
      always selected, with a × that DELETES it instead of toggling. */
function PropChip({ label, selected, disabled, onClick, onRemove }) {
  const interactive = !disabled && (onClick || onRemove)
  return (
    <span
      style={{
        boxSizing:      'border-box',
        width:          '100%',
        minWidth:       0,
        minHeight:      ROOM_BTN.HEIGHT,
        padding:        '5px 8px',
        borderRadius:   ROOM_BTN.RADIUS,
        border:         `1px solid ${selected ? SAGE : INPUT_BORDER}`,
        background:     selected ? SAGE : '#ffffff',
        color:          selected ? '#ffffff' : INPUT_TEXT,
        fontFamily:     'inherit',
        fontSize:       12,
        lineHeight:     1.3,
        display:        'inline-flex',
        alignItems:     'center',
        justifyContent: 'center',
        gap:            4,
        textAlign:      'center',
        direction:      'rtl',
        cursor:         interactive ? 'pointer' : 'default',
        opacity:        disabled ? 0.6 : 1,
        transition:     'background 0.12s, border-color 0.12s, color 0.12s',
        /* Long labels wrap inside the chip instead of widening it. */
        overflowWrap:   'anywhere',
      }}
      role={onClick ? 'button' : undefined}
      aria-pressed={onClick ? !!selected : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      onClick={() => { if (!disabled && onClick) onClick() }}
      onKeyDown={(e) => {
        if (!onClick || disabled) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() }
      }}
      title={label}
    >
      <span style={{ minWidth: 0 }}>{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          aria-label={`הסר ${label}`}
          title={`הסר ${label}`}
          style={{
            background:     'transparent',
            border:         'none',
            padding:        0,
            width:          14,
            height:         14,
            borderRadius:   999,
            display:        'inline-flex',
            alignItems:     'center',
            justifyContent: 'center',
            color:          '#ffffff',
            cursor:         'pointer',
            fontSize:       13,
            lineHeight:     1,
            flexShrink:     0,
          }}
        >
          ×
        </button>
      )}
    </span>
  )
}

/* ── ContainerGroup — a container ("חלל-על") rendered inline in the
      floor's room list as an ALWAYS-EXPANDED bordered group. There is
      deliberately no "enter the unit" navigation mode: header, its
      children, and a scoped add-child control all sit on the floor.

      Spans the full width of the parent 3-column grid so it reads as
      a box holding chips rather than as another chip.

      RECURSIVE — the one allowed nesting case (יחידת סוויטה inside
      יחידת דיור) means a child can itself be a container. When it is,
      this renders ANOTHER ContainerGroup for it (same visual style,
      one level deeper) instead of a flat RoomChip. `parentContainerId`
      is null for the top-level render and the OWNING container's id
      for a nested one, so this single component's own remove/add/
      confirm handlers stay correctly scoped at every depth without
      each level needing its own pre-curried callbacks. childPaletteFor
      / confirmRemoveUnit are shared single-value state (only one
      container's palette, or one pending remove-confirm, can be open
      anywhere at a time) — the same design childPaletteFor already
      used before nesting existed.

      RTL note: the header is a flex row whose FIRST child (the unit
      label) paints on the visual RIGHT, and `marginInlineStart:auto`
      pushes the remove control to the visual LEFT edge. */
function ContainerGroup({
  room, parentContainerId, floorKey,
  roomLabel, isContainerType, getChildTypes, displayType,
  canRemoveChild,
  childPaletteFor, onTogglePalette,
  onAddChild, onRemoveChild,
  onRequestRemoveUnit,
  confirmRemoveUnit, onConfirmRemoveUnit, onCancelRemoveUnit,
  disabled,
}) {
  const kids = room.children || []
  const label = roomLabel(room)
  const childTypes = getChildTypes(room.type)
  const paletteOpen = childPaletteFor === room.id
  const confirming = !!confirmRemoveUnit && confirmRemoveUnit.roomId === room.id
  return (
    <div style={{
      gridColumn:   '1 / -1',
      boxSizing:    'border-box',
      background:   'rgba(122,148,120,0.05)',
      border:       `1px solid ${SAGE}`,
      borderRadius: ROOM_BTN.RADIUS,
      padding:      '8px 10px',
      direction:    'rtl',
      display:      'flex',
      flexDirection:'column',
      gap:          8,
    }}>
      {/* Header — unit label at the RTL start, remove at the far end */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize:   12.5,
          fontWeight: 700,
          color:      CHARCOAL,
          minWidth:   0,
          overflow:   'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
        <span style={{ fontSize: 10.5, color: MUTED, flexShrink: 0 }}>
          יחידה · {kids.length}
        </span>
        <button
          type="button"
          onClick={() => onRequestRemoveUnit(floorKey, room, parentContainerId)}
          disabled={disabled}
          aria-label={`הסר ${label}`}
          title={`הסר ${label}`}
          style={{
            marginInlineStart: 'auto',
            background:   'transparent',
            border:       'none',
            padding:      0,
            width:        18,
            height:       18,
            borderRadius: 999,
            display:      'inline-flex',
            alignItems:   'center',
            justifyContent:'center',
            color:        DANGER,
            cursor:       disabled ? 'not-allowed' : 'pointer',
            opacity:      disabled ? 0.55 : 1,
            lineHeight:   1,
            flexShrink:   0,
          }}
        >
          {/* Removing the whole unit — same IconTrash as its children's
              chips and the schematic, kept at the existing DANGER red
              since this is the more destructive of the two (it takes
              the unit's children with it). */}
          <IconTrash size={13} />
        </button>
      </div>

      {/* Inline confirm — a unit with children takes them with it. */}
      {confirming && (
        <div style={{
          display:      'flex',
          alignItems:   'center',
          gap:          8,
          flexWrap:     'wrap',
          background:   '#ffffff',
          border:       `1px solid ${INPUT_BORDER}`,
          borderRadius: 8,
          padding:      '8px 10px',
        }}>
          <span style={{ fontSize: 12, color: CHARCOAL, lineHeight: 1.4 }}>
            להסיר את היחידה ואת {kids.length} החללים שבתוכה?
          </span>
          <button
            type="button"
            onClick={onConfirmRemoveUnit}
            style={{
              marginInlineStart: 'auto',
              background:   '#c94b4b',
              color:        '#ffffff',
              border:       '1px solid #b03e3e',
              borderRadius: 6,
              padding:      '4px 12px',
              fontFamily:   'inherit',
              fontSize:     12,
              fontWeight:   600,
              cursor:       'pointer',
              flexShrink:   0,
            }}
          >
            הסר
          </button>
          <button
            type="button"
            onClick={onCancelRemoveUnit}
            style={{
              background:   '#ffffff',
              color:        CHARCOAL,
              border:       `1px solid ${INPUT_BORDER}`,
              borderRadius: 6,
              padding:      '4px 12px',
              fontFamily:   'inherit',
              fontSize:     12,
              cursor:       'pointer',
              flexShrink:   0,
            }}
          >
            ביטול
          </button>
        </div>
      )}

      {/* Children — same chip family as the floor's regular rooms. */}
      {kids.length === 0 ? (
        <div style={{ fontSize: 11.5, color: MUTED }}>
          היחידה ריקה — הוסיפו חללים.
        </div>
      ) : (
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap:                 8,
        }}>
          {kids.map(child => {
            if (isContainerType(child.type)) {
              /* The one allowed nested case — render another
                 ContainerGroup, scoped to THIS child, one level
                 deeper. Same visual container style; parentContainerId
                 becomes room.id so its own remove/add actions target
                 the right node in the tree. */
              return (
                <ContainerGroup
                  key={child.id}
                  room={child}
                  parentContainerId={room.id}
                  floorKey={floorKey}
                  roomLabel={roomLabel}
                  isContainerType={isContainerType}
                  getChildTypes={getChildTypes}
                  displayType={displayType}
                  canRemoveChild={canRemoveChild}
                  childPaletteFor={childPaletteFor}
                  onTogglePalette={onTogglePalette}
                  onAddChild={onAddChild}
                  onRemoveChild={onRemoveChild}
                  onRequestRemoveUnit={onRequestRemoveUnit}
                  confirmRemoveUnit={confirmRemoveUnit}
                  onConfirmRemoveUnit={onConfirmRemoveUnit}
                  onCancelRemoveUnit={onCancelRemoveUnit}
                  disabled={disabled}
                />
              )
            }
            const removable = canRemoveChild(room, child)
            return (
              <RoomChip
                key={child.id}
                label={roomLabel(child)}
                isContainer={false}
                disabled={disabled || !removable}
                blockedReason={
                  !removable
                    ? 'לא ניתן להסיר — לפחות אחד מסוג זה נדרש ביחידה'
                    : null
                }
                onRemove={() => onRemoveChild(floorKey, room.id, child.id)}
              />
            )
          })}
        </div>
      )}

      {/* Footer — add-child control scoped to THIS container. */}
      {!disabled && (
        <div>
          <button
            type="button"
            onClick={() => onTogglePalette(room.id)}
            style={{
              background:   '#ffffff',
              color:        SAGE_DARK,
              border:       `1px dashed ${SAGE}`,
              borderRadius: 6,
              padding:      '5px 12px',
              fontFamily:   'inherit',
              fontSize:     12,
              fontWeight:   600,
              cursor:       'pointer',
            }}
          >
            {paletteOpen ? '− סגור' : '＋ הוסף חלל ליחידה'}
          </button>
          {paletteOpen && (
            childTypes.length === 0 ? (
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 8 }}>
                אין סוגי חללים זמינים ליחידה זו.
              </div>
            ) : (
              <div style={{
                display:             'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap:                 8,
                marginTop:           8,
              }}>
                {childTypes.map(t => (
                  <PaletteButton
                    key={t}
                    label={displayType(t)}
                    count={kids.filter(c => c.type === t).length}
                    disabled={disabled}
                    onClick={() => onAddChild(floorKey, room.id, t)}
                  />
                ))}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}

/* ── MiniHouse — sticky compact schematic mirroring V1's HouseBuilder
      structure at a reduced scale. Structural principles copied from V1:
        · ROOF floats ABOVE the floors and OUTSIDE any bordered box.
          It's slightly WIDER than the floors column — eaves overhang
          both sides via SVG `overflow: visible` (same trick as V1).
        · YARD is a SEPARATE dashed box beside the ground floor, NOT
          inside the floors column. When present it narrows the
          floors column to make room, then the whole floors stack is
          right-aligned so the yard sits to their visual-LEFT.
        · GROUND LINE runs BELOW the above-ground floors, sits BETWEEN
          them and the basement, and spans the FULL width (covering
          both the floors column AND the yard when yard exists). Small
          gaps above and below give it breathing room so it clearly
          SEPARATES above-ground from below-ground.
        · Each floor is its OWN bordered box (mirrors V1's `.hb-floor`
          per-floor border, not a shared container border). Compact:
          small room chips (~11px), tight padding.
      Sticky positioning keeps the drawing on-screen while the palette
      below scrolls — the UX win vs V1.

      Params:
        activeAreas    — array of area keys currently ON (from step 1)
        activeAreaKey  — which one is being edited (highlighted)
        onSelectArea   — click handler to switch active
        rooms          — the full houseState.rooms map
        roof           — step-1 roof choice ('שטוח' / 'רעפים' / 'משולב' / null)
        roomLabel      — V1-parity room-label function (global numbering)
*/
function MiniHouse({
  activeAreas, activeAreaKey, onSelectArea, rooms, roof, roomLabel,
  isContainerType, onRemoveRoom,
}) {
  const hasFirst    = activeAreas.includes('first')
  const hasGround   = activeAreas.includes('ground')
  const hasBasement = activeAreas.includes('basement')
  const hasYard     = activeAreas.includes('yard')

  /* ── Yard collapse state ──
     The yard is a HORIZONTAL accordion: collapsed it's a thin
     vertical strip; expanded it's the full 42% box. Auto rules:
       · yard becomes the active area  → expand
       · a non-yard area becomes active → collapse
       · a room is added to the yard    → expand (yardRoomCount dep
         re-fires the effect, which also undoes a manual collapse)
     The chevron toggles manually until the next auto trigger. */
  const yardRoomCount = (rooms.yard || []).length
  const [yardOpen, setYardOpen] = useState(activeAreaKey === 'yard')
  useEffect(() => {
    setYardOpen(activeAreaKey === 'yard')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAreaKey, yardRoomCount])

  /* Two-column layout math.
       · yard EXPANDED  → yard takes 42% of the container; the floors
         column gets `calc(58% - 6px)`.
       · yard COLLAPSED → yard shrinks to a fixed thin strip and the
         floors column reclaims everything else, so room chips get as
         wide (and as readable) as possible.
       · no yard at all → floors take the full width.

     42% when expanded is deliberate: the yard renders its chips
     2-per-row (vs the floors' 3), so each yard cell ends up ~21% of
     the container against ~19% for a floor cell — i.e. yard chips are
     slightly WIDER than floor chips, which is what makes their names
     readable instead of collapsing to a single letter. */
  const YARD_PCT           = 42
  const YARD_COLLAPSED_PX  = 38   /* just wide enough for "חצר" */
  const GAP_PX             = 6
  const yardExpanded       = hasYard && yardOpen
  const floorsWidth = !hasYard
    ? '100%'
    : yardExpanded
      ? `calc(${100 - YARD_PCT}% - ${GAP_PX}px)`
      : `calc(100% - ${YARD_COLLAPSED_PX}px - ${GAP_PX}px)`

  /* Style used to right-align the narrow blocks that sit above the
     ground row (first, roof) and below it (ground line when no yard,
     basement). Under `direction: rtl`, `margin-inline-end` maps to
     the physical-left margin — setting it to `auto` pushes the block
     to physical-right, which IS the visual-right side for Hebrew
     reading. This keeps them aligned under the ground floor when
     the yard narrows the floors column. */
  const rightSlot = { width: floorsWidth, marginInlineEnd: 'auto' }

  return (
    <div style={{
      position:   'sticky',
      top:        0,
      zIndex:     2,
      background: CREAM,
      padding:    '4px 2px 6px',
      direction:  'rtl',
    }}>
      {/* ROOF — OUTSIDE the floor boxes, positioned just above the
          floors column, slightly wider via SVG eaves overhang. Small
          `marginBottom` gives it visible separation from the top
          floor so it reads as "sitting on top of" the house. */}
      <div style={{ ...rightSlot, marginBottom: 3 }}>
        <RoofCap roof={roof} />
      </div>

      {/* FIRST floor (if active) — own bordered box, floors width. */}
      {hasFirst && (
        <div style={{ ...rightSlot, marginBottom: 4 }}>
          <FloorBox
            areaKey="first"
            active={activeAreaKey === 'first'}
            onSelect={() => onSelectArea('first')}
            rooms={rooms.first || []}
            roomLabel={roomLabel}
            isContainerType={isContainerType}
            compact={yardExpanded}
            onRemoveRoom={onRemoveRoom}
          />
        </div>
      )}

      {/* GROUND row — flex row with ground floor on visual-right and
          yard on visual-left (when yard is on). Each is its own
          bordered box. If yard is off, the ground floor takes the
          full row width alone. */}
      {hasGround && (
        /* alignItems:'stretch' is already the flex default, but we
           set it explicitly so the ground + yard wrappers are always
           stretched to the taller sibling's height. */
        <div style={{
          display:    'flex',
          direction:  'rtl',
          alignItems: 'stretch',
          gap:        GAP_PX,
          width:      '100%',
        }}>
          {/* Each wrapper is itself a flex column so the button
             inside (with height:100%) actually fills the wrapper's
             flex-stretched height. This is what locks the yard box
             to the ground-floor's height as the ground floor grows
             or shrinks. */}
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex' }}>
            <FloorBox
              areaKey="ground"
              active={activeAreaKey === 'ground'}
              onSelect={() => onSelectArea('ground')}
              rooms={rooms.ground || []}
              roomLabel={roomLabel}
              isContainerType={isContainerType}
              compact={yardExpanded}
              onRemoveRoom={onRemoveRoom}
            />
          </div>
          {hasYard && (
            <div style={{
              flex:     yardExpanded
                ? `0 0 ${YARD_PCT}%`
                : `0 0 ${YARD_COLLAPSED_PX}px`,
              minWidth: 0,
              display:  'flex',
              transition: 'flex-basis 0.18s ease',
            }}>
              {yardExpanded ? (
                <FloorBox
                  areaKey="yard"
                  variant="yard"
                  active={activeAreaKey === 'yard'}
                  onSelect={() => onSelectArea('yard')}
                  rooms={rooms.yard || []}
                  roomLabel={roomLabel}
                  isContainerType={isContainerType}
                  compact={yardExpanded}
                  onRemoveRoom={onRemoveRoom}
                  onToggleCollapse={() => setYardOpen(false)}
                />
              ) : (
                <YardStrip
                  active={activeAreaKey === 'yard'}
                  count={yardRoomCount}
                  onSelect={() => onSelectArea('yard')}
                  onToggleCollapse={() => setYardOpen(true)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* GROUND LINE — sage bar between above-ground and below-ground
          floors. Spans FULL width when yard is on (running under both
          the floors column and the yard); otherwise spans the floors
          column width. Symmetric vertical margins on both sides give
          it breathing room from the neighbouring floor boxes. */}
      <div style={{
        ...(hasYard ? { width: '100%' } : rightSlot),
        height:       2,
        background:   SAGE,
        borderRadius: 2,
        marginTop:    6,
        marginBottom: 6,
      }} />

      {/* BASEMENT — visually BELOW the ground line, floors width,
          right-aligned so it sits directly under the ground floor
          even when the yard has narrowed the column. */}
      {hasBasement && (
        <div style={rightSlot}>
          <FloorBox
            areaKey="basement"
            active={activeAreaKey === 'basement'}
            onSelect={() => onSelectArea('basement')}
            rooms={rooms.basement || []}
            roomLabel={roomLabel}
            isContainerType={isContainerType}
            compact={yardExpanded}
            onRemoveRoom={onRemoveRoom}
          />
        </div>
      )}
    </div>
  )
}

/* Roof cap — simplified SVG matching V1's 3 roof shapes, scaled
   down for the mini-house. Lines extend past the SVG's viewport
   (viewBox coordinates outside 0..200) and `overflow: visible` on
   the element — same eaves-overhang trick V1 uses to draw a roof
   that's visually wider than the house body below it. */
function RoofCap({ roof }) {
  return (
    <svg
      viewBox="0 0 200 22"
      preserveAspectRatio="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{
        display:  'block',
        width:    '100%',
        height:   20,
        overflow: 'visible',
      }}
    >
      {roof === 'שטוח' && (
        <line x1="-10" y1="14" x2="210" y2="14"
          stroke={SAGE} strokeWidth="3" vectorEffect="non-scaling-stroke"
          strokeLinecap="round" />
      )}
      {roof === 'רעפים' && (
        <polyline points="-10,20 100,3 210,20"
          fill="none" stroke={SAGE} strokeWidth="2" vectorEffect="non-scaling-stroke"
          strokeLinecap="round" strokeLinejoin="round" />
      )}
      {roof === 'משולב' && (
        <polyline points="210,20 100,3 100,20 -10,20"
          fill="none" stroke={SAGE} strokeWidth="2" vectorEffect="non-scaling-stroke"
          strokeLinecap="round" strokeLinejoin="round" />
      )}
      {!roof && (
        <line x1="-10" y1="18" x2="210" y2="18"
          stroke={INPUT_BORDER} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  )
}

/* YardStrip — the COLLAPSED yard: a thin vertical strip sized to
   fit just the word "חצר". Its three elements are stacked one per
   row (label / count / chevron) specifically to keep the strip as
   narrow as possible; laying them out side-by-side would widen it
   and eat the space the floors just reclaimed. No room chips are
   rendered while collapsed.

   Tapping the strip selects the yard (which auto-expands it via
   MiniHouse's effect); tapping just the chevron expands without
   changing the active area. The chevron is a span[role=button]
   rather than a nested <button> — a button inside a button is
   invalid HTML. */
function YardStrip({ active, count, onSelect, onToggleCollapse }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={false}
      aria-label={`חצר — ${count} חללים. הקישו להרחבה`}
      title="חצר — הקישו להרחבה"
      style={{
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'flex-start',
        gap:            3,
        width:          '100%',
        height:         '100%',
        background:     active ? SAGE_LITE : 'rgba(122,148,120,0.05)',
        border:         `1px dashed ${SAGE}`,
        borderRadius:   8,
        padding:        '6px 2px',
        cursor:         'pointer',
        direction:      'rtl',
        overflow:       'hidden',
        transition:     'background 0.12s',
      }}
    >
      <span style={{
        fontSize:   11,
        fontWeight: 600,
        color:      active ? SAGE_DARK : MUTED,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
      }}>
        חצר
      </span>
      <span style={{
        fontSize:   10.5,
        color:      MUTED,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
      }}>
        ({count})
      </span>
      <span
        role="button"
        tabIndex={0}
        aria-label="הרחיבו את החצר"
        title="הרחיבו את החצר"
        onClick={(e) => { e.stopPropagation(); onToggleCollapse() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault(); e.stopPropagation(); onToggleCollapse()
          }
        }}
        style={{
          display:        'inline-flex',
          alignItems:     'center',
          justifyContent: 'center',
          color:          SAGE_DARK,
          cursor:         'pointer',
          /* Sideways chevron — signals the box opens horizontally. */
          transform:      'rotate(-90deg)',
          lineHeight:     1,
        }}
      >
        <IconChevron size={12} />
      </span>
    </button>
  )
}

/* Single floor box inside MiniHouse — clickable to activate, shows
   the floor label + inline room chips. Each box has its OWN border
   (mirrors V1's per-floor `.hb-floor` style — no shared borders with
   siblings). The `yard` variant uses a dashed sage border to signal
   "outside the house". Active state = sage-tinted background.
   `onToggleCollapse` (yard only) renders a chevron in the header
   that folds the box back into its thin strip. */
function FloorBox({
  areaKey, active, onSelect, rooms, roomLabel, variant, onToggleCollapse,
  isContainerType, compact = false, onRemoveRoom,
}) {
  const isYard = variant === 'yard'
  /* Chip columns per box. The yard is a narrow side box, so 3 chips
     across squeezed each name down to a single letter — it gets 2
     columns (paired with a wider yard box in MiniHouse) so labels
     stay readable. The floors keep the 3-per-row rule. */
  const cols = isYard ? 2 : 3
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      style={{
        /* Flex COLUMN (not block): a native <button> vertically
           centers its content, which pushed the label to the middle
           of the yard box once `height: 100%` stretched it to the
           ground floor's height. Anchoring with flex-start keeps the
           label pinned at the TOP, matching the floor boxes. */
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'stretch',
        justifyContent: 'flex-start',
        width:        '100%',
        /* Fill the wrapper's height. Ground row is a flex row with
           default align-items:stretch, so both the ground-floor
           wrapper and the yard wrapper are stretched to the taller
           sibling's height. `height: 100%` here makes the actual
           dashed/solid box match that stretched height — so as the
           ground floor grows with more rooms, the yard box grows
           in lock-step and their bottoms/tops stay aligned. */
        height:       '100%',
        background:   active
          ? SAGE_LITE
          : (isYard ? 'rgba(122,148,120,0.05)' : '#ffffff'),
        border:       `1px ${isYard ? 'dashed' : 'solid'} ${isYard ? SAGE : INPUT_BORDER}`,
        borderRadius: 8,
        cursor:       'pointer',
        padding:      '6px 8px',
        direction:    'rtl',
        textAlign:    'right',
        transition:   'background 0.12s',
      }}
    >
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <span style={{
          fontSize:      11,
          fontWeight:    600,
          color:         active ? SAGE_DARK : MUTED,
          letterSpacing: '0.02em',
          flexShrink:    0,
        }}>
          {areaKeyLabel(areaKey)}
        </span>
        {rooms.length > 0 && (
          <span style={{
            fontSize:   10.5,
            color:      MUTED,
            flexShrink: 0,
          }}>
            · {rooms.length}
          </span>
        )}
        {/* Collapse chevron (yard only) — pushed to the visual-LEFT
            edge of the header row. span[role=button] because this
            sits inside the FloorBox <button>. */}
        {onToggleCollapse && (
          <span
            role="button"
            tabIndex={0}
            aria-label="כווצו את החצר"
            title="כווצו את החצר"
            onClick={(e) => { e.stopPropagation(); onToggleCollapse() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault(); e.stopPropagation(); onToggleCollapse()
              }
            }}
            style={{
              marginInlineStart: 'auto',
              display:           'inline-flex',
              alignItems:        'center',
              justifyContent:    'center',
              color:             SAGE_DARK,
              cursor:            'pointer',
              flexShrink:        0,
              transform:         'rotate(90deg)',
              lineHeight:        1,
            }}
          >
            <IconChevron size={12} />
          </span>
        )}
      </div>
      {rooms.length > 0 && (
        <div style={{
          display:             'grid',
          /* Floors use the 3-per-row rule; the yard uses 2 (see
             `cols` above) because it's a narrow side box. MiniChip's
             SmartText still abbreviates any label that doesn't fit
             its cell. */
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap:                 ROOM_BTN.GAP,
          marginTop:           4,
        }}>
          {rooms.map(r => (
            /* Containers get a full-width strip listing their
               children inline; regular rooms stay small chips.

               MiniChip — deliberately SMALL. The uniform ROOM_BTN
               size is for the palette + current-rooms chips beneath
               the sketch; inside the sketch we keep the tiny compact
               look (pre-uniform styling). MiniChip's SmartText
               abbreviates long labels ("חדר ילדים" → "ח. ילדים",
               "פינת קפה" → "פ. קפה") only when the full label
               would overflow the chip's width. */
            (isContainerType && isContainerType(r.type)) ? (
              <MiniContainerLine
                key={r.id}
                room={r}
                roomLabel={roomLabel}
                compact={compact}
                onRemove={onRemoveRoom ? () => onRemoveRoom(areaKey, r) : undefined}
              />
            ) : (
              <MiniChip
                key={r.id}
                text={roomLabel(r)}
                onRemove={onRemoveRoom ? () => onRemoveRoom(areaKey, r) : undefined}
              />
            )
          ))}
        </div>
      )}
    </button>
  )
}

/* hasCharacterization — is this room actually characterized?
   Derived PURELY from the saved room object (answers.house.rooms),
   so the answer survives a page reload — unlike the old ephemeral
   `characterizedIds` Set, which was rebuilt per-mount and lost its
   meaning because houseFromJSON re-issues room ids on hydration.

   A room counts as characterized when it has at least one PROPERTY
   chosen — under the array shape that means:
     · any props group array holds at least one entry
     · or any non-empty freeProps entry
   The SIZE deliberately does not count: every room is created with
   an enforced default sizeKey, so counting it would mark every room
   as characterized the moment it's added. */
function hasCharacterization(room) {
  if (!room) return false
  const p = room.props || {}
  for (const k of Object.keys(p)) {
    const v = p[k]
    if (Array.isArray(v) && v.some(x => typeof x === 'string' && x.trim() !== '')) {
      return true
    }
  }
  return Array.isArray(room.freeProps)
    && room.freeProps.some(x => typeof x === 'string' && x.trim() !== '')
}

/* roomDisplayName — the ONE naming scheme for a queue item. A room
   inside a container is prefixed with its unit ("יחידת סוויטה -
   חדר רחצה"); a top-level room is just its own label. Shared by the
   step-3 card heading and the room picker so the two can never
   disagree. */
function roomDisplayName(room, container, roomLabel) {
  if (!room) return ''
  return container
    ? `${roomLabel(container)} - ${roomLabel(room)}`
    : roomLabel(room)
}

/* roomSizeLabel — the room's size as the size selector displays it
   (קטן / בינוני / גדול), or null when there is none to show. A
   fixed-area type has no size selector, so it has no size label —
   the summary renders such a room without parentheses. */
function roomSizeLabel(room, config) {
  if (!room) return null
  const isFixed = !!(config && config.hasFixedArea && config.hasFixedArea(room.type))
  if (isFixed) return null
  return SIZE_LABELS_MAP[room.sizeKey] || null
}

/* roomCharacteristics — flattens one room's stored answers into an
   ordered list of human-readable labels, for the step-3 summary:
     · props   → walks the SAME config groups the editor renders, in
                 config group order and within each group its option
                 order, so the line matches what the user saw. Each
                 group holds an ARRAY of selected labels; every one
                 of them is listed.
     · freeProps → the user's own "מאפיין אחר" entries, appended last.
   The SIZE is deliberately NOT included — the summary shows it in
   parentheses on the name line instead (see roomSizeLabel).
   Read-only derivation — never mutates the room. */
function roomCharacteristics(room, config) {
  if (!room) return []
  const out = []

  const propsDef = (config && config.ROOM_PROPS && config.ROOM_PROPS[room.type]) || DEFAULT_PROPS
  const p = room.props || {}
  propsDef.forEach((group, gi) => {
    const sel = p[propGroupKey(gi)]
    if (!Array.isArray(sel) || sel.length === 0) return
    /* Emit in the group's own option order (not selection order) so
       the summary line reads consistently between rooms. */
    ;(group.opts || []).forEach(opt => {
      if (sel.includes(opt)) out.push(opt)
    })
  })

  ;(room.freeProps || []).forEach(fp => {
    const t = (fp || '').trim()
    if (t) out.push(t)
  })

  return out
}

/* Small helper for MiniHouse floor labels — user-visible Hebrew name
   per area key. Kept out of state so it's stable across renders. */
function areaKeyLabel(k) {
  switch (k) {
    case 'first':    return 'קומה א׳'
    case 'ground':   return 'קומת קרקע'
    case 'basement': return 'מרתף'
    case 'yard':     return 'חצר'
    default:         return k
  }
}

/* ── Step3Characterization — guided per-room card + within-step
      Prev/Next nav. Renders ONE room at a time from the ordered
      queue. Controls seed from the current room's values and write
      back via the mutators passed in from the parent, which use V1's
      exact data shape (sizeKey / props['r'+gi] / props['c'+gi+'_'+opt]
      / freeProps[]). readOnly disables every control while keeping
      the layout visible. */
function Step3Characterization({
  queue, index, onIndexChange,
  findQueueRoom, findQueueContainer, characterizedIds,
  config, displayType, roomLabel,   // eslint-disable-line no-unused-vars
  FLOOR_DEFS, YARD_LABEL,
  setQueueRoomSize,
  toggleQueueRoomOption,
  addQueueRoomFreeProp,
  removeQueueRoomFreeProp,
  setQueueRoomNote,
  onFinish, readOnly,
}) {
  const total = queue.length
  const [freePropText, setFreePropText] = useState('')
  /* "מאפיין חדש" expander — collapsed by default. */
  const [freePropOpen, setFreePropOpen] = useState(false)
  /* "הערה" expander — collapsed by default, same vocabulary. */
  const [noteOpen, setNoteOpen] = useState(false)
  /* Read-only at-a-glance overview of every characterized room.
     Swaps the guided body while open. */
  const [showSummary, setShowSummary] = useState(false)

  /* Reset the free-prop draft on room change so users don't
     accidentally add the previous room's typed-but-unsubmitted text
     to the next room, and re-collapse the expander so every room
     starts from the same quiet state. */
  useEffect(() => {
    setFreePropText('')
    setFreePropOpen(false)
    setNoteOpen(false)
  }, [index])

  /* Empty queue — user has no rooms yet. Prompt them back to step 2. */
  if (total === 0) {
    return (
      <div style={{
        background:   '#ffffff',
        border:       `1px dashed ${BORDER}`,
        borderRadius: 10,
        padding:      '32px 20px',
        textAlign:    'center',
        color:        MUTED,
        fontSize:     14,
        lineHeight:   1.5,
      }}>
        עדיין לא הוגדרו חללים לאפיון.<br/>
        חזרו לשלב הקודם והוסיפו חדרים.
      </div>
    )
  }


  const item = queue[index]
  const room = item ? findQueueRoom(item) : null

  /* Defensive — queue may transiently point past the end if a room
     was removed while we were on the last one. Parent clamps in
     render but if we still see nothing, bail out gracefully. */
  if (!room) {
    return (
      <div style={{ padding: 16, color: MUTED, fontSize: 13 }}>
        טוען חדר...
      </div>
    )
  }

  const isFixed  = !!(config && config.hasFixedArea && config.hasFixedArea(room.type))
  const propsDef = (config && config.ROOM_PROPS && config.ROOM_PROPS[room.type]) || DEFAULT_PROPS

  /* Rooms of the CURRENTLY SELECTED floor, in queue order. Drives
     both the "N אופיינו" counter and the summary list, so the two
     always agree and both re-derive when the floor changes. */
  const floorItems = queue
    /* `qi` = the item's index in the FULL queue, kept so the room
       picker can jump straight to it via onIndexChange.
       `c` = the owning container (null for a top-level room) so the
       summary rows can name themselves the same way the step-3
       heading does. */
    .map((q, qi) => ({ q, qi, r: findQueueRoom(q), c: findQueueContainer(q) }))
    .filter(x => x.q.areaKey === item.areaKey && x.r)

  /* Container of the room currently being characterized, if any. */
  const itemContainer = findQueueContainer(item)

  /* Count read straight off the SAVED rooms (not ephemeral state),
     scoped to this floor — matches the "חלל X מתוך Y ב{מפלס}"
     counter sitting on the same row, and survives a reload. */
  const characterizedCount = floorItems
    .reduce((n, x) => n + (hasCharacterization(x.r) ? 1 : 0), 0)

  /* Per-floor counter: within the current item's floor, what
     position out of how many rooms. Queue is already ordered
     ground → first → basement → yard, so grouping by areaKey
     preserves that order. Every time the user crosses a floor
     boundary via Next/Prev the counter resets to "1 מתוך N"
     with the new floor's display name. */
  const floorTotal = queue.reduce(
    (n, q) => n + (q.areaKey === item.areaKey ? 1 : 0),
    0
  )
  const floorPos = queue
    .slice(0, index + 1)
    .reduce((n, q) => n + (q.areaKey === item.areaKey ? 1 : 0), 0)

  const submitFreeProp = () => {
    const t = freePropText.trim()
    /* Empty input → no-op, and the expander deliberately stays open
       so the user can just type. */
    if (!t) return
    addQueueRoomFreeProp(item, t)
    setFreePropText('')
    /* Successful add → collapse again; the new entry is now visible
       as a selected chip in the grid above. */
    setFreePropOpen(false)
  }

  /* Floor-selector options: only floors that have at least one
     room in the queue. Preserves the queue's order (ground → first
     → basement → yard) so the segmented bar matches the flow.
     Selecting a floor jumps the queue to that floor's first room —
     Next/Prev then continues through the queue as usual. */
  const floorOptions = []
  const seenFloors = new Set()
  for (const q of queue) {
    if (seenFloors.has(q.areaKey)) continue
    seenFloors.add(q.areaKey)
    const count = queue.reduce(
      (n, x) => n + (x.areaKey === q.areaKey ? 1 : 0),
      0
    )
    const baseLabel = q.areaKey === 'yard'
      ? (YARD_LABEL || 'חצר')
      : ((FLOOR_DEFS || []).find(f => f.key === q.areaKey)?.label || areaKeyLabel(q.areaKey))
    floorOptions.push({
      value: q.areaKey,
      label: `${baseLabel} (${count})`,
    })
  }
  const jumpToFloor = (areaKey) => {
    const firstIdx = queue.findIndex(q => q.areaKey === areaKey)
    if (firstIdx >= 0) onIndexChange(firstIdx)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Floor selector — mirrors Step 2's bar so the two screens
          feel consistent. Selecting a floor jumps to that floor's
          first room in the queue (Next/Prev keeps flowing linearly). */}
      {floorOptions.length > 1 && (
        <Section title="בחירת מפלס לעריכה" subtitle="הקישו על מפלס כדי לקפוץ לחדר הראשון בו">
          <Segmented
            options={floorOptions}
            selected={item.areaKey}
            onSelect={jumpToFloor}
            disabled={readOnly}
            ariaLabel="בחירת מפלס לעריכה"
          />
        </Section>
      )}

      {/* Progress row — counter on the visual-RIGHT (reading start),
          "N אופיינו" small note on the visual-LEFT. */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        direction:      'rtl',
        padding:        '0 2px',
      }}>
        <span style={{ fontSize: 13, color: CHARCOAL, fontWeight: 600 }}>
          חלל {floorPos} מתוך {floorTotal} ב{areaKeyLabel(item.areaKey)}
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>
          {characterizedCount} אופיינו
          {/* Single toggle for the summary — same position, same
              styling in both states; only the label flips. This is
              the ONLY control that opens/closes the summary. */}
          {' '}
          <button
            type="button"
            onClick={() => setShowSummary(v => !v)}
            style={{
              background:     'none',
              border:         'none',
              padding:        0,
              margin:         0,
              font:           'inherit',
              fontSize:       12,
              color:          SAGE_DARK,
              textDecoration: 'underline',
              cursor:         'pointer',
            }}
          >
            {showSummary ? '(חזרה לאפיון)' : '(לתצוגה סיכומית)'}
          </button>
        </span>
      </div>

      {/* ── SUMMARY vs SINGLE-ROOM ──
          The summary replaces ONLY this block. Everything above it
          (progress bar, "שלב 3 מתוך 3", companion bubble, floor
          selector, the counter row + toggle link) and the sticky
          footer below all stay mounted. Because the list derives
          from `floorItems`, switching floors while the summary is
          open just re-renders it for the newly selected floor —
          the summary stays open. The queue `index` is never touched
          by the toggle, so closing returns to the same room. */}
      {showSummary ? (
        <SummaryPanel floorItems={floorItems} config={config} roomLabel={roomLabel} />
      ) : (
      <>
      {/* Room card — big header + controls */}
      <div style={{
        background:   '#ffffff',
        border:       `1px solid ${BORDER}`,
        borderRadius: 12,
        padding:      '14px 14px 16px',
        display:      'flex',
        flexDirection:'column',
        gap:          14,
        direction:    'rtl',
      }}>
        {/* Title block — room name + grey floor subtitle only. The
            size control moved out to its own row below. */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize:   19,
            fontWeight: 700,
            color:      CHARCOAL,
            lineHeight: 1.25,
          }}>
            {/* A room inside a container carries its unit in the
                heading itself ("יחידת סוויטה - חדר רחצה"); a
                top-level room keeps the plain label. Shared with
                the room picker via roomDisplayName. */}
            {roomDisplayName(room, itemContainer, roomLabel)}
          </div>
          <div style={{
            marginTop:  3,
            fontSize:   12,
            color:      MUTED,
            lineHeight: 1.4,
          }}>
            {/* Floor only — the "בתוך יחידה" fragment moved into the
                heading above, so it isn't stated twice. */}
            {areaKeyLabel(item.areaKey)}
          </div>
        </div>

        {/* ── גודל — classic radio group ──
            A compact inline row of radios, not a full-width control.
            Labels are the short letters S / M / L, but the value
            written is the SAME config size key as before, so nothing
            about storage changes. A fixed-area room asks no size
            question at all — neither the control nor this heading
            renders for it. */}
        {!isFixed && (
          <div>
            <FieldLabel>גודל</FieldLabel>
            <div
              role="radiogroup"
              aria-label="גודל"
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        16,
                direction:  'rtl',
              }}
            >
              {SIZE_KEYS_IN_ORDER.map(k => (
                <SizeRadio
                  key={k}
                  /* Short letter for display; `k` stays the stored key. */
                  label={k}
                  selected={(SIZE_LABELS_MAP[room.sizeKey] ? room.sizeKey : 'M') === k}
                  disabled={readOnly}
                  onSelect={() => setQueueRoomSize(item, k)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── מאפיינים — ONE flat grid ──
            Every option of every config group, flattened, 3 per row,
            all chips identical. No group sub-headings are rendered.
            Every chip is an INDEPENDENT toggle: the config's
            single/multi `type` is deliberately ignored here, so
            picking one option never clears a sibling.
            Custom "מאפיין אחר" entries join this same grid (already
            selected, with a × that deletes rather than toggles). */}
        <div>
          <FieldLabel>מאפיינים</FieldLabel>
          <div style={{
            display:             'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap:                 8,
            direction:           'rtl',
          }}>
            {propsDef.map((group, gi) => {
              const sel = (room.props || {})[propGroupKey(gi)]
              const selArr = Array.isArray(sel) ? sel : []
              return (group.opts || []).map(opt => (
                <PropChip
                  key={`${gi}-${opt}`}
                  label={opt}
                  selected={selArr.includes(opt)}
                  disabled={readOnly}
                  onClick={() => toggleQueueRoomOption(item, gi, opt)}
                />
              ))
            })}
            {/* Custom characteristics live in the SAME grid, always
                in the selected state; × removes them outright. */}
            {(room.freeProps || []).map((fp, i) => (
              <PropChip
                key={`free-${i}`}
                label={fp}
                selected
                disabled={readOnly}
                onRemove={readOnly ? null : () => removeQueueRoomFreeProp(item, i)}
              />
            ))}
          </div>
        </div>

        {/* "מאפיין חדש" — collapsed by default. Expanding reveals the
            same input + add button as before, unchanged in behaviour.
            A successful add collapses it again and clears the input
            (see submitFreeProp); the new entry shows up as a selected
            chip in the grid above. An empty add does nothing and
            leaves the expander open. Same chevron vocabulary as the
            portal's other expanders. */}
        <div>
          <button
            type="button"
            onClick={() => setFreePropOpen(v => !v)}
            aria-expanded={freePropOpen}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            6,
              width:          '100%',
              background:     'none',
              border:         'none',
              padding:        '2px 0',
              margin:         0,
              fontFamily:     'inherit',
              fontSize:       12.5,
              fontWeight:     600,
              color:          CHARCOAL,
              cursor:         'pointer',
              direction:      'rtl',
              textAlign:      'right',
            }}
          >
            <span>מאפיין חדש</span>
            <span style={{
              display:    'inline-flex',
              transform:  freePropOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s ease',
              color:      MUTED,
              lineHeight: 1,
            }}>
              <IconChevron size={14} />
            </span>
          </button>

          {freePropOpen && (
            <div style={{
              display:    'flex',
              alignItems: 'center',
              gap:        6,
              direction:  'rtl',
              marginTop:  8,
            }}>
              <TextInput
                value={freePropText}
                onChange={setFreePropText}
                placeholder="הוסיפו מאפיין משלכם"
                readOnly={readOnly}
                ariaLabel="מאפיין חדש"
                style={{ flex: '1 1 auto', minWidth: 0 }}
              />
              <button
                type="button"
                onClick={submitFreeProp}
                disabled={readOnly || !freePropText.trim()}
                aria-label="הוסף מאפיין"
                style={{
                  background:   SAGE,
                  color:        '#ffffff',
                  border:       `1px solid ${SAGE_DARK}`,
                  borderRadius: 8,
                  padding:      '8px 14px',
                  fontFamily:   'inherit',
                  fontSize:     13,
                  fontWeight:   600,
                  cursor:       (readOnly || !freePropText.trim()) ? 'not-allowed' : 'pointer',
                  opacity:      (readOnly || !freePropText.trim()) ? 0.55 : 1,
                  flexShrink:   0,
                }}
              >
                ＋ הוסף
              </button>
            </div>
          )}
        </div>

        {/* "הערה" — free-text note, collapsed by default. Same chevron
            expander vocabulary as "מאפיין חדש" above. Unlike freeProps
            (a list of short selected tags), this is ONE longer note
            string, so it's a plain controlled textarea rather than an
            add/remove chip list — written straight through on every
            keystroke via setQueueRoomNote, same as every other control
            on this screen. */}
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setNoteOpen(v => !v)}
            aria-expanded={noteOpen}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            6,
              width:          '100%',
              background:     'none',
              border:         'none',
              padding:        '2px 0',
              margin:         0,
              fontFamily:     'inherit',
              fontSize:       12.5,
              fontWeight:     600,
              color:          CHARCOAL,
              cursor:         'pointer',
              direction:      'rtl',
              textAlign:      'right',
            }}
          >
            <span>הערה</span>
            <span style={{
              display:    'inline-flex',
              transform:  noteOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s ease',
              color:      MUTED,
              lineHeight: 1,
            }}>
              <IconChevron size={14} />
            </span>
          </button>

          {noteOpen && (
            <textarea
              value={room.note || ''}
              onChange={(e) => setQueueRoomNote(item, e.target.value)}
              placeholder="כאן אפשר לרשום הערה, כמו לדוגמא: חייב להיות בצמוד לחלל מסויים"
              readOnly={readOnly}
              dir="rtl"
              aria-label="הערה"
              rows={3}
              style={{
                display:      'block',
                width:        '100%',
                marginTop:    8,
                padding:      '8px 10px',
                border:       `1px solid ${INPUT_BORDER}`,
                borderRadius: 8,
                fontFamily:   'inherit',
                fontSize:     14,
                lineHeight:   1.4,
                color:        CHARCOAL,
                background:   '#ffffff',
                textAlign:    'right',
                resize:       'vertical',
                boxSizing:    'border-box',
                outline:      'none',
              }}
            />
          )}
        </div>
      </div>

      {/* ── ROOM navigation — inline text links, NOT buttons ──
          Deliberately styled as plain sage text so they read as a
          different affordance from the bottom footer's step
          buttons: the footer moves between STEPS (1→2→3), these
          move between ROOMS inside step 3. Disabled (muted, not
          clickable) at the queue's ends rather than wrapping.
          RTL: first DOM child paints on the visual RIGHT. */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        direction:      'rtl',
        gap:            10,
        padding:        '0 2px',
      }}>
        <RoomNavLink
          label="לחלל הקודם"
          disabled={index === 0}
          onClick={() => onIndexChange(index - 1)}
        />
        {/* Centre: jump straight to any space on THIS floor instead
            of paging. space-between with three children centres it. */}
        <RoomPicker
          items={floorItems}
          currentIndex={index}
          roomLabel={roomLabel}
          onPick={(qi) => onIndexChange(qi)}
        />
        <RoomNavLink
          label="לחלל הבא"
          disabled={index >= total - 1}
          onClick={() => onIndexChange(index + 1)}
        />
      </div>
      </>
      )}
    </div>
  )
}

/* SummaryPanel — read-only overview of the CURRENTLY SELECTED
   floor's rooms. Renders in place of the single-room card, directly
   under the counter row. Two lines per room: the numbered name (V1
   numbering) and all its characteristics comma-joined. Only rooms
   that are actually characterized are listed — same rule the
   "N אופיינו" counter on the row above uses, so the two agree. */
function SummaryPanel({ floorItems, config, roomLabel }) {
  /* Only characterized rooms appear — so a container whose children
     all fail this filter contributes nothing and its block is never
     created (no empty heading). */
  const qualifying = floorItems.filter(x => hasCharacterization(x.r))

  /* Group CONSECUTIVE items that share a container into one block.
     The queue emits a container's children back-to-back at the
     container's own position in the floor order, so grouping
     consecutively preserves the overall ordering exactly. */
  const blocks = []
  for (const x of qualifying) {
    const cid  = x.c ? x.c.id : null
    const last = blocks[blocks.length - 1]
    if (cid != null && last && last.containerId === cid) {
      last.children.push(x)
      continue
    }
    if (cid != null) {
      blocks.push({
        kind:        'container',
        key:         `unit-${x.q.areaKey}-${cid}`,
        containerId: cid,
        container:   x.c,
        children:    [x],
      })
    } else {
      blocks.push({
        kind: 'room',
        key:  `${x.q.areaKey}-${x.q.roomId}`,
        item: x,
      })
    }
  }

  /* The two-line shape every summary entry uses: bold name, then
     comma-joined characteristics in the muted colour beneath, then
     (when present) the free-text note on its own line. */
  /* Row shape:
       line 1 — name, plus the size in parentheses when the room has
                one (a fixed-area type has no size selector, so it
                gets no parentheses).
       line 2 — "מאפיינים:" + every characteristic EXCEPT the size,
                comma-separated, freeProps last. Omitted entirely
                when there is nothing to list, so a room whose only
                characteristic was its size shows just line 1 rather
                than an empty "מאפיינים:" line.
       line 3 — "הערה:" + the room's note, on its own line rather than
                folded into the comma-separated characteristics list
                (it's free text, not a short tag). Omitted entirely
                when there's no note — no empty placeholder line.
     The prefix carries the same muted styling as the rest of the
     line — deliberately not bold, no new colour. */
  const twoLine = (label, sizeLabel, chars, note) => (
    <>
      <div style={{ fontSize: 14, fontWeight: 700, color: CHARCOAL, lineHeight: 1.3 }}>
        {label}
        {sizeLabel && (
          /* The size rides on the same line right after the name, but
             steps down to the second line's styling — normal weight,
             12.5px, muted — so only the room name reads as bold. */
          <span style={{
            fontSize:   12.5,
            fontWeight: 400,
            color:      INPUT_TEXT,
          }}>{` (${sizeLabel})`}</span>
        )}
      </div>
      {chars.length > 0 && (
        <div style={{
          marginTop:  3,
          fontSize:   12.5,
          color:      INPUT_TEXT,
          lineHeight: 1.6,
        }}>
          {`מאפיינים: ${chars.join(', ')}`}
        </div>
      )}
      {note && note.trim() && (
        <div style={{
          marginTop:  3,
          fontSize:   12.5,
          color:      INPUT_TEXT,
          lineHeight: 1.6,
        }}>
          {`הערה: ${note.trim()}`}
        </div>
      )}
    </>
  )

  if (qualifying.length === 0) {
    return (
      <div style={{
        background:   '#ffffff',
        border:       `1px dashed ${BORDER}`,
        borderRadius: 12,
        padding:      '28px 20px',
        textAlign:    'center',
        color:        MUTED,
        fontSize:     13.5,
        lineHeight:   1.5,
        direction:    'rtl',
      }}>
        עדיין לא אופיינו חללים במפלס זה.
      </div>
    )
  }

  return (
    <div style={{
      background:   '#ffffff',
      border:       `1px solid ${BORDER}`,
      borderRadius: 12,
      padding:      '4px 14px',
      direction:    'rtl',
    }}>
      {/* One entry per BLOCK. A container block is a single entry —
          so it gets one separator above it (and the next entry's
          separator closes it below), with NO separators between the
          children inside. */}
      {blocks.map((block, i) => (
        <div
          key={block.key}
          style={{
            padding:   '10px 0',
            borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
          }}
        >
          {block.kind === 'room' ? (
            twoLine(
              roomLabel(block.item.r),
              roomSizeLabel(block.item.r, config),
              roomCharacteristics(block.item.r, config),
              block.item.r.note,
            )
          ) : (
            <>
              {/* Container heading — label only. A container has no
                  properties, so no characteristics line. */}
              <div style={{ fontSize: 14, fontWeight: 700, color: CHARCOAL, lineHeight: 1.3 }}>
                {roomLabel(block.container)}
              </div>
              {/* Children, indented inward. RTL: paddingInlineStart
                  is the visual RIGHT side, so the nesting reads
                  correctly. The child name carries NO unit prefix —
                  the heading above already states it. */}
              <div style={{ paddingInlineStart: 12 }}>
                {block.children.map((x, ci) => (
                  <div
                    key={`${x.q.areaKey}-${x.q.roomId}`}
                    style={{ marginTop: ci === 0 ? 8 : 10 }}
                  >
                    {twoLine(
                      roomLabel(x.r),
                      roomSizeLabel(x.r, config),
                      roomCharacteristics(x.r, config),
                      x.r.note,
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

/* RoomPicker — "בחר חלל" dropdown sitting between the two room-nav
   links. Lists every space on the CURRENTLY SELECTED floor in queue
   order (the same order paging produces) and jumps straight to one.

   · Entries reuse roomDisplayName, so a room inside a unit reads
     "יחידת סוויטה - חדר רחצה" exactly as the card heading does.
   · A ✓ marks spaces that are already characterized, via the shared
     hasCharacterization predicate — no second definition.
   · The current space is highlighted and marked aria-current.
   · Closes on outside click and on Escape.
   Trigger is a quiet TEXT control matching RoomNavLink's font size
   and sage colour — it must not read as a heavy button competing
   with the footer's step buttons. */
function RoomPicker({ items, currentIndex, roomLabel, onPick }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        style={{
          background:     'none',
          border:         'none',
          padding:        '2px 0',
          margin:         0,
          font:           'inherit',
          fontSize:       12.5,
          fontWeight:     600,
          color:          SAGE_DARK,
          textDecoration: 'underline',
          cursor:         'pointer',
          whiteSpace:     'nowrap',
          display:        'inline-flex',
          alignItems:     'center',
          gap:            4,
          direction:      'rtl',
        }}
      >
        <span>בחר חלל</span>
        <span style={{
          display:    'inline-flex',
          transform:  open ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s ease',
          lineHeight: 1,
        }}>
          <IconChevron size={12} />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position:     'absolute',
            top:          'calc(100% + 6px)',
            /* Centre the panel on the trigger. */
            left:         '50%',
            transform:    'translateX(-50%)',
            zIndex:       20,
            minWidth:     200,
            maxWidth:     280,
            maxHeight:    240,
            overflowY:    'auto',
            background:   '#ffffff',
            border:       `1px solid ${BORDER}`,
            borderRadius: 10,
            boxShadow:    '0 4px 14px rgba(26,26,24,0.12)',
            padding:      4,
            direction:    'rtl',
            textAlign:    'right',
          }}
        >
          {items.map((x) => {
            const isCurrent = x.qi === currentIndex
            const done      = hasCharacterization(x.r)
            return (
              <button
                key={`${x.q.areaKey}-${x.q.roomId}`}
                type="button"
                role="option"
                aria-selected={isCurrent}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={() => { onPick(x.qi); setOpen(false) }}
                style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          6,
                  width:        '100%',
                  boxSizing:    'border-box',
                  background:   isCurrent ? SAGE_LITE : 'transparent',
                  border:       'none',
                  borderRadius: 6,
                  padding:      '7px 8px',
                  fontFamily:   'inherit',
                  fontSize:     12.5,
                  fontWeight:   isCurrent ? 700 : 400,
                  color:        CHARCOAL,
                  cursor:       'pointer',
                  textAlign:    'right',
                  direction:    'rtl',
                  lineHeight:   1.4,
                }}
              >
                {/* Fixed-width slot so labels align whether or not
                    the ✓ is present. */}
                <span style={{
                  flexShrink: 0,
                  width:      12,
                  color:      SAGE_DARK,
                  fontSize:   12,
                }}>
                  {done ? '✓' : ''}
                </span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  {roomDisplayName(x.r, x.c, roomLabel)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </span>
  )
}

/* RoomNavLink — subtle text-link for stepping through step 3's room
   queue. Intentionally NOT button-shaped (no border/fill) so it
   can't be confused with the footer's step-navigation buttons. */
function RoomNavLink({ label, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      style={{
        background:     'none',
        border:         'none',
        padding:        '2px 0',
        margin:         0,
        font:           'inherit',
        fontSize:       12.5,
        fontWeight:     600,
        color:          disabled ? MUTED : SAGE_DARK,
        textDecoration: disabled ? 'none' : 'underline',
        cursor:         disabled ? 'default' : 'pointer',
        opacity:        disabled ? 0.45 : 1,
        whiteSpace:     'nowrap',
      }}
    >
      {label}
    </button>
  )
}

