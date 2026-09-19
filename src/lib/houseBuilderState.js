// src/lib/houseBuilderState.js
//
// Pure serialisation helpers for the house builder — the bridge
// between the runtime state used by HouseBuilder.jsx and the JSONB
// shape stored under answers.house in programming_questionnaires.
//
// The stored shape is physical / hierarchical:
//   {
//     floors:     { first: bool, ground: bool, basement: bool },
//     yard:       bool,
//     rooms:      { [areaKey]: [ Room ] },
//     targetArea: number        — OMITTED when the client has none,
//     general:    { roof, roofNotes, floorHeatingFloors,
//                   floorHeatingNotes, elevator, …foreign keys }
//   }
//   Room = { type, sizeKey, props, freeProps, note, children? }
// HOUSE_JSON_KEYS below is the authoritative list of the five.
// `general` also carries keys this builder does not own — see the
// preservation note further down.
//
// Transient runtime fields (mode, selection, id, roomSeq, done) are
// NOT serialised — they exist only while the builder is mounted.
// Numbered labels ("מטבח 2") are recomputed at render time from the
// hydrated state, never stored.

import { FLOOR_DEFS, AREA_KEYS } from './houseBuilderConfig'
import { DEFAULT_SIZE_KEY } from './houseSizeConfig'

/* Accepted room-size keys — used by the hydration path to coerce
   anything unrecognised back to DEFAULT_SIZE_KEY. */
const VALID_SIZE_KEYS = new Set(['S', 'M', 'L'])

/* Room props are now UNIFORM: one key per property group holding an
   ARRAY of the selected option labels. Every option is an
   independent toggle, so a group may hold zero, one, or many.
   Normalised on READ only — houseToJSON keeps serialising whatever
   the runtime holds.

   Coercion rules (deliberately minimal, no migration machinery):
     · array  → kept, filtered to strings
     · string → wrapped as a one-element array. This is the legacy
                single-select shape, so an old saved choice survives.
     · anything else (e.g. the legacy per-option booleans) → dropped. */
function normalizeProps(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {}
  const out = {}
  for (const [k, v] of Object.entries(props)) {
    if (Array.isArray(v)) {
      out[k] = v.filter(x => typeof x === 'string')
    } else if (typeof v === 'string') {
      out[k] = [v]
    }
    /* neither → drop the entry entirely */
  }
  return out
}

/* Fresh empty builder state — the safe fallback for hydration when
   the row has no house data yet, and the base object every hydration
   spreads onto. */
function makeEmptyState() {
  return {
    mode:         'floors',
    floorsOn:     { ground: true },       // default: ground on
    yardOn:       true,                   // default: yard on
    selFloor:     null,
    rooms:        { first: [], ground: [], basement: [], yard: [] },
    selRoom:      null,
    /* Container navigation: when the user "enters" a container room
       (יחידת סוויטה / יחידת דיור), selContainer points at it and the
       rooms panel switches to operate on that room's `children`. null
       = normal floor-level view. Transient — not serialized. */
    selContainer: null,
    roomSeq:      1,
    done:         false,
    /* Optional target square-metres — null when the user hasn't
       entered one. Feeds the "you're planning bigger than X" gentle
       warning. Persisted alongside the room list. */
    targetArea:   null,
    /* Step-4 "אלמנטים ומאפיינים כלליים" — house-level toggles that
       don't belong to any single room. Every field is nullable /
       empty by default so a fresh row and a partially-filled row
       both hydrate to the same safe shape. */
    general:      makeEmptyGeneral(),
    /* Foreign keys found in the saved `general`, held aside so the
       builder can hand them back unchanged on save. Empty for a row
       that has none. See splitGeneral. */
    generalExtra: {},
  }
}

/* Safe defaults for the step-4 payload — extracted so hydration can
   reuse it when the saved row has no `general` key or has garbage
   in it. Keep in sync with GeneralPanel's field readers. */
function makeEmptyGeneral() {
  return {
    roof:               null,   // 'שטוח' | 'רעפים' | 'משולב' | null
    roofNotes:          '',
    floorHeatingFloors: [],     // FLOOR_DEFS keys, subset
    floorHeatingNotes:  '',
    elevator:           null,   // true | false | null (unset)
  }
}

/* The TOP-LEVEL keys of answers.house that houseToJSON owns — every
   key it emits, including `targetArea`, which it deliberately OMITS
   when the client has no target (see its guard below).
   That omission is meaningful: "absent" is how the builder says
   "unset". Anyone merging a fresh payload onto an older one must
   therefore drop these keys from the older object first, or clearing
   the target area would silently restore the old number. Exported so
   the merge in ClientProgrammingQuestionnaire cannot drift from what
   this file actually writes. */
export const HOUSE_JSON_KEYS = ['floors', 'yard', 'rooms', 'targetArea', 'general']

