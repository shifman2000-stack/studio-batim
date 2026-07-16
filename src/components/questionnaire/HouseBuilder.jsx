// src/components/questionnaire/HouseBuilder.jsx
//
// Interactive house-builder — part 2 of the programming questionnaire.
// STAGE C-2: local state only, no DB save/load. Stage C-3 lifts the
// state into ClientProgrammingQuestionnaire.jsx and persists it under
// answers.house.
//
// Layout: split screen — panel + schematic house — plus a finish bar
// underneath. On desktop the panel is on the visual RIGHT (DOM-first
// in an RTL flex row) and the house on the LEFT. On phones ≤720px the
// split flips to a column stack (house top, panel middle) via `order`.
//
// Panel has three modes:
//   * 'floors' — pick which floors + yard exist.
//   * 'rooms'  — for the selected floor, add rooms from ROOM_PALETTE
//                or a free-text "חלל אחר".
//   * 'props'  — for the selected room, toggle ROOM_PROPS chips and
//                add free-text "מאפיין אחר" entries.
//
// The schematic house renders roof + floors (only those turned on) +
// a sage "ground line" (between ground and basement, or under the
// whole house if there's no basement) + optional yard. Rooms are
// uniform 58px cubes, 3 per row, 2-line-clamp with ellipsis.
// Cube states:
//   * empty (no props / freeProps)         → whitish + light sage border
//   * detailed (any props or freeProps)    → sage-filled, white text
//   * currently being edited (selRoom)     → orange outline (box-shadow)
//
// Room labels are numbered GLOBALLY across all areas (first → ground →
// basement → yard) per type — computed at render time from state,
// never stored. If only one of a type exists globally, it's just "מטבח".

import { useEffect, useRef, useState } from 'react'
/* Static app-level constants that don't come from the DB config
   (intro overlay text, panel mode-hint strings, roof-shape option
   labels, and the DEFAULT_PROPS fallback for undecorated room types). */
import {
  DEFAULT_PROPS,
  INTRO,
  MODE_HINTS,
  ROOF_OPTIONS,
} from '../../lib/houseBuilderConfig'
/* Runtime config source — reads the ACTIVE row from Supabase and
   falls back to the in-code config on any failure. `getFallbackConfig`
   is used to seed the state so the first render never sees a null. */
import {
  getFallbackConfig,
  loadHouseBuilderConfig,
} from '../../lib/houseBuilderConfigSource'
import { houseToJSON, houseFromJSON } from '../../lib/houseBuilderState'
import {
  SIZE_LABELS,
  DEFAULT_SIZE_KEY,
  estimateArea,
} from '../../lib/houseSizeConfig'
import './HouseBuilder.css'

/* UI order for the size chips: largest → smallest, matching the
   spec ("גדול / בינוני / קטן"). */
const SIZE_KEYS_IN_ORDER = ['L', 'M', 'S']

/* Panel-header pills. DOM order = visual RTL reading order: the first
   entry paints on the visual RIGHT (pill 1 = "מפלסים"), the last on
   the visual LEFT (pill 3 = "מאפיינים"). Same three modes as the
   panel body. Labels are used only as `title=` tooltips — the pill
   itself renders the ordinal (1/2/3), matching the questionnaire
   step pills in ClientProgrammingQuestionnaire.jsx. */
const PILL_STEPS = [
  { mode: 'floors',  label: 'מפלסים' },
  { mode: 'rooms',   label: 'חללים' },
  { mode: 'props',   label: 'אפיון החלל' },
  { mode: 'general', label: 'אלמנטים ומאפיינים כלליים' },
]

/**
 * Props:
 *   onBack(currentJson)   — user tapped "↩ חזרה"; parent typically
 *                           saves + navigates to the hub.
 *   onDone(currentJson)   — user ticked the finish checkbox; parent
 *                           typically saves (Stage C-3 doesn't lock).
 *   onChange(currentJson) — fires after every builder state change so
 *                           the parent can keep an up-to-date snapshot
 *                           without waiting for onBack/onDone.
 *   initialData           — the JSONB payload previously stored under
 *                           answers.house, or null on first entry.
 *                           Passed through houseFromJSON to hydrate.
 *   readOnly              — when true (e.g. status === 'submitted'),
 *                           every mutating action is a no-op and the
 *                           child panels disable their interactive
 *                           controls. Selection / navigation stays
 *                           allowed so the client can still browse.
 *   onManualSave()        — optional. When provided, HouseBuilder
 *                           renders a "שמור טיוטה" button ABOVE the
 *                           finish checkbox inside the finish bar.
 *                           Parent supplies the immediate-save
 *                           handler (typically one that cancels the
 *                           debounce + writes to the DB now).
 *   savingDraft           — reflects the parent's in-flight save;
 *                           dims the manual-save button + shows
 *                           "שומר..." label while true.
 *   savedFlash            — parent's "just-saved" toggle; when true,
 *                           HouseBuilder shows the "נשמר ✓" indicator
 *                           next to the manual-save button.
 */