/* The ONLY keys of answers.house.general this builder owns. Anything
   else found there belongs to a different screen and is none of our
   business — see the preservation note below. Derived from the empty
   shape so the two can never drift apart. */
const MANAGED_GENERAL_KEYS = Object.keys(makeEmptyGeneral())

/* ── Preserving foreign keys in `general` ────────────────────────────
   answers.house.general is NOT exclusively ours. Questionnaire
   chapter 5 writes its own booleans into the same object, and nothing
   stops a future screen doing the same. Both halves of this codec used
   to rebuild `general` as exactly the five keys above, so every save
   from the builder silently erased whatever anyone else had put there.

   The rule now: split on hydration, re-join on serialisation. Keys we
   do not manage are lifted out into state.generalExtra and carried
   through the builder untouched — not parsed, not validated, not shown
   in the UI, and deliberately NOT inside state.general, so no panel can
   read or overwrite one by accident. houseToJSON lays them back down
   underneath the five managed keys, which win on conflict.

   This is key-agnostic on purpose: it protects any key that exists
   today and any key added later, with no list to keep in sync. */
function splitGeneral(raw) {
  const g = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
  const extra = {}
  for (const [k, v] of Object.entries(g)) {
    if (!MANAGED_GENERAL_KEYS.includes(k)) extra[k] = v
  }
  return { g, extra }
}

/**
 * Serialise runtime builder state into the JSONB shape.
 * Areas with zero rooms are OMITTED from the rooms map so the payload
 * stays small. Transient fields (id, selection, mode, seq, done) are
 * dropped.
 * @param {object} state
 * @returns {object} { floors, yard, rooms, general, targetArea? }
 */
export function houseToJSON(state) {
  const s = (state && typeof state === 'object') ? state : {}

  /* floors — always emit every key from FLOOR_DEFS with a strict
     boolean so the DB shape is predictable. */
  const floors = {}
  for (const f of FLOOR_DEFS) {
    floors[f.key] = !!(s.floorsOn && s.floorsOn[f.key])
  }

  /* rooms — omit empty areas so the payload is compact. Each room
     carries `sizeKey` for the estimate calculator alongside its
     props / freeProps. Container rooms additionally serialize their
     `children` array. The serializer is recursive and the palette
     allows exactly one container-inside-container case (יחידת סוויטה
     inside יחידת דיור), so a tree can reach two levels of nesting:
     floor → יחידת דיור → יחידת סוויטה → rooms. */
  const serializeRoom = (r) => {
    const out = {
      type:      r.type,
      sizeKey:   VALID_SIZE_KEYS.has(r.sizeKey) ? r.sizeKey : DEFAULT_SIZE_KEY,
      props:     (r.props && typeof r.props === 'object' && !Array.isArray(r.props))
                   ? r.props
                   : {},
      freeProps: Array.isArray(r.freeProps) ? [...r.freeProps] : [],
      note:      typeof r.note === 'string' ? r.note : '',
    }
    if (Array.isArray(r.children)) {
      out.children = r.children.map(serializeRoom)
    }
    return out
  }
  const rooms = {}
  for (const areaKey of AREA_KEYS) {
    const list = (s.rooms && s.rooms[areaKey]) || []
    if (list.length === 0) continue
    rooms[areaKey] = list.map(serializeRoom)
  }

  /* targetArea — only emit when a finite positive number is set;
     otherwise omit the key entirely (no null pollution in the DB). */
  const out = {
    floors,
    yard: !!s.yardOn,
    rooms,
  }
  const t = s.targetArea
  if (typeof t === 'number' && Number.isFinite(t) && t > 0) {
    out.targetArea = t
  }

  /* general — step-4 house-level answers. Always emit an object with
     a stable shape so the manager-side reader doesn't have to
     defensively check every field. Empty strings / null / [] all
     round-trip cleanly.

     Foreign keys kept aside at hydration go back FIRST, so the five
     keys below overwrite them on any collision and the emitted shape
     for a row that has no foreign keys is byte-for-byte what it was
     before this preservation existed. Should a stray foreign key have
     reached state.general anyway, splitGeneral catches it here too. */
  const { g, extra: generalFromState } = splitGeneral(s.general)
  const preserved = {
    ...((s.generalExtra && typeof s.generalExtra === 'object' && !Array.isArray(s.generalExtra))
          ? s.generalExtra
          : {}),
    ...generalFromState,
  }
  const validRoof = ['שטוח', 'רעפים', 'משולב']
  out.general = {
    ...preserved,
    roof:               validRoof.includes(g.roof) ? g.roof : null,
    roofNotes:          typeof g.roofNotes === 'string' ? g.roofNotes : '',
    floorHeatingFloors: Array.isArray(g.floorHeatingFloors)
                          ? g.floorHeatingFloors.filter(k => FLOOR_DEFS.some(f => f.key === k))
                          : [],
    floorHeatingNotes:  typeof g.floorHeatingNotes === 'string' ? g.floorHeatingNotes : '',
    elevator:           (g.elevator === true || g.elevator === false) ? g.elevator : null,
  }
  return out
}

/**
 * Hydrate a fresh builder state from the JSONB shape. Regenerates
 * transient ids from a fresh sequence (walking AREA_KEYS in order so
 * the global numbering that the render computes stays stable across
 * save/load round-trips). Missing / malformed data → sensible empty
 * defaults; never throws.
 * @param {object|null|undefined} data
 * @returns {object} full builder state
 */
export function houseFromJSON(data) {
  const initial = makeEmptyState()
  if (!data || typeof data !== 'object' || Array.isArray(data)) return initial

  const out = { ...initial }

  /* floors — honour whatever's saved verbatim (even an empty {}). */
  if (data.floors && typeof data.floors === 'object' && !Array.isArray(data.floors)) {
    const floorsOn = {}
    for (const f of FLOOR_DEFS) {
      if (data.floors[f.key] === true) floorsOn[f.key] = true
    }
    out.floorsOn = floorsOn
  }

  /* yard — a SAVED answer always wins, in either direction: `true`
     stays on, `false` stays OFF even though a fresh state now starts
     with the yard on. The default may only fill a gap, so the key has
     to actually be present before we read it — reading unconditionally
     would turn "this row predates the yard question" into a silent
     "the client said no". Mirrors how `floors` above is only applied
     when the row carries it. Value still has to be strictly true. */
  if (Object.prototype.hasOwnProperty.call(data, 'yard')) {
    out.yardOn = data.yard === true
  }

  /* rooms — fresh ids across ALL areas; walk AREA_KEYS in the SAME
     order the render's global-numbering pass uses (first → ground →
     basement → yard) so a "מטבח 1" saved on the first floor stays
     "מטבח 1" after hydration. sizeKey defaults to DEFAULT_SIZE_KEY
     when missing (so pre-calculator saves don't break).

     Container rooms hydrate their `children` recursively, to whatever
     depth the data holds (the palette allows two levels — see
     serializeRoom). A room without a `children` key loads exactly as
     before — no migration for old rows. */
  let seq = 1
  const isValidRoom = (r) =>
    r && typeof r === 'object' && typeof r.type === 'string' && r.type
  const hydrateRoom = (r) => {
    const out = {
      id:        seq++,
      type:      r.type,
      sizeKey:   VALID_SIZE_KEYS.has(r.sizeKey) ? r.sizeKey : DEFAULT_SIZE_KEY,
      props:     normalizeProps(r.props),
      freeProps: Array.isArray(r.freeProps)
                   ? r.freeProps.filter(x => typeof x === 'string')
                   : [],
      note:      typeof r.note === 'string' ? r.note : '',
    }
    if (Array.isArray(r.children)) {
      out.children = r.children.filter(isValidRoom).map(hydrateRoom)
    }
    return out
  }
  const rooms = { first: [], ground: [], basement: [], yard: [] }
  if (data.rooms && typeof data.rooms === 'object' && !Array.isArray(data.rooms)) {
    for (const areaKey of AREA_KEYS) {
      const list = Array.isArray(data.rooms[areaKey]) ? data.rooms[areaKey] : []
      rooms[areaKey] = list.filter(isValidRoom).map(hydrateRoom)
    }
  }
  out.rooms = rooms
  out.roomSeq = seq

  /* targetArea — accept a finite positive number; anything else
     (null / undefined / string / negative) → null (no target). */
  const t = data.targetArea
  out.targetArea = (typeof t === 'number' && Number.isFinite(t) && t > 0) ? t : null

  /* general — additive step-4 payload. Missing / malformed rows fall
     back to makeEmptyGeneral so old saves without `general` load
     cleanly. Filter floorHeatingFloors against FLOOR_DEFS so a
     dropped floor never resurfaces here. */
  const validRoof = ['שטוח', 'רעפים', 'משולב']
  const { g, extra } = splitGeneral(data.general)
  /* Everything in `general` we don't own, lifted out verbatim and
     parked outside state.general — the builder never touches it, and
     houseToJSON puts it back. Values are carried by reference: no
     copying, no coercion, nothing to get wrong. */
  out.generalExtra = extra
  out.general = {
    roof:               validRoof.includes(g.roof) ? g.roof : null,
    roofNotes:          typeof g.roofNotes === 'string' ? g.roofNotes : '',
    floorHeatingFloors: Array.isArray(g.floorHeatingFloors)
                          ? g.floorHeatingFloors.filter(k => FLOOR_DEFS.some(f => f.key === k))
                          : [],
    floorHeatingNotes:  typeof g.floorHeatingNotes === 'string' ? g.floorHeatingNotes : '',
    elevator:           (g.elevator === true || g.elevator === false) ? g.elevator : null,
  }

  return out
}