export default function HouseBuilder({
  onBack,
  onDone,
  onChange,
  initialData = null,
  readOnly = false,
  onManualSave,
  savingDraft = false,
  savedFlash = false,
  /* Controlled finish-checkbox — when the parent passes both
     `doneChecked` (bool) and `onDoneChange` (fn), the checkbox is
     driven by the prop instead of the transient internal `state.done`
     (so the "done" state persists across reloads via the parent's
     jsonb meta flag). onDoneChange fires on BOTH check + uncheck.
     When neither prop is passed, the checkbox falls back to the
     legacy uncontrolled behavior + onDone(json) on the true edge. */
  doneChecked,
  onDoneChange,
}) {
  /* Runtime config — seeded from the in-code fallback so the first
     render sees a fully-populated shape, then swapped to the DB-
     sourced config once loadHouseBuilderConfig resolves. Any DB
     failure is swallowed inside the loader (see loader source) and
     the fallback simply stays in place — the builder never breaks. */
  const [config, setConfig] = useState(getFallbackConfig)
  useEffect(() => {
    let cancelled = false
    loadHouseBuilderConfig().then(next => {
      if (!cancelled) setConfig(next)
    })
    return () => { cancelled = true }
  }, [])

  /* Destructure the identifiers the rest of this component uses so
     the code below reads identically to before — the swap point is
     just this one line. Every accessor / map inside `config` matches
     the shape of the equivalent in-code export. */
  const {
    FLOOR_DEFS,
    AREA_KEYS,
    YARD_LABEL,
    getPalette,
    displayType,
    ROOM_PROPS,
    ROOM_SIZES,
    isContainer,
    getContainerAllowedChildren,
    getContainerAutoChildren,
    getContainerRequiredTypes,
    getFixedArea,
    hasFixedArea,
    getDefaultSize,
  } = config

  /* Resolve the initial sizeKey for a freshly-added room of a given
     type. Order of precedence:
       1. Fixed-area rooms have no size selector at all — return null
          and let the room omit the sizeKey field entirely.
       2. Config-specified defaultSize for this type (via the DB-
          sourced config or the fallback, which returns null).
       3. The static DEFAULT_SIZE_KEY ('M') so old code paths / empty
          configs still behave exactly as before.
     Guarded so a bad/absent config accessor never crashes room add. */
  const resolveInitialSizeKey = (t) => {
    if (typeof getFixedArea === 'function' && getFixedArea(t) != null) return null
    if (typeof getDefaultSize === 'function') {
      const cfgDefault = getDefaultSize(t)
      if (cfgDefault === 'S' || cfgDefault === 'M' || cfgDefault === 'L') return cfgDefault
    }
    return DEFAULT_SIZE_KEY
  }

  const [state, setState] = useState(() => {
    /* Ground floor (קומת קרקע) is permanent — force it on regardless
       of what the saved JSON carried, so the checkbox-always-checked
       UI stays consistent with what the schematic house paints and no
       downstream code has to special-case a legacy row that saved
       ground:false. Everything else hydrates unchanged. */
    const hydrated = houseFromJSON(initialData)
    return {
      ...hydrated,
      floorsOn: { ...hydrated.floorsOn, ground: true },
    }
  })

  /* Intro is shown on every fresh entry — component-local, resets on
     mount, which is exactly what we want since HouseBuilder mounts /
     unmounts as the parent view toggles between hub / questionnaire /
     house. A small "איך זה עובד?" link inside the builder header can
     re-open it if the client wants to re-read the steps. */
  const [showIntro, setShowIntro] = useState(true)

  /* Transient hint shown under the mode-hint when a pill click can't
     complete (currently only "props" when the active floor has zero
     rooms). Auto-clears after a short timeout — no plumbing needed
     from mutators. */
  const [nudge, setNudge] = useState('')
  useEffect(() => {
    if (!nudge) return
    const t = setTimeout(() => setNudge(''), 3500)
    return () => clearTimeout(t)
  }, [nudge])

  /* Confirmation modal for "delete a populated floor" — floors that
     already contain rooms can't be un-checked directly; the user
     must confirm here first. Stored as either null (closed) or
     { floorKey, label }. Closes on ESC / overlay click / Cancel /
     after confirming the delete. */
  const [confirmDeleteFloor, setConfirmDeleteFloor] = useState(null)
  useEffect(() => {
    if (!confirmDeleteFloor) return
    const onKey = (e) => { if (e.key === 'Escape') setConfirmDeleteFloor(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmDeleteFloor])

  /* Confirmation for removing a WHOLE container (יחידת סוויטה / יחידת דיור)
     that still holds children. Same modal shape / same ESC + overlay
     behaviour as confirmDeleteFloor. Stored as { floorKey, roomId } or
     null. Empty containers skip the confirm and remove immediately
     (see handleMenuRemove below). */
  const [confirmDeleteContainer, setConfirmDeleteContainer] = useState(null)
  useEffect(() => {
    if (!confirmDeleteContainer) return
    const onKey = (e) => { if (e.key === 'Escape') setConfirmDeleteContainer(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmDeleteContainer])

  /* Desktop-only per-cube right-click menu. Stored as either null
     (closed) or {x, y, floorKey, roomId}. Position is viewport-fixed
     (clientX/clientY on the contextmenu event). Closes on outside
     click / Escape / after choosing an action. Right-click naturally
     doesn't fire on touch devices, so no mobile behavior changes. */
  const [menu, setMenu] = useState(null)
  useEffect(() => {
    if (!menu) return
    const onDown = (e) => {
      /* Ignore clicks landing on the menu itself; anything else closes. */
      if (e.target && typeof e.target.closest === 'function'
          && e.target.closest('.hb-context-menu')) return
      setMenu(null)
    }
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown',   onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown',   onKey)
    }
  }, [menu])

  /* Broadcast the current state to the parent after every mutation so
     the parent always has a fresh snapshot to save on onBack / onDone.
     Fires once on mount too (with the hydrated JSON) — harmless: the
     parent's handler is idempotent. */
  useEffect(() => {
    if (typeof onChange === 'function') {
      onChange(houseToJSON(state))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  /* ── Derived: is any area on? Drives the "המשך" button. ───────── */
  const anyAreaOn =
    FLOOR_DEFS.some(f => state.floorsOn[f.key]) || state.yardOn

  /* ── State updates ──────────────────────────────────────────── */

  /* ── Read-only guards ────────────────────────────────────────────
     When readOnly is true (parent is locked, e.g. status='submitted'),
     every MUTATING action is a no-op. Navigation actions
     (setMode / selectArea / selectRoom / goToRoomsFromFloors) stay
     enabled so the client can still browse the previously-saved
     house — they just can't change anything. Child panels get their
     own copy of `readOnly` and disable their interactive controls. */

  const setMode = (mode) => setState(s => ({ ...s, mode }))

  /* Top-of-panel step pills — one entry point per mode. Follows the
     "pick the first" principle so a click never dead-ends:
       * floors: always allowed.
       * rooms:  if no active area is selected, auto-pick the first
                 turned-on floor (FLOOR_DEFS order) → yard → auto-
                 enable ground and pick it.
       * props:  first resolve the active area the same way as rooms;
                 then, if a room is already selected keep it and flip
                 mode; otherwise pick the FIRST room of the resolved
                 floor. If that floor has zero rooms, stay on 'rooms'
                 and nudge the user with "הוסיפו חלל תחילה". */
  const jumpToMode = (target) => {
    if (target === 'floors' || target === 'general') {
      /* Step 4 is a global step — no active floor / active room to
         resolve, so it's always immediately accessible. */
      setMode(target)
      return
    }

    /* Snapshot at click time — the setState updater below reads from
       these pre-computed values, so React strict-mode's double-invoke
       stays pure. */
    const s = state

    if (target === 'rooms') {
      if (s.selFloor) { setMode('rooms'); return }
      const firstOn = FLOOR_DEFS.find(f => s.floorsOn[f.key])?.key
      if (firstOn) {
        setState(prev => ({ ...prev, selFloor: firstOn, selRoom: null, mode: 'rooms' }))
        return
      }
      if (s.yardOn) {
        setState(prev => ({ ...prev, selFloor: 'yard', selRoom: null, mode: 'rooms' }))
        return
      }
      /* Nothing on at all — auto-enable קומת קרקע. */
      setState(prev => ({
        ...prev,
        floorsOn: { ...prev.floorsOn, ground: true },
        selFloor: 'ground',
        selRoom:  null,
        mode:     'rooms',
      }))
      return
    }

    if (target === 'props') {
      /* Already have a selected room? Just flip the mode. */
      if (s.selRoom) {
        setMode('props')
        return
      }
      /* Resolve intended active area using the same rules as 'rooms'. */
      let intended = s.selFloor
      let willEnableGround = false
      if (!intended) {
        const firstOn = FLOOR_DEFS.find(f => s.floorsOn[f.key])?.key
        if (firstOn)       intended = firstOn
        else if (s.yardOn) intended = 'yard'
        else               { intended = 'ground'; willEnableGround = true }
      }
      const roomsHere = s.rooms[intended] || []
      if (roomsHere.length === 0) {
        /* Skip a no-op setState so the onChange broadcast doesn't fire
           when the only thing changing is the nudge (which is local
           to this component and never persisted). */
        const alreadyThere =
          s.mode === 'rooms' && s.selFloor === intended && !willEnableGround
        if (!alreadyThere) {
          setState(prev => ({
            ...prev,
            floorsOn: willEnableGround ? { ...prev.floorsOn, ground: true } : prev.floorsOn,
            selFloor: intended,
            selRoom:  null,
            mode:     'rooms',
          }))
        }
        setNudge('הוסיפו חלל תחילה')
        return
      }
      const firstRoom = roomsHere[0]
      setState(prev => ({
        ...prev,
        floorsOn: willEnableGround ? { ...prev.floorsOn, ground: true } : prev.floorsOn,
        selFloor: intended,
        selRoom:  { floor: intended, id: firstRoom.id },
        mode:     'props',
      }))
    }
  }

  const toggleArea = (key) => {
    if (readOnly) return
    setState(s => {
      if (key === 'yard') return { ...s, yardOn: !s.yardOn }
      const nextOn = !s.floorsOn[key]
      const nextFloors = { ...s.floorsOn, [key]: nextOn }
      /* If we just turned off the currently-selected floor, drop
         selection so the panel doesn't render stale rooms. Also drop
         any container context that lived on that floor. */
      let selFloor = s.selFloor
      let selRoom  = s.selRoom
      let selContainer = s.selContainer
      if (!nextOn && s.selFloor === key) { selFloor = null; selRoom = null }
      if (!nextOn && s.selContainer && s.selContainer.floor === key) selContainer = null
      return { ...s, floorsOn: nextFloors, selFloor, selRoom, selContainer }
    })
  }

  const selectArea = (areaKey) => {
    /* Switching floors from the schematic also drops any container the
       user was inside — starting fresh on the newly-clicked floor. */
    setState(s => ({
      ...s,
      selFloor: areaKey,
      selRoom: null,
      selContainer: null,
      mode: 'rooms',
    }))
  }

  /* ── Container navigation ───────────────────────────────────────
     "Entering" a container flips selContainer to point at that room;
     the rooms panel then operates on its `children` and shows the
     container's allowed-children palette. Exiting resets selContainer.
     Both are pure navigation — no data mutation. */
  const enterContainer = (floorKey, containerId) => {
    setState(s => ({
      ...s,
      selContainer: { floor: floorKey, id: containerId },
      selFloor: floorKey,
      selRoom: null,
      mode: 'rooms',
    }))
  }
  const exitContainer = () => {
    setState(s => ({ ...s, selContainer: null, selRoom: null }))
  }

  /* Cube-click router in the schematic house. Top-level rooms:
       * container → enter it
       * regular   → select it for props
     Any prior container context clears first — a fresh top-level cube
     click always exits the previous container. */
  const selectOrEnterRoom = (floorKey, id) => {
    const list = state.rooms[floorKey] || []
    const room = list.find(r => r.id === id)
    if (room && isContainer(room.type)) {
      enterContainer(floorKey, id)
      return
    }
    setState(s => ({
      ...s,
      selContainer: null,
      selRoom: { floor: floorKey, id },
      mode: 'props',
    }))
  }

  /* Child-cube-click router in the schematic (a child cube painted
     inside a unit box). Enters the parent container AND opens props
     for the clicked child in one state update — so when the user
     leaves props they land back on the container-inside 'rooms' view
     rather than the plain floor. Panel-side child clicks go through
     the same setState pattern via onSelectChild in RoomsPanel. */
  const selectChildForProps = (floorKey, containerId, childId) => {
    setState(s => ({
      ...s,
      selContainer: { floor: floorKey, id: containerId },
      selFloor:     floorKey,
      selRoom:      { floor: floorKey, id: childId },
      mode:         'props',
    }))
  }

  /* Helper: locate the container the user is currently inside (or null).
     Used by derived vars + guards below. Reads either the passed-in
     snapshot or the current state. */
  const getActiveContainer = (snap = state) => {
    if (!snap.selContainer) return null
    const list = snap.rooms[snap.selContainer.floor] || []
    const container = list.find(r => r.id === snap.selContainer.id)
    return container ? { container, floor: snap.selContainer.floor } : null
  }

  const goToRoomsFromFloors = () => {
    /* Auto-select the topmost visible floor (FLOOR_DEFS order first →
       ground → basement), falling back to yard when only yard is on. */
    setState(s => {
      const first =
        FLOOR_DEFS.find(f => s.floorsOn[f.key])?.key
        || (s.yardOn ? 'yard' : null)
      return { ...s, selFloor: first, selRoom: null, mode: 'rooms' }
    })
  }

  const addRoom = (floorKey, type) => {
    if (readOnly) return
    const t = (type || '').trim()
    if (!floorKey || !t) return
    setState(s => {
      /* New rooms initialize their sizeKey from the config's per-type
         defaultSize (see resolveInitialSizeKey). Fixed-area rooms get
         no sizeKey at all; typed rooms get the configured default; a
         missing/invalid config default falls back to DEFAULT_SIZE_KEY
         so old behavior is preserved. */
      const isCont = isContainer(t)
      let nextSeq = s.roomSeq
      const initialSizeKey = resolveInitialSizeKey(t)
      const newRoom = {
        id:        nextSeq++,
        type:      t,
        props:     {},
        freeProps: [],
      }
      if (initialSizeKey != null) newRoom.sizeKey = initialSizeKey
      if (isCont) {
        /* Containers hold children. Suite gets an auto-added חדר שינה
           (see SUITE_AUTO_CHILDREN in config); other containers just
           start with an empty children[]. Auto-children draw fresh ids
           from the same roomSeq counter so global numbering stays
           collision-free. Each child's initial sizeKey ALSO respects
           its own configured defaultSize. */
        newRoom.children = []
        for (const childType of getContainerAutoChildren(t)) {
          const childSizeKey = resolveInitialSizeKey(childType)
          const child = {
            id:        nextSeq++,
            type:      childType,
            props:     {},
            freeProps: [],
          }
          if (childSizeKey != null) child.sizeKey = childSizeKey
          newRoom.children.push(child)
        }
      }
      /* If we're inside a container, the new room goes into its
         children instead of onto the floor. selContainer.floor pins
         which floor / which container to write to. */
      if (s.selContainer && s.selContainer.floor === floorKey) {
        const list = s.rooms[floorKey] || []
        const nextList = list.map(r => {
          if (r.id !== s.selContainer.id) return r
          return { ...r, children: [...(r.children || []), newRoom] }
        })
        return {
          ...s,
          roomSeq: nextSeq,
          rooms:   { ...s.rooms, [floorKey]: nextList },
        }
      }
      return {
        ...s,
        roomSeq: nextSeq,
        rooms:   { ...s.rooms, [floorKey]: [...(s.rooms[floorKey] || []), newRoom] },
      }
    })
  }

  const selectRoom = (floorKey, id) => {
    setState(s => ({ ...s, selRoom: { floor: floorKey, id }, mode: 'props' }))
  }

  /* Mutate the currently-selected room via an updater(room) callback. */
  const updateSelectedRoom = (updater) => {
    if (readOnly) return
    setState(s => {
      if (!s.selRoom) return s
      const { floor, id } = s.selRoom
      const list = s.rooms[floor] || []
      return {
        ...s,
        rooms: {
          ...s.rooms,
          [floor]: list.map(r => r.id === id ? updater(r) : r),
        },
      }
    })
  }

  const removeSelectedRoom = () => {
    if (readOnly) return
    setState(s => {
      if (!s.selRoom) return s
      const { floor, id } = s.selRoom
      const floorList = s.rooms[floor] || []
      /* Find the target — either a top-level room OR a child inside a
         container on this floor. Track the parent container (if any)
         so we can enforce the "can't remove last required child" guard. */
      let target = null
      let parentContainer = null
      for (const r of floorList) {
        if (r.id === id) { target = r; break }
        if (Array.isArray(r.children)) {
          const child = r.children.find(c => c.id === id)
          if (child) { target = child; parentContainer = r; break }
        }
      }
      if (!target) return s
      if (parentContainer && isContainer(parentContainer.type)) {
        const requiredTypes = getContainerRequiredTypes(parentContainer.type)
        if (requiredTypes.includes(target.type)) {
          const sameTypeCount = parentContainer.children.filter(c => c.type === target.type).length
          if (sameTypeCount <= 1) return s  // deny — this is the last required child
        }
      }
      /* Recursive filter — removes at whichever level the id matches. */
      const filterList = (list) =>
        list
          .filter(r => r.id !== id)
          .map(r => Array.isArray(r.children)
            ? { ...r, children: filterList(r.children) }
            : r)
      return {
        ...s,
        rooms:   { ...s.rooms, [floor]: filterList(floorList) },
        selRoom: null,
        mode:    'rooms',
        /* If the removed room WAS the container we were inside, exit
           it — the container no longer exists. */
        selContainer: (s.selContainer && s.selContainer.id === id) ? null : s.selContainer,
      }
    })
  }

  /* Clear every room in a given area — the confirm-delete-floor path
     from the floors panel. Leaves floorsOn untouched (the floor stays
     "on"), just empties its rooms list; once empty, the checkbox
     re-enables and the user can uncheck the floor normally. If the
     selected room lived in that area, drop the selection. */
  const clearAreaRooms = (floorKey) => {
    if (readOnly) return
    setState(s => {
      const nextRooms = { ...s.rooms, [floorKey]: [] }
      let selRoom = s.selRoom
      let selContainer = s.selContainer
      if (selRoom && selRoom.floor === floorKey) selRoom = null
      /* If the container we were inside lived on this floor, exit it —
         it no longer exists after the wipe. */
      if (selContainer && selContainer.floor === floorKey) selContainer = null
      return { ...s, rooms: nextRooms, selRoom, selContainer }
    })
  }

  /* Palette "−" button: remove the LAST-ADDED room of a given type on
     the CURRENT scope (a container's children when the user has
     entered one, otherwise the floor's rooms), and only when that room
     has no properties (same test as isDetailed → sage-filled cube).
     Reuses the standard remove path — selectRoom → removeSelectedRoom
     — so the required-child guard baked into removeSelectedRoom stays
     the single source of truth. */
  const removeLastRoomOfType = (floorKey, type) => {
    if (readOnly) return
    let list
    if (state.selContainer && state.selContainer.floor === floorKey) {
      const active = getActiveContainer()
      if (!active) return
      list = active.container.children || []
    } else {
      list = state.rooms[floorKey] || []
    }
    let target = null
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].type === type) { target = list[i]; break }
    }
    if (!target) return
    if (isDetailed(target)) return
    selectRoom(floorKey, target.id)
    removeSelectedRoom()
  }

  /* Confirm-delete-floor open/close/confirm helpers. */
  const openDeleteFloorConfirm = (floorKey) => {
    if (readOnly) return
    const label = FLOOR_DEFS.find(f => f.key === floorKey)?.label || ''
    setConfirmDeleteFloor({ floorKey, label })
  }
  const closeDeleteFloorConfirm = () => setConfirmDeleteFloor(null)
  const confirmDeleteFloorAction = () => {
    if (!confirmDeleteFloor) return
    clearAreaRooms(confirmDeleteFloor.floorKey)
    setConfirmDeleteFloor(null)
  }

  /* Right-click menu action: duplicate a room in place. New id from
     the same roomSeq counter addRoom uses, so id collisions can't
     happen. Deep-copies props + freeProps so mutating the clone later
     doesn't touch the original. The per-type running number the cube
     paints comes from roomLabel() at display time — no explicit
     numbering here. */
  const duplicateRoomAt = (floorKey, roomId) => {
    if (readOnly) return
    setState(s => {
      const list = s.rooms[floorKey] || []
      const src  = list.find(r => r.id === roomId)
      if (!src) return s
      /* Recursive clone — a container's children are cloned too so
         duplicating a suite gives you a fresh suite with its own
         fresh-id copies of every child. */
      let nextSeq = s.roomSeq
      const cloneRoom = (r) => {
        const clone = {
          id:        nextSeq++,
          type:      r.type,
          sizeKey:   r.sizeKey || DEFAULT_SIZE_KEY,
          props:     { ...(r.props || {}) },
          freeProps: [...(r.freeProps || [])],
        }
        if (Array.isArray(r.children)) {
          clone.children = r.children.map(cloneRoom)
        }
        return clone
      }
      const clone = cloneRoom(src)
      return {
        ...s,
        roomSeq: nextSeq,
        rooms:   { ...s.rooms, [floorKey]: [...list, clone] },
      }
    })
  }

  /* Right-click menu handlers. The remove path REUSES the existing
     removeSelectedRoom by first calling selectRoom for the target;
     React 18 batches the two setState updaters in this event, so the
     second updater sees the first's state (selRoom already flipped
     to {floor, id}) and the filter runs on the correct target. */
  const handleMenuDuplicate = () => {
    if (!menu) return
    duplicateRoomAt(menu.floorKey, menu.roomId)
    setMenu(null)
  }
  /* Perform the actual remove — reuses removeSelectedRoom (recursive
     filter + required-child guard from Part 1). Kept as a standalone
     helper so both the immediate path and the confirmation modal
     dispatch through the same code. */
  const doRemoveRoomFromMenu = (floorKey, roomId) => {
    selectRoom(floorKey, roomId)
    removeSelectedRoom()
  }
  const handleMenuRemove = () => {
    if (!menu) return
    /* Locate the target at the FLOOR level to see if it's a container
       with children — that's the only path that needs a confirmation.
       Non-container rooms, empty containers, and container CHILDREN
       (which live nested and won't match at floor level here) all
       go straight through to the existing remove path. */
    const floorList = state.rooms[menu.floorKey] || []
    const topLevel  = floorList.find(r => r.id === menu.roomId)
    if (topLevel && isContainer(topLevel.type)
        && Array.isArray(topLevel.children) && topLevel.children.length > 0) {
      setConfirmDeleteContainer({ floorKey: menu.floorKey, roomId: menu.roomId })
      setMenu(null)
      return
    }
    doRemoveRoomFromMenu(menu.floorKey, menu.roomId)
    setMenu(null)
  }
  /* Request delete of the CURRENT container (the one the user has
     entered). Reuses the exact right-click "הסר חלל" flow: populated
     containers hit the confirmation modal; empty containers remove
     immediately. removeSelectedRoom auto-clears selContainer when the
     deleted room WAS the entered container, so no extra bookkeeping
     is needed to exit back to the floor. */
  const requestDeleteCurrentContainer = () => {
    if (readOnly) return
    const active = getActiveContainer()
    if (!active) return
    const { container, floor } = active
    if (Array.isArray(container.children) && container.children.length > 0) {
      setConfirmDeleteContainer({ floorKey: floor, roomId: container.id })
      return
    }
    doRemoveRoomFromMenu(floor, container.id)
  }

  /* Confirm modal actions. */
  const closeDeleteContainerConfirm = () => setConfirmDeleteContainer(null)
  const confirmDeleteContainerAction = () => {
    if (!confirmDeleteContainer) return
    const { floorKey, roomId } = confirmDeleteContainer
    doRemoveRoomFromMenu(floorKey, roomId)
    /* removeSelectedRoom already clears selContainer when the deleted
       room WAS the entered container, so no extra bookkeeping needed. */
    setConfirmDeleteContainer(null)
  }
  const openRoomMenu = (e, floorKey, roomId) => {
    /* Always preventDefault on cubes — the native browser context menu
       isn't useful here even in readOnly mode. But in readOnly we skip
       opening our own menu (its actions would be no-ops). */
    e.preventDefault()
    e.stopPropagation()
    if (readOnly) return
    /* Clamp position so a click near the viewport edge doesn't push
       the menu off-screen. Rough menu size 160×90; adjust if it grows. */
    const W = 160, H = 90
    let x = e.clientX
    let y = e.clientY
    if (typeof window !== 'undefined') {
      if (x + W > window.innerWidth)  x = Math.max(4, window.innerWidth  - W - 4)
      if (y + H > window.innerHeight) y = Math.max(4, window.innerHeight - H - 4)
    }
    setMenu({ x, y, floorKey, roomId })
  }

  const setPropRadio = (groupIndex, value) => {
    if (readOnly) return
    updateSelectedRoom(r => ({
      ...r,
      props: { ...r.props, ['r' + groupIndex]: value },
    }))
  }

  const togglePropCheckbox = (groupIndex, opt) => {
    if (readOnly) return
    const key = 'c' + groupIndex + '_' + opt
    updateSelectedRoom(r => ({
      ...r,
      props: { ...r.props, [key]: !r.props[key] },
    }))
  }

  const addFreeProp = (text) => {
    if (readOnly) return
    const t = (text || '').trim()
    if (!t) return
    updateSelectedRoom(r => ({ ...r, freeProps: [...(r.freeProps || []), t] }))
  }

  const removeFreeProp = (idx) => {
    if (readOnly) return
    updateSelectedRoom(r => ({
      ...r,
      freeProps: (r.freeProps || []).filter((_, i) => i !== idx),
    }))
  }

  /* ── Size-calculator mutators ────────────────────────────────────
     setRoomSize picks the L/M/S key on the currently-selected room.
     setTargetArea patches state.targetArea from the number input in
     the floors panel — accepts empty string as "clear" (null). */

  const setRoomSize = (sizeKey) => {
    if (readOnly) return
    if (!SIZE_LABELS[sizeKey]) return   // guard against garbage
    updateSelectedRoom(r => ({ ...r, sizeKey }))
  }

  /* ── Step-4 mutators ────────────────────────────────────────────
     Every setter writes into state.general via a shallow merge. This
     goes through the same setState → onChange broadcast → parent
     debounced save pipeline as every other builder mutation, so we
     inherit the existing save mechanism for free. Read-only blocks
     each writer at the door. */
  const patchGeneral = (patch) => {
    if (readOnly) return
    setState(s => ({ ...s, general: { ...s.general, ...patch } }))
  }
  const setGeneralRoof            = (v)    => patchGeneral({ roof: v })
  const setGeneralRoofNotes       = (text) => patchGeneral({ roofNotes: text })
  const setGeneralFloorHeatingNotes = (text) => patchGeneral({ floorHeatingNotes: text })
  const setGeneralElevator        = (v)    => patchGeneral({ elevator: v })
  const toggleGeneralFloorHeatingFloor = (floorKey) => {
    if (readOnly) return
    setState(s => {
      const cur = Array.isArray(s.general?.floorHeatingFloors) ? s.general.floorHeatingFloors : []
      const next = cur.includes(floorKey)
        ? cur.filter(k => k !== floorKey)
        : [...cur, floorKey]
      return { ...s, general: { ...s.general, floorHeatingFloors: next } }
    })
  }

  const setTargetArea = (raw) => {
    if (readOnly) return
    /* Number input onChange gives us a string. Empty → null (clear
       the target); non-numeric or ≤0 → also null. Otherwise store
       as a finite number so the estimate comparison is trivial. */
    if (raw === '' || raw === null || raw === undefined) {
      setState(s => ({ ...s, targetArea: null }))
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) {
      setState(s => ({ ...s, targetArea: null }))
      return
    }
    setState(s => ({ ...s, targetArea: Math.round(n) }))
  }

  /* Finish checkbox — two modes:
       * Controlled (parent supplied doneChecked + onDoneChange): the
         parent owns the flag (persisted in jsonb), we just forward
         the intended next value on toggle. Internal state.done stays
         untouched in this mode.
       * Uncontrolled (legacy): flip internal state.done and, on the
         true edge, hand the parent a fresh JSON via onDone.
     Read-only blocks either path. */
  const isControlledDone = typeof doneChecked !== 'undefined' && typeof onDoneChange === 'function'
  const toggleDone = () => {
    if (readOnly) return
    if (isControlledDone) {
      onDoneChange(!doneChecked)
      return
    }
    setState(s => {
      const next = !s.done
      const nextState = { ...s, done: next }
      if (next && typeof onDone === 'function') {
        onDone(houseToJSON(nextState))
      }
      return nextState
    })
  }

  /* ── Derived: global room label ───────────────────────────────── */
  /* Walk AREA_KEYS in order (first → ground → basement → yard) and
     within each area in insertion order, so a "מטבח" on the first
     floor is numbered before a "מטבח" on the ground floor. If only
     one of a type exists globally → just the type name; otherwise
     numbered `type N`. Same rule the summary view will use later. */
  const roomLabel = (room) => {
    let running = 0
    let ordinal = 0
    /* Running-number sequence is per underlying TYPE KEY (r.type),
       even though the visible label runs through displayType(). The
       walk RECURSES into container children so a חדר שינה inside a
       suite shares one global sequence with a חדר שינה elsewhere. */
    const visit = (r) => {
      if (r.type === room.type) {
        running += 1
        if (r.id === room.id) ordinal = running
      }
      if (Array.isArray(r.children)) {
        for (const c of r.children) visit(c)
      }
    }
    for (const areaKey of AREA_KEYS) {
      const list = state.rooms[areaKey] || []
      for (const r of list) visit(r)
    }
    const label = displayType(room.type)
    if (running <= 1) return label
    return `${label} ${ordinal}`
  }

  const isDetailed = (room) => {
    const pkeys = Object.keys(room.props || {})
    if (pkeys.length > 0) return true
    if ((room.freeProps || []).length > 0) return true
    /* Containers count as "detailed" (sage-filled cube) once they
       hold at least one child — a fresh suite with only its auto
       חדר שינה still reads as filled-in. */
    if (isContainer(room.type) && (room.children || []).length > 0) return true
    return false
  }

  const selectedRoom = state.selRoom
    ? (state.rooms[state.selRoom.floor] || []).find(r => r.id === state.selRoom.id) || null
    : null

  /* ── Live size estimate ─────────────────────────────────────────
     Flatten every room across every area into a single list of
     { type, sizeKey } so estimateArea (from the config) can sum
     them, apply the 10% circulation factor, and round.
     `exceedsTarget` fires the gentle warning banner only when the
     user has BOTH set a target AND landed above it. */
  const flatRooms = []
  /* Container rooms contribute to the estimate purely via the SUM of
     their children — the container itself has no S/M/L selector and
     isn't added to the flat list. Regular rooms add themselves.
     Fixed-area room types (FIXED_AREAS in config) emit a `fixedArea`
     field instead of a `sizeKey`; estimateArea prefers that value and
     skips the S/M/L lookup. The walk is one level deep (max nesting
     per config). */
  const walkForSize = (r) => {
    if (isContainer(r.type)) {
      for (const c of (r.children || [])) walkForSize(c)
      return
    }
    const fixed = getFixedArea(r.type)
    if (fixed != null) {
      flatRooms.push({ type: r.type, fixedArea: fixed })
      return
    }
    flatRooms.push({ type: r.type, sizeKey: r.sizeKey || DEFAULT_SIZE_KEY })
  }
  for (const areaKey of AREA_KEYS) {
    for (const r of (state.rooms[areaKey] || [])) walkForSize(r)
  }
  const hasAnyRoom    = flatRooms.length > 0
  /* Pass the runtime ROOM_SIZES so DB-sourced size overrides are
     respected. Static ROOM_SIZES is used as the fallback inside the
     helper when a type isn't present in the passed map. */
  const estimatedArea = hasAnyRoom ? estimateArea(flatRooms, { sizesMap: ROOM_SIZES }) : 0
  const targetArea    = state.targetArea
  const exceedsTarget = hasAnyRoom && typeof targetArea === 'number' && estimatedArea > targetArea

  /* ── Schematic house: build the vertical stack of items ─────────
     Roof first, then floors in FLOOR_DEFS order (skipping those that
     aren't on), then the ground line, then the yard. The ground line
     lives BETWEEN ground and basement; if there's no basement, it
     sits under the last visible floor. If nothing is on, only the
     roof renders. */
  const houseItems = []
  for (const floor of FLOOR_DEFS) {
    if (state.floorsOn[floor.key]) houseItems.push({ kind: 'floor', ...floor })
  }
  const basementIdx = houseItems.findIndex(i => i.key === 'basement')
  if (basementIdx > 0)          houseItems.splice(basementIdx, 0, { kind: 'line' })
  else if (houseItems.length)   houseItems.push({ kind: 'line' })
  if (state.yardOn)             houseItems.push({ kind: 'yard' })

  /* Desktop-only pairing: when BOTH the ground floor and the yard are
     on, the yard renders beside the ground floor (visual-LEFT of it)
     in a flex row via .hb-ground-row. If ground is off, no pairing —
     the yard falls back to the current standalone-at-end behavior on
     every viewport. Mobile ignores this flag: the standalone yard slot
     always renders (paired instance is hidden via CSS). */
  const pairYardWithGround = state.yardOn && !!state.floorsOn.ground

  /* ── Panel prop hoists ────────────────────────────────────────── */
  /* Container context — when set, the rooms panel swaps its palette
     for the container's allowed-children list and swaps existingRooms
     for the container's `children` array. */
  const activeContainer = getActiveContainer()
  const roomsPalette   = activeContainer
    ? getContainerAllowedChildren(activeContainer.container.type)
    : (state.selFloor ? getPalette(state.selFloor) : [])
  const roomsExisting  = activeContainer
    ? (activeContainer.container.children || [])
    : (state.selFloor ? (state.rooms[state.selFloor] || []) : [])
  const roomsFloorName = state.selFloor === 'yard'
    ? YARD_LABEL
    : (FLOOR_DEFS.find(f => f.key === state.selFloor)?.label || '')
  const containerLabel = activeContainer ? roomLabel(activeContainer.container) : null
  const requiredTypes = activeContainer
    ? getContainerRequiredTypes(activeContainer.container.type)
    : []

  /* ── Intro screen ───────────────────────────────────────────────
     Rendered on every fresh entry. All content comes from INTRO in
     the config — title, 3 numbered steps, footer, CTA. Dismissing it
     flips showIntro to false and reveals the split builder below. */
  if (showIntro) {
    return (
      <div className="hb-root">
        <div className="hb-intro">
          <h2 className="hb-intro-title">{INTRO.title}</h2>
          <ol className="hb-intro-steps">
            {INTRO.steps.map(step => (
              <li key={step.n}>
                <span className="hb-intro-num" aria-hidden="true">{step.n}</span>
                <div className="hb-intro-body">
                  <div className="hb-intro-step-title">{step.title}</div>
                  <div className="hb-intro-step-text">{step.text}</div>
                </div>
              </li>
            ))}
          </ol>
          <p className="hb-intro-footer">{INTRO.footer}</p>
          {/* Label hardcoded to "הכל מובן" for BOTH the first entry
              and the "איך זה עובד?" re-open path. INTRO.cta from the
              config is intentionally not read here — "בואו נתחיל"
              reads wrong on re-open (they've already started); this
              label works the same in both scenarios: dismiss and
              return to the builder in its current state. */}
          <button
            type="button"
            className="hb-btn-primary"
            onClick={() => setShowIntro(false)}
          >
            הכל מובן
          </button>
        </div>

        {/* Same finish-bar-shaped ↩ חזרה link so the client can bail
            back to the hub straight from the intro without dismissing
            it first. */}
        <div className="hb-finish">
          <button
            type="button"
            className="hb-back"
            onClick={() => {
              /* Hand the parent a fresh JSON built from CURRENT state
                 so the closure isn't stale — the parent uses it to
                 save answers.house before navigating to the hub. */
              if (typeof onBack === 'function') onBack(houseToJSON(state))
            }}
          >
            ↩ חזרה
          </button>
        </div>
      </div>
    )
  }

  /* Current mode's contextual hint — one short line above the panel
     content in every mode. Muted sage tint, not a big banner. */
  const modeHint = MODE_HINTS[state.mode] || ''

  /* Prominent panel-header title — big, bold, per mode. Sits under the
     step pills and above the muted mode-hint. In 'props' mode the room
     label uses roomLabel() so it matches the numbered label painted on
     the cube (e.g. "מטבח 2"). */
  let modeTitle = ''
  if (state.mode === 'floors') {
    modeTitle = 'בחירת מפלסים'
  } else if (state.mode === 'rooms') {
    if (activeContainer) {
      modeTitle = `${containerLabel} — חללים ביחידה`
    } else {
      modeTitle = roomsFloorName ? `חללים — ${roomsFloorName}` : 'חללים'
    }
  } else if (state.mode === 'props') {
    modeTitle = selectedRoom ? `${roomLabel(selectedRoom)} — אפיון` : 'אפיון'
  } else if (state.mode === 'general') {
    modeTitle = 'אלמנטים ומאפיינים כלליים'
  }

  return (
    <div className="hb-root">

      {/* ── Live estimate + warning ────────────────────────────
           Both appear above the split so they're visible in every
           mode. Estimate is a soft sage tint; the warning is a soft
           amber tint (gentle caution, not alarming). Both are hidden
           when there are zero rooms — nothing to estimate yet. */}
      {hasAnyRoom && (
        <div className="hb-estimate-banner" role="status">
          לפי החללים שבחרת, הבית שלך מתאים לכ-<strong>{estimatedArea}</strong> מ״ר בערך
        </div>
      )}
      {exceedsTarget && (
        <div className="hb-warning-banner" role="alert">
          שים לב — לפי החללים שבחרת, גודל הבית צפוי להיות גדול ממה שתכננת
          (כ-<strong>{estimatedArea}</strong> מ״ר מול <strong>{targetArea}</strong> מ״ר שתכננת).
        </div>
      )}

      {/* ── Split (panel-column + house) ──────────────────────── */}
      <div className="hb-split">

        {/* Panel column — DOM-first: RTL flex row paints it on the
            visual RIGHT. Wraps the small "איך זה עובד?" re-open link
            + the white action panel in one flex column so the link
            reads as attached to the panel (small gap between them,
            same right-edge alignment). On desktop this column has a
            margin-top so the panel's top lines up with the first
            floor top; on mobile the wrapper just becomes the panel
            slot below the house. */}
        <div className="hb-panel-col">
          <button
            type="button"
            className="hb-intro-reopen"
            onClick={() => setShowIntro(true)}
          >
            איך זה עובד?
          </button>
          <div className="hb-panel">

          {/* Step pills — three modes. Same visual language as the
              questionnaire step pills (filled sage when active, thin
              outline otherwise). Container is direction:rtl so DOM
              order 1→2→3 paints visually right→left. */}
          <div style={{
            display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto',
            paddingBottom: 4, direction: 'rtl',
          }}>
            {PILL_STEPS.map(({ mode, label }, i) => {
              const active = state.mode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => jumpToMode(mode)}
                  aria-current={active ? 'step' : undefined}
                  title={label}
                  style={{
                    flexShrink:   0,
                    border:       `1px solid ${active ? '#5d7259' : '#d9d6cd'}`,
                    background:   active ? '#7a9478' : '#ffffff',
                    color:        active ? '#ffffff' : '#4a4a48',
                    borderRadius: 20,
                    padding:      '5px 12px',
                    fontSize:     12,
                    cursor:       'pointer',
                    fontFamily:   'inherit',
                    whiteSpace:   'nowrap',
                  }}
                >
                  {i + 1}
                </button>
              )
            })}
          </div>

          {/* Prominent per-mode title — visually the header of the panel. */}
          <div style={{
            fontSize:     18,
            fontWeight:   700,
            color:        '#1a1a18',
            textAlign:    'right',
            marginBottom: 8,
          }}>
            {modeTitle}
          </div>

          {/* Contextual guidance — one line, muted sage. Shown above
              the panel content in every mode. */}
          {modeHint && (
            <div className="hb-mode-hint" role="note">{modeHint}</div>
          )}

          {/* Transient nudge from a pill click that couldn't complete
              (currently: jump-to-props with zero rooms). Same visual
              treatment as the mode-hint; auto-clears after ~3.5s. */}
          {nudge && (
            <div className="hb-mode-hint" role="alert">{nudge}</div>
          )}

          {state.mode === 'floors' && (
            <FloorsPanel
              floorsOn={state.floorsOn}
              yardOn={state.yardOn}
              onToggleArea={toggleArea}
              onContinue={goToRoomsFromFloors}
              canContinue={anyAreaOn}
              readOnly={readOnly}
              targetArea={state.targetArea}
              onSetTargetArea={setTargetArea}
              rooms={state.rooms}
              onRequestDeleteFloor={openDeleteFloorConfirm}
              floorDefs={FLOOR_DEFS}
              yardLabel={YARD_LABEL}
            />
          )}

          {state.mode === 'rooms' && (
            <RoomsPanel
              floorKey={state.selFloor}
              palette={roomsPalette}
              existingRooms={roomsExisting}
              onAddType={(type) => addRoom(state.selFloor, type)}
              onRemoveLastOfType={(type) => removeLastRoomOfType(state.selFloor, type)}
              isDetailed={isDetailed}
              readOnly={readOnly}
              /* Container context — non-null when the user has entered a
                 יחידת סוויטה / יחידת דיור. The panel then shows a back
                 control + a clickable children list so the user can
                 open any child's props (child cubes don't appear in the
                 schematic yet — that's the visual pass). */
              containerLabel={containerLabel}
              onExitContainer={exitContainer}
              onDeleteContainer={requestDeleteCurrentContainer}
              requiredTypes={requiredTypes}
              isContainerFn={isContainer}
              floorLabel={roomsFloorName}
              displayTypeFn={displayType}
            />
          )}

          {state.mode === 'props' && selectedRoom && (
            <PropsPanel
              room={selectedRoom}
              onSetRadio={setPropRadio}
              onToggleCheckbox={togglePropCheckbox}
              onAddFreeProp={addFreeProp}
              onRemoveFreeProp={removeFreeProp}
              onRemoveRoom={removeSelectedRoom}
              readOnly={readOnly}
              onSetRoomSize={setRoomSize}
              roomProps={ROOM_PROPS}
              hasFixedAreaFn={hasFixedArea}
            />
          )}

          {state.mode === 'general' && (
            <GeneralPanel
              general={state.general}
              enabledFloors={FLOOR_DEFS.filter(f => state.floorsOn[f.key])}
              onSetRoof={setGeneralRoof}
              onSetRoofNotes={setGeneralRoofNotes}
              onToggleFloorHeating={toggleGeneralFloorHeatingFloor}
              onSetFloorHeatingNotes={setGeneralFloorHeatingNotes}
              onSetElevator={setGeneralElevator}
              readOnly={readOnly}
            />
          )}

          </div>
        </div>

        {/* Schematic house — DOM-last: RTL flex row paints it on the visual LEFT */}
        <div className="hb-house">
          <Roof variant={state.general && state.general.roof} />
          {houseItems.map((item, idx) => {
            if (item.kind === 'line') {
              /* When a yard is enabled, the ground line extends visual-
                 LEFT to run under the yard too (spanning the floors
                 column + the gap + the yard). Otherwise it keeps its
                 original span (only under the floors column on desktop,
                 full container on mobile). The desktop rule lives in
                 HouseBuilder.css — mobile is already full-width by
                 default. */
              return (
                <div
                  key={`line-${idx}`}
                  className={`hb-ground-line${state.yardOn ? ' hb-ground-line--with-yard' : ''}`}
                />
              )
            }
            if (item.kind === 'yard') {
              /* Standalone yard slot. On desktop, when the ground floor
                 is ALSO on, we pair the yard beside it in the ground-row
                 wrapper below — this standalone instance is hidden on
                 desktop via .hb-yard--mobile-only. If ground floor is
                 off, no pairing happens and this slot shows everywhere. */
              return (
                <AreaBox
                  key="yard"
                  areaKey="yard"
                  label={YARD_LABEL}
                  variant="yard"
                  rooms={state.rooms.yard || []}
                  selRoom={state.selRoom}
                  isSelected={state.selFloor === 'yard'}
                  onSelectArea={() => selectArea('yard')}
                  onSelectRoom={(id) => selectOrEnterRoom('yard', id)}
                  onSelectChild={(containerId, childId) => selectChildForProps('yard', containerId, childId)}
                  activeContainerId={state.selContainer && state.selContainer.floor === 'yard' ? state.selContainer.id : null}
                  onRoomContextMenu={(e, id) => openRoomMenu(e, 'yard', id)}
                  roomLabel={roomLabel}
                  isDetailed={isDetailed}
                  extraClass={pairYardWithGround ? 'hb-yard--mobile-only' : ''}
                />
              )
            }
            /* item.kind === 'floor' — the ground floor is a special
               case: when paired with the yard, it renders inside a
               .hb-ground-row wrapper alongside a desktop-only yard
               instance (DOM order [floor, yard] paints as visual
               [right, left] under RTL flex). All other floors render
               as plain flex items in the .hb-house column. */
            if (item.key === 'ground' && pairYardWithGround) {
              return (
                <div key="ground-row" className="hb-ground-row">
                  <AreaBox
                    areaKey={item.key}
                    label={item.label}
                    variant="floor"
                    rooms={state.rooms[item.key] || []}
                    selRoom={state.selRoom}
                    isSelected={state.selFloor === item.key}
                    onSelectArea={() => selectArea(item.key)}
                    onSelectRoom={(id) => selectOrEnterRoom(item.key, id)}
                    onSelectChild={(containerId, childId) => selectChildForProps(item.key, containerId, childId)}
                    activeContainerId={state.selContainer && state.selContainer.floor === item.key ? state.selContainer.id : null}
                    onRoomContextMenu={(e, id) => openRoomMenu(e, item.key, id)}
                    roomLabel={roomLabel}
                    isDetailed={isDetailed}
                  />
                  <AreaBox
                    areaKey="yard"
                    label={YARD_LABEL}
                    variant="yard"
                    rooms={state.rooms.yard || []}
                    selRoom={state.selRoom}
                    isSelected={state.selFloor === 'yard'}
                    onSelectArea={() => selectArea('yard')}
                    onSelectRoom={(id) => selectOrEnterRoom('yard', id)}
                    onSelectChild={(containerId, childId) => selectChildForProps('yard', containerId, childId)}
                    activeContainerId={state.selContainer && state.selContainer.floor === 'yard' ? state.selContainer.id : null}
                    onRoomContextMenu={(e, id) => openRoomMenu(e, 'yard', id)}
                    roomLabel={roomLabel}
                    isDetailed={isDetailed}
                    extraClass="hb-yard--desktop-only"
                  />
                </div>
              )
            }
            return (
              <AreaBox
                key={item.key}
                areaKey={item.key}
                label={item.label}
                variant="floor"
                rooms={state.rooms[item.key] || []}
                selRoom={state.selRoom}
                isSelected={state.selFloor === item.key}
                onSelectArea={() => selectArea(item.key)}
                onSelectRoom={(id) => selectOrEnterRoom(item.key, id)}
                onSelectChild={(containerId, childId) => selectChildForProps(item.key, containerId, childId)}
                activeContainerId={state.selContainer && state.selContainer.floor === item.key ? state.selContainer.id : null}
                onRoomContextMenu={(e, id) => openRoomMenu(e, item.key, id)}
                roomLabel={roomLabel}
                isDetailed={isDetailed}
              />
            )
          })}
        </div>

      </div>

      {/* Desktop-only right-click menu on a room cube. Positioned in
          the viewport (position:fixed) at the click coordinates. */}
      {menu && (
        <div
          className="hb-context-menu"
          style={{ top: menu.y, left: menu.x }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            className="hb-context-menu-item"
            onClick={handleMenuDuplicate}
          >
            שכפל חלל
          </button>
          <button
            type="button"
            role="menuitem"
            className="hb-context-menu-item hb-context-menu-item--danger"
            onClick={handleMenuRemove}
          >
            הסר חלל
          </button>
        </div>
      )}

      {/* Confirm-delete-floor modal. Overlay dims the app; clicking the
          overlay itself (not the panel) closes as if "ביטול". Cream
          panel, charcoal text, sage-adjacent secondary + red danger
          button — matches the app's design tokens (theme.css). */}
      {confirmDeleteFloor && (
        <div
          className="hb-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hb-modal-message"
          onClick={closeDeleteFloorConfirm}
        >
          <div className="hb-modal" onClick={(e) => e.stopPropagation()}>
            <p id="hb-modal-message" className="hb-modal-message">
              אתם הולכים למחוק מפלס שלם שיש בו חללים - האם לאשר מחיקה?
            </p>
            <div className="hb-modal-actions">
              <button
                type="button"
                className="hb-modal-btn hb-modal-btn--secondary"
                onClick={closeDeleteFloorConfirm}
              >
                ביטול
              </button>
              <button
                type="button"
                className="hb-modal-btn hb-modal-btn--danger"
                onClick={confirmDeleteFloorAction}
              >
                מחק
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm-delete-container modal. Same cream/charcoal/red palette
          as the floor-deletion modal above, driven by the right-click
          "הסר חלל" on a container that still holds children. */}
      {confirmDeleteContainer && (
        <div
          className="hb-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hb-container-modal-message"
          onClick={closeDeleteContainerConfirm}
        >
          <div className="hb-modal" onClick={(e) => e.stopPropagation()}>
            <p id="hb-container-modal-message" className="hb-modal-message">
              מחיקת יחידה זו תמחק גם את כל החללים שבתוכה — לאשר?
            </p>
            <div className="hb-modal-actions">
              <button
                type="button"
                className="hb-modal-btn hb-modal-btn--secondary"
                onClick={closeDeleteContainerConfirm}
              >
                ביטול
              </button>
              <button
                type="button"
                className="hb-modal-btn hb-modal-btn--danger"
                onClick={confirmDeleteContainerAction}
              >
                מחק
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Finish bar ────────────────────────────────────────────
           Vertical order top→bottom:
             1. "שמור טיוטה" button (+ "נשמר ✓" flash) — rendered
                only when the parent passed onManualSave.
             2. Finish checkbox row + note.
             3. "↩ חזרה" back control.
           `.hb-finish` is a flex column with a 10px gap, so the
           three blocks stack vertically with even spacing. */}
      <div className="hb-finish">
        {typeof onManualSave === 'function' && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            justifyContent: 'center', flexWrap: 'wrap',
          }}>
            <button
              type="button"
              className="cp-shared-upload-btn"
              onClick={onManualSave}
              disabled={readOnly || savingDraft}
              style={{
                minWidth:  120,
                padding:   '8px 18px',
                fontSize:  13.5,
                boxSizing: 'border-box',
              }}
            >
              {savingDraft ? 'שומר...' : 'שמור טיוטה'}
            </button>
            {savedFlash && (
              <span style={{ fontSize: 13, color: '#4a7f4a', fontWeight: 500 }}>
                נשמר ✓
              </span>
            )}
          </div>
        )}

        <label className="hb-finish-check" style={readOnly ? { opacity: 0.65, cursor: 'default' } : undefined}>
          <input
            type="checkbox"
            checked={isControlledDone ? !!doneChecked : state.done}
            onChange={toggleDone}
            disabled={readOnly}
          />
          <div>
            <div className="hb-finish-title">
              לחצו כאן כאשר סיימתם לבחור את החללים ומאפיינים של הבית
            </div>
            <div className="hb-finish-sub">
              אל תדאגו, אנחנו עוד נדבר על הכל, והכל בר שינוי
            </div>
          </div>
        </label>
        <button
          type="button"
          className="hb-back"
          onClick={() => { if (typeof onBack === 'function') onBack() }}
        >
          ↩ חזרה
        </button>
      </div>

    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   Roof — SVG outline, sage stroke, driven by step-4 general.roof.
   ---------------------------------------------------------------
   The SVG uses preserveAspectRatio="none" and a 200×50 viewBox, so
   the drawing stretches horizontally to whatever width the parent
   container gives us (currently the 240px floors column on desktop,
   full-width on mobile). Yard sits OUTSIDE .hb-roof on desktop, so
   the roof never extends over it regardless of shape.
   RTL note: the SVG's own x-axis is left-to-right (physical). In an
   RTL layout, "visual RIGHT" for the user is the higher-x side, so
   x=200 is the visual RIGHT edge and x=0 is the visual LEFT edge —
   the shapes below are drawn with that in mind.
   ───────────────────────────────────────────────────────────────── */
function Roof({ variant }) {
  const common = {
    fill:            'none',
    stroke:          '#7a9478',
    strokeLinejoin:  'round',
    strokeLinecap:   'round',
    vectorEffect:    'non-scaling-stroke',
  }
  /* Symmetric overhang applied to ALL three roof shapes so the roof
     visibly protrudes a bit BEYOND the house body on each side (like
     eaves) rather than stopping flush with the wall.

     Units are SVG-units (viewBox is 200×50). The SVG stretches to fill
     the .hb-roof container which sits inside a 6px horizontal pad —
     so with viewBox x=0..200 mapping to the SVG's rendered width, x=0
     lands 6px INSIDE the visual-left wall, x=200 lands 6px INSIDE the
     visual-right wall. Extending each end by OVERHANG SVG-units
     (~1.14 real px per unit at the ~228px desktop rendered width)
     first re-covers that 6px inset, then leaves the remainder as
     actual eaves past the wall. At OVERHANG=8 that's ~3px of real
     overhang past each wall — well inside the 6px gap between the
     floors column and the paired yard so the roof never reaches the
     yard (which is anchored OUTSIDE .hb-house's roof span). */
  const OVERHANG        = 8
  /* Preserves the original gable slope (46 rise over 100 run from
     the peak at (100,4) down to (0,50) / (200,50)) so the extended
     endpoints stay on the same line — no kink at the wall. */
  const GABLE_Y_OFFSET  = OVERHANG * 46 / 100

  let shape
  if (variant === 'שטוח') {
    /* Flat roof — single thick horizontal bar across the top of the
       house. Both ends extended by OVERHANG on the same horizontal
       line so stroke thickness stays uniform end-to-end. */
    shape = (
      <line x1={-OVERHANG} y1="30" x2={200 + OVERHANG} y2="30" {...common} strokeWidth="5" />
    )
  } else if (variant === 'משולב') {
    /* Combined roof — right half is a diagonal gable slope, left half
       is a flat roof aligned with the LOWER end of the diagonal (i.e.
       the same y as where the slope meets the house edge), joined by
       a tall vertical connector at the center peak. Extended:
         diagonal-right endpoint pushed OUTWARD along its own slope
           so the angle is unchanged (no visible kink);
         flat-left endpoint pushed OUTWARD along the same y=50 line.  */
    shape = (
      <polyline
        points={`${200 + OVERHANG},${50 + GABLE_Y_OFFSET} 100,4 100,50 ${-OVERHANG},50`}
        {...common}
        strokeWidth="2"
      />
    )
  } else {
    /* 'רעפים' (tiles) — gable outline. Both sloped endpoints extended
       ALONG THE ORIGINAL SLOPE so the roof's pitch is preserved and
       the eaves just continue the line past each wall. Default when
       general.roof is unset / empty. */
    shape = (
      <polyline
        points={`${-OVERHANG},${50 + GABLE_Y_OFFSET} 100,4 ${200 + OVERHANG},${50 + GABLE_Y_OFFSET}`}
        {...common}
        strokeWidth="2"
      />
    )
  }
  return (
    <div className="hb-roof" aria-hidden="true">
      {/* overflow="visible" so the eaves drawn past x=0 / x=200
          actually render — SVGs clip at their viewport by default. */}
      <svg viewBox="0 0 200 50" preserveAspectRatio="none" overflow="visible" xmlns="http://www.w3.org/2000/svg">
        {shape}
      </svg>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   AreaBox — one floor (or the yard). Clicking the box selects the
   area; clicking a cube selects the room (stopPropagation).
   ───────────────────────────────────────────────────────────────── */
function AreaBox({
  areaKey, label, variant, rooms, selRoom, isSelected,
  onSelectArea, onSelectRoom, roomLabel, isDetailed,
  onRoomContextMenu, extraClass = '',
  /* Container-visual props (optional). When a room in `rooms` has a
     `children` array it renders as a wider bordered "unit box" (spans
     the full cube-grid row via CSS) that visually holds its child
     cubes. Clicking the unit box background enters the container
     (onSelectRoom); clicking a child cube inside it opens that
     child's props (onSelectChild). */
  onSelectChild,
  activeContainerId = null,
}) {
  const cls = (variant === 'yard' ? 'hb-yard' : 'hb-floor')
    + (isSelected ? (variant === 'yard' ? ' hb-yard--selected' : ' hb-floor--selected') : '')
    + (extraClass ? ' ' + extraClass : '')
  return (
    <div
      className={cls}
      onClick={onSelectArea}
      role="button"
      tabIndex={0}
      aria-label={label}
    >
      <div className="hb-floor-label">{label}</div>
      <div className="hb-cubes">
        {rooms.map(room => {
          const editing  = !!(selRoom && selRoom.floor === areaKey && selRoom.id === room.id)
          const detailed = isDetailed(room)
          const isContainerRoom = Array.isArray(room.children)
          if (isContainerRoom) {
            /* Unit box — wide sage-tinted frame with a small label at
               its top-right (RTL) and its children as smaller cubes
               below. Highlighted with the same orange editing frame
               when the user is currently INSIDE this container. */
            const activeUnit = activeContainerId === room.id
            const unitCls = 'hb-unit-box' + (activeUnit ? ' hb-unit-box--editing' : '')
            return (
              <div
                key={room.id}
                className={unitCls}
                onClick={(e) => { e.stopPropagation(); onSelectRoom(room.id) }}
                onContextMenu={(e) => {
                  if (onRoomContextMenu) onRoomContextMenu(e, room.id)
                }}
                role="button"
                tabIndex={0}
                aria-label={`${roomLabel(room)} — לחצו כדי להיכנס`}
              >
                <div className="hb-unit-label">{roomLabel(room)}</div>
                <div className="hb-unit-children">
                  {(room.children || []).map(child => {
                    const childEditing = !!(selRoom && selRoom.floor === areaKey && selRoom.id === child.id)
                    const childDetailed = isDetailed(child)
                    const childCls = 'hb-unit-child'
                      + (childDetailed ? ' hb-unit-child--detailed' : '')
                      + (childEditing  ? ' hb-unit-child--editing'  : '')
                    return (
                      <button
                        key={child.id}
                        type="button"
                        className={childCls}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (onSelectChild) onSelectChild(room.id, child.id)
                        }}
                        onContextMenu={(e) => {
                          if (onRoomContextMenu) onRoomContextMenu(e, child.id)
                        }}
                      >
                        {roomLabel(child)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          }
          const cubeCls = 'hb-cube'
            + (detailed ? ' hb-cube--detailed' : '')
            + (editing  ? ' hb-cube--editing'  : '')
          return (
            <button
              key={room.id}
              type="button"
              className={cubeCls}
              onClick={(e) => { e.stopPropagation(); onSelectRoom(room.id) }}
              onContextMenu={(e) => {
                if (onRoomContextMenu) onRoomContextMenu(e, room.id)
              }}
            >
              {roomLabel(room)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   FloorsPanel — pick which areas exist.
   ───────────────────────────────────────────────────────────────── */
function FloorsPanel({
  floorsOn, yardOn, onToggleArea, onContinue, canContinue,
  readOnly = false,
  targetArea = null, onSetTargetArea,
  rooms = {}, onRequestDeleteFloor,
  /* Runtime-config props — parent (HouseBuilder) pipes in FLOOR_DEFS +
     YARD_LABEL from the DB-sourced config so this panel doesn't need
     its own static import of them. */
  floorDefs, yardLabel,
}) {
  /* A floor whose rooms list is non-empty can't be unchecked directly:
     the checkbox is disabled and a red trash button appears at the
     visual-LEFT end of the row, opening a confirmation modal. */
  const floorHasRooms = (key) => (rooms[key] || []).length > 0
  return (
    <div>
      <h3 className="hb-panel-title">בחרו קומות</h3>

      {/* Optional target square-metres — sits at the top so it's the
          first thing the user sees when they open the builder. Empty
          input clears the target (no warning). */}
      <div style={{ marginBottom: 14 }}>
        <label
          htmlFor="hb-target-area"
          style={{ display: 'block', fontSize: 13, color: '#4a4a48', marginBottom: 6 }}
        >
          גודל מתוכנן (מ״ר) — אופציונלי
        </label>
        <input
          id="hb-target-area"
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          className="hb-input"
          value={targetArea == null ? '' : String(targetArea)}
          onChange={(e) => onSetTargetArea && onSetTargetArea(e.target.value)}
          readOnly={readOnly}
          placeholder="למשל 180"
          dir="rtl"
          style={{ maxWidth: 160 }}
        />
      </div>

      <p className="hb-panel-help">סמנו את המפלסים שיהיו בבית שלכם. אפשר לשנות בכל עת.</p>
      <div className="hb-check-list">
        {floorDefs.map(floor => {
          const populated = floorHasRooms(floor.key)
          /* קומת קרקע is permanent — always checked, always disabled,
             no trash button (even when it holds rooms). */
          const isGround = floor.key === 'ground'
          return (
            <div key={floor.key} className="hb-check-row" style={readOnly ? { opacity: 0.65 } : undefined}>
              <label className="hb-check">
                <input
                  type="checkbox"
                  checked={isGround ? true : !!floorsOn[floor.key]}
                  onChange={() => onToggleArea(floor.key)}
                  disabled={readOnly || populated || isGround}
                />
                <span>{floor.label}</span>
              </label>
              {populated && !isGround && (
                <button
                  type="button"
                  className="hb-floor-delete"
                  onClick={() => onRequestDeleteFloor && onRequestDeleteFloor(floor.key)}
                  disabled={readOnly}
                  aria-label={`מחיקת כל החללים ב${floor.label}`}
                  title="מחיקת כל החללים במפלס"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
        <label className="hb-check" style={readOnly ? { opacity: 0.65 } : undefined}>
          <input
            type="checkbox"
            checked={yardOn}
            onChange={() => onToggleArea('yard')}
            disabled={readOnly}
          />
          <span>{yardLabel}</span>
        </label>
      </div>
      {/* המשך stays enabled even in readOnly — it's pure navigation
          into rooms mode, not a mutation. */}
      <button
        type="button"
        className="hb-btn-primary"
        onClick={onContinue}
        disabled={!canContinue}
      >
        המשך — מילוי חללים
      </button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   RoomsPanel — for the selected floor, add rooms.
   ───────────────────────────────────────────────────────────────── */
function RoomsPanel({
  floorKey, palette, existingRooms, onAddType,
  onRemoveLastOfType, isDetailed,
  readOnly = false,
  /* Container-context props (all optional):
       containerLabel     — displayed running label of the entered
                            container (e.g. "יחידת סוויטה 2"). Non-null
                            when inside a container. Drives the
                            breadcrumb + palette scope.
       onExitContainer    — called by the breadcrumb's floor segment
                            (the current unit segment is non-clickable).
       onDeleteContainer  — called by the panel's "הסר חלל זה" button
                            (inside-container only). Fires the SAME
                            path as the right-click "הסר חלל" on a
                            container: populated → confirm modal,
                            empty → immediate delete.
       requiredTypes      — child types the container refuses to remove
                            the last-remaining of (e.g. ['חדר שינה']).
                            Disables the palette "−" for those types.
       isContainerFn(t)   — check used to hide nested-container adds
                            (defensive; config-side lists don't nest).
       floorLabel         — the current floor's display name (for the
                            clickable breadcrumb segment). */
  containerLabel = null,
  onExitContainer,
  onDeleteContainer,
  requiredTypes = [],
  isContainerFn,
  floorLabel = null,
  /* Runtime-config display mapper (type key → user-facing string). */
  displayTypeFn,
}) {
  const [customName, setCustomName] = useState('')
  const inContainer = !!containerLabel

  /* Count existing rooms of each type in the CURRENT scope (floor or
     container children). Drives the count badge on each palette row. */
  const countByType = existingRooms.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1
    return acc
  }, {})

  /* Last-added room of a given type in the CURRENT scope. Used by the
     "−" button: only removes when no props / not the last required. */
  const lastOfType = (type) => {
    for (let i = existingRooms.length - 1; i >= 0; i--) {
      if (existingRooms[i].type === type) return existingRooms[i]
    }
    return null
  }
  const isLastOfRequiredType = (target) => {
    if (!target) return false
    if (!requiredTypes || !requiredTypes.includes(target.type)) return false
    const sameCount = existingRooms.filter(r => r.type === target.type).length
    return sameCount <= 1
  }

  const submitCustom = () => {
    const t = customName.trim()
    if (!t) return
    onAddType(t)
    setCustomName('')
  }

  return (
    <div>
      {/* The mode title + step pills at the top of the panel already
          identify the active floor and provide cross-mode navigation,
          so no local heading / floors back-arrow is needed here.
          Floor switching happens by tapping a floor in the schematic
          house on the left. */}
      {inContainer && (
        <nav className="hb-breadcrumb" aria-label="נתיב ניווט">
          <button
            type="button"
            className="hb-breadcrumb-link"
            onClick={onExitContainer}
          >
            {floorLabel || 'מפלס'}
          </button>
          <span className="hb-breadcrumb-sep" aria-hidden="true">›</span>
          <span className="hb-breadcrumb-current">{containerLabel}</span>
        </nav>
      )}
      {!floorKey && !inContainer && (
        <p className="hb-panel-help">בחרו קומה בסכמה של הבית כדי להוסיף חללים.</p>
      )}

      {(floorKey || inContainer) && (
        <>
          <div className="hb-add-list">
            {palette.map(type => {
              /* Defensive: never render a nested-container "+". Config
                 doesn't list container types inside container palettes,
                 so in practice this is a no-op guard. */
              if (isContainerFn && isContainerFn(type) && inContainer) return null
              const last = lastOfType(type)
              const lastReq = isLastOfRequiredType(last)
              const canMinus = !!last && !(isDetailed && isDetailed(last)) && !lastReq
              const label = displayTypeFn ? displayTypeFn(type) : type
              return (
                <div key={type} className="hb-add-row">
                  <span className="hb-add-name">{label}</span>
                  {countByType[type] > 0 && (
                    <span className="hb-count-badge">{countByType[type]}</span>
                  )}
                  <button
                    type="button"
                    className="hb-minus"
                    onClick={() => onRemoveLastOfType && onRemoveLastOfType(type)}
                    disabled={readOnly || !canMinus}
                    aria-label={`הסר את ה${label} האחרון שנוסף`}
                    title={
                      !last
                        ? 'אין חללים מסוג זה להסרה'
                        : lastReq
                          ? 'לא ניתן להסיר — לפחות אחד מסוג זה נדרש ביחידה'
                          : (isDetailed && isDetailed(last)
                              ? 'לחלל האחרון כבר יש אפיון — להסרה השתמשו בקליק ימני'
                              : 'הסרת החלל האחרון שנוסף')
                    }
                  >−</button>
                  <button
                    type="button"
                    className="hb-plus"
                    onClick={() => onAddType(type)}
                    disabled={readOnly}
                    aria-label={`הוסף ${label}`}
                  >+</button>
                </div>
              )
            })}
          </div>

          {/* "חלל אחר" — matches the palette row layout above: same
              bordered .hb-add-row container, same height, the input
              slots into the name-area (borderless via .hb-add-input)
              and the + button sits in the identical position/style
              as every palette row. */}
          <div className="hb-add-row">
            <input
              type="text"
              className="hb-add-input"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitCustom() }}
              placeholder="חלל אחר"
              dir="rtl"
              readOnly={readOnly}
            />
            <button
              type="button"
              className="hb-plus"
              onClick={submitCustom}
              disabled={readOnly}
              aria-label="הוסף חלל אחר"
            >+</button>
          </div>

          {/* Whole-container delete — visible only while inside a
              container. Fires the SAME code path as the right-click
              "הסר חלל" on the container's unit box: populated → the
              existing confirmation modal, empty → immediate remove.
              Sized to match .hb-add-row height (13px vertical padding
              + 14px font) so it reads as another full-width panel row.
              Right-aligned text (RTL) — destructive red-text/border
              treatment inherited from .hb-btn-destructive. */}
          {inContainer && (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="hb-btn-destructive"
                onClick={onDeleteContainer}
                disabled={readOnly}
                style={{
                  padding:    '13px 14px',
                  fontSize:   14,
                  marginTop:  0,
                  textAlign:  'right',
                }}
              >
                הסר חלל זה
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   PropsPanel — edit props of the selected room.
   ───────────────────────────────────────────────────────────────── */
function PropsPanel({
  room,
  onSetRadio, onToggleCheckbox,
  onAddFreeProp, onRemoveFreeProp,
  onRemoveRoom,
  readOnly = false,
  onSetRoomSize,
  /* Runtime-config props: ROOM_PROPS map + hasFixedArea probe piped
     in from the DB-sourced config. DEFAULT_PROPS is still the static
     app-level fallback for room types with no props at all. */
  roomProps,
  hasFixedAreaFn,
}) {
  const [freePropText, setFreePropText] = useState('')
  const propsDef = (roomProps && roomProps[room.type]) || DEFAULT_PROPS

  const submitFreeProp = () => {
    const t = freePropText.trim()
    if (!t) return
    onAddFreeProp(t)
    setFreePropText('')
  }

  return (
    <div>
      {/* The mode title + step pills at the top of the panel already
          show the room label and provide back-navigation, so no
          local heading / rooms back-arrow is needed here. */}

      {/* Legend (מקרא) — three swatches for the three cube states.
          Colors are the SAME hexes used by .hb-cube / .hb-cube--detailed
          / .hb-cube--editing in HouseBuilder.css; if those change, the
          swatch classes below must be updated to match. */}
      <div className="hb-legend" role="note" aria-label="מקרא">
        <div className="hb-legend-item">
          <span className="hb-legend-swatch hb-legend-swatch--detailed" aria-hidden="true" />
          <span>חלל שאופיין</span>
        </div>
        <div className="hb-legend-item">
          <span className="hb-legend-swatch hb-legend-swatch--empty" aria-hidden="true" />
          <span>חלל שטרם אופיין</span>
        </div>
        <div className="hb-legend-item">
          <span className="hb-legend-swatch hb-legend-swatch--editing" aria-hidden="true" />
          <span>חלל פעיל לטובת אפיון</span>
        </div>
      </div>

      {/* Room-size selector — single full-width segmented control.
          DOM order [L, M, S] paints as visual [גדול | בינוני | קטן]
          under RTL (first segment on the visual RIGHT).
          Hidden entirely for FIXED-area room types (FIXED_AREAS in
          config) — those rooms don't ask the user to pick a size. */}
      {!(hasFixedAreaFn && hasFixedAreaFn(room.type)) && (
        <div className="hb-props-group" style={{ marginBottom: 12 }}>
          <div className="hb-group-title">גודל החלל</div>
          <div className="hb-segment-row" role="radiogroup" aria-label="גודל החלל">
            {SIZE_KEYS_IN_ORDER.map(k => {
              const selected = (room.sizeKey || DEFAULT_SIZE_KEY) === k
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={'hb-segment' + (selected ? ' hb-segment--selected' : '')}
                  onClick={() => onSetRoomSize && onSetRoomSize(k)}
                  disabled={readOnly}
                >
                  {SIZE_LABELS[k]}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="hb-props-groups">
        {propsDef.map((group, gi) => (
          <div key={gi} className="hb-props-group">
            {/* Radio groups with noTitle:true skip the heading — the
                option text already carries the context (e.g. "אופי
                פתוח" vs. "אופי אינטימי"). Checkbox groups (no radio,
                no noTitle) keep the heading as today. */}
            {!group.noTitle && (
              <div className="hb-group-title">{group.t}</div>
            )}
            {group.radio ? (
              /* Single-select field — segmented control. Segments are
                 equal-width (flex: 1), visually joined via internal
                 borders; the container carries the outer border and
                 rounded end-corners. Saved-value shape (props['r' + gi]
                 = option text) is unchanged. */
              <div className="hb-segment-row" role="radiogroup" aria-label={group.t}>
                {group.opts.map(opt => {
                  const selected = room.props['r' + gi] === opt
                  return (
                    <button
                      key={opt}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={'hb-segment' + (selected ? ' hb-segment--selected' : '')}
                      onClick={() => onSetRadio(gi, opt)}
                      disabled={readOnly}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            ) : (
              /* Multi-select field — unchanged .hb-chip pill layout. */
              <div className="hb-chip-row">
                {group.opts.map(opt => {
                  const key = 'c' + gi + '_' + opt
                  const selected = !!room.props[key]
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={'hb-chip' + (selected ? ' hb-chip--selected' : '')}
                      aria-pressed={selected}
                      onClick={() => onToggleCheckbox(gi, opt)}
                      disabled={readOnly}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="hb-props-group">
        <div className="hb-group-title">אפיון נוסף</div>
        <div className="hb-custom-row">
          <input
            type="text"
            className="hb-input"
            value={freePropText}
            onChange={(e) => setFreePropText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitFreeProp() }}
            placeholder="אפיון אחר"
            dir="rtl"
            readOnly={readOnly}
          />
          <button
            type="button"
            className="hb-plus"
            onClick={submitFreeProp}
            disabled={readOnly}
            aria-label="הוסף אפיון"
          >+</button>
        </div>
        {(room.freeProps || []).length > 0 && (
          <ul className="hb-freeprops">
            {(room.freeProps || []).map((fp, i) => (
              <li key={i}>
                <span>{fp}</span>
                <button
                  type="button"
                  className="hb-remove"
                  onClick={() => onRemoveFreeProp(i)}
                  disabled={readOnly}
                  aria-label={`הסר: ${fp}`}
                >×</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        className="hb-btn-destructive"
        onClick={onRemoveRoom}
        disabled={readOnly}
      >
        הסר חלל זה
      </button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   GeneralPanel — step-4 "אלמנטים ומאפיינים כלליים".
   House-level answers that don't belong to a single room / floor.
   Every field writes into state.general via the setters wired in
   HouseBuilder; the parent's debounced save picks them up like any
   other mutation. Read-only disables inputs but keeps rendering.
   ───────────────────────────────────────────────────────────────── */
function GeneralPanel({
  general,
  enabledFloors,
  onSetRoof,
  onSetRoofNotes,
  onToggleFloorHeating,
  onSetFloorHeatingNotes,
  onSetElevator,
  readOnly = false,
}) {
  const g = general || {}
  const heatingFloors = Array.isArray(g.floorHeatingFloors) ? g.floorHeatingFloors : []
  return (
    <div>
      {/* ── גג ────────────────────────────────────────────────── */}
      <div className="hb-props-group" style={{ marginBottom: 14 }}>
        <div className="hb-group-title">גג</div>
        <div className="hb-chip-row">
          {ROOF_OPTIONS.map(opt => {
            const selected = g.roof === opt
            return (
              <button
                key={opt}
                type="button"
                className={'hb-chip' + (selected ? ' hb-chip--selected' : '')}
                aria-pressed={selected}
                onClick={() => onSetRoof(selected ? null : opt)}
                disabled={readOnly}
              >
                {opt}
              </button>
            )
          })}
        </div>
        <textarea
          className="hb-input hb-textarea"
          value={g.roofNotes || ''}
          onChange={(e) => onSetRoofNotes(e.target.value)}
          placeholder="הערות"
          readOnly={readOnly}
          rows={2}
          dir="rtl"
          style={{ marginTop: 8, resize: 'vertical', minHeight: 56 }}
          aria-label="הערות על הגג"
        />
      </div>

      {/* ── חימום רצפתי ──────────────────────────────────────── */}
      <div className="hb-props-group" style={{ marginBottom: 14 }}>
        <div className="hb-group-title">חימום רצפתי</div>
        {enabledFloors.length === 0 ? (
          <p className="hb-panel-help">אין קומות פעילות בבית — סמנו קומות בשלב 1 כדי לבחור בהן חימום רצפתי.</p>
        ) : (
          <div className="hb-check-list" style={{ marginBottom: 8 }}>
            {enabledFloors.map(floor => {
              const on = heatingFloors.includes(floor.key)
              return (
                <label key={floor.key} className="hb-check" style={readOnly ? { opacity: 0.65 } : undefined}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggleFloorHeating(floor.key)}
                    disabled={readOnly}
                  />
                  <span>{floor.label}</span>
                </label>
              )
            })}
          </div>
        )}
        <textarea
          className="hb-input hb-textarea"
          value={g.floorHeatingNotes || ''}
          onChange={(e) => onSetFloorHeatingNotes(e.target.value)}
          placeholder="הערות"
          readOnly={readOnly}
          rows={2}
          dir="rtl"
          style={{ resize: 'vertical', minHeight: 56 }}
          aria-label="הערות על חימום רצפתי"
        />
      </div>

      {/* ── מעלית ────────────────────────────────────────────── */}
      <div className="hb-props-group">
        <div className="hb-group-title">מעלית</div>
        <div className="hb-chip-row">
          {[
            { label: 'כן', value: true },
            { label: 'לא', value: false },
          ].map(opt => {
            const selected = g.elevator === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                className={'hb-chip' + (selected ? ' hb-chip--selected' : '')}
                aria-pressed={selected}
                onClick={() => onSetElevator(selected ? null : opt.value)}
                disabled={readOnly}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
