// src/lib/programmingSummary.js
//
// Turns one programming_questionnaires row into a plain, render-agnostic
// description of the read-only "סיכום פרוגרמה" document.
//
// Pure: no React, no Supabase, no I/O. The page loads the row and the house
// builder config, calls buildProgrammingSummary(), and hands the result to
// ProgrammingSummaryDocument, which only draws it. Keeping every decision
// here is what lets the mapping be checked against real stored rows.
//
// ── WHAT DECIDES WHAT APPEARS ─────────────────────────────────────────────
// QUESTIONNAIRE_STEPS in programmingConfig.js, walked the same way the
// questionnaire walks it. Nothing here restates the chapter list, so a
// field removed from the questionnaire disappears from the summary too, and
// a stored answer for a field the client can no longer see is not shown.
//
// Two chapters are rendered by the questionnaire as special cases keyed on
// step.key, and are mirrored here the same way:
//   · house_general → four yes/no answers under answers.house.general
//   · inspiration   → its textarea blocks plus answers.inspirationImages,
//                     placed LAST, after the house-builder section
//
// ── THE HOUSE BUILDER ─────────────────────────────────────────────────────
// Display names, floor names and fixed-area types come from the adapted
// house_builder_config the page loads through loadHouseBuilderConfig().
// Stored room characteristics are NOT filtered against that config: every
// value in props is shown, including options the config no longer offers.
// The builder's own step-3 summary filters them and silently loses data;
// this document must not.

import { QUESTIONNAIRE_STEPS } from './programmingConfig'
import { SIZE_LABELS } from './houseSizeConfig'
/* The area order the BUILDER numbers rooms in. HouseBuilderV2 walks a fixed
   first → ground → basement → yard list (not the config's floor order) when
   it assigns "מטבח 1" / "מטבח 2"; houseBuilderConfig.js exports that same
   list, so it is imported rather than written out a second time. */
import { AREA_KEYS as BUILDER_NUMBERING_AREA_ORDER } from './houseBuilderConfig'
import {
  QUESTIONNAIRE_TILE_TITLE,
  HOUSE_BUILDER_TITLE,
  FILLING_DONE_LABEL,
  PERSON_NAME_LABEL,
  PERSON_AGE_LABEL,
  PERSON_SEX_LABEL,
  HOUSE_GENERAL_QUESTION_LABELS,
  HOUSE_GENERAL_QUESTION_KEYS,
  YES_LABEL,
  NO_LABEL,
  REQUESTED_AREA_LABEL,
  AREA_UNIT,
  FLOORS_SECTION_TITLE,
  ROOF_SECTION_TITLE,
  ROOM_CHARACTERISTICS_LABEL,
  ROOM_NOTE_LABEL,
} from './programmingLabels'

/* ── Labels owned by this document alone ─────────────────────────────────
   None of these exists anywhere else in the app, so they are defined here
   once rather than extracted. */
export const SUMMARY_TITLE          = 'סיכום פרוגרמה'
export const UNANSWERED_LABEL       = 'לא נענה'
export const CLIENTS_LABEL          = 'לקוחות'
export const UPDATED_LABEL          = 'עודכן לאחרונה'
export const NOT_DONE_LABEL         = 'טרם הסתיים המילוי'
export const ORPHANS_HEADING        = 'תשובות ללא בן בית מתאים'
export const HOUSE_EMPTY_LABEL      = 'בונה הבית טרם מולא'
export const FREE_PROPS_LABEL       = 'מאפיינים נוספים'
export const LOAD_ERROR_LABEL       = 'שגיאה בטעינת סיכום הפרוגרמה'
/* Chapter 5's answers are held in answers.house.general, which the house
   builder rewrites without these three keys — so a blank here is not proof
   the client never answered. */
export const HOUSE_GENERAL_FOOTNOTE =
  'שים לב: התשובות "חימום רצפתי", "קמין" ו"חימום מים בגז" נמחקות כאשר הלקוח עורך את בונה הבית. "לא נענה" כאן אינו בהכרח אומר שהלקוח לא ענה.'

/* The two step keys the questionnaire renders as special cases. */
const HOUSE_GENERAL_STEP_KEY = 'house_general'
const INSPIRATION_STEP_KEY   = 'inspiration'

/* V1's per-option checkbox props shape: props['c<group>_<option>'] = true.
   Documented in houseBuilderConfig.js; the option name is in the key. */
const LEGACY_CHECKBOX_PROP_KEY = /^c\d+_(.+)$/

/* ── Small helpers ───────────────────────────────────────────────────────── */

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}

/* Unanswered = undefined, null, a string with no visible characters, or an
   empty array. */
function isBlank(v) {
  if (v === undefined || v === null) return true
  if (typeof v === 'string') return v.trim() === ''
  if (Array.isArray(v)) return v.length === 0
  return false
}

/* A displayable answer, or null for unanswered. Line breaks inside the
   answer are kept; only the outer whitespace is trimmed. */
function answerText(v) {
  if (isBlank(v)) return null
  return typeof v === 'string' ? v.trim() : String(v)
}

/* DD/MM/YYYY, matching the date format used elsewhere in the app. */
function formatDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()}`
}

/* Only http(s) URLs are allowed to become a link or an image source.
   answers is client-writable jsonb, so a stored "javascript:" URL must never
   reach an href that a staff member will click. */
function isSafeHttpUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
  try { new URL(url); return true } catch { return false }
}

const field = (label, value) => ({ kind: 'field', label, value })

/* ── Questionnaire blocks (everything except the people block) ──────────── */

function blockItems(block, q) {
  switch (block.type) {
    case 'textareas': {
      const bag = asObject(q[block.store])
      return (block.items || []).map(item => field(item.label, answerText(bag[item.key])))
    }
    case 'options': {
      /* Deselected chips stay in the object as `false`, so selection is
         strictly `=== true` — never "the key exists". Listed in the
         config's option order, which is the order the client saw. */
      const bag = asObject(q[block.store])
      const selected = (block.options || [])
        .filter(([, optKey]) => bag[optKey] === true)
        .map(([label]) => label)
      return [field(block.sectionLabel, selected.length ? selected.join(', ') : null)]
    }
    case 'textarea':
      return [field(block.label, answerText(q[block.key]))]
    default:
      return []
  }
}

/* ── Chapter 1: people, with their per-person answers folded in ─────────── */

function personItems(q, perPersonFields) {
  const people = Array.isArray(q.people) ? q.people : []
  return people.map(raw => {
    const p = asObject(raw)
    const name = typeof p.name === 'string' ? p.name : ''
    const named = name.trim() !== ''
    const fields = [
      field(PERSON_AGE_LABEL, answerText(p.age)),
      field(PERSON_SEX_LABEL, answerText(p.sex)),
    ]
    /* Per-person answers are stored keyed by the person's name exactly as
       typed — the questionnaire reads bag[p.name] — and are only ever
       collected for a person who has a name, so an unnamed person gets
       none here either. */
    if (named) {
      for (const f of perPersonFields) {
        fields.push(field(f.placeholder, answerText(asObject(q[f.key])[name])))
      }
    }
    return {
      kind:      'person',
      name:      named ? name.trim() : null,
      nameLabel: PERSON_NAME_LABEL,
      fields,
    }
  })
}

/* Per-person answers whose stored name matches nobody in people[] — left
   behind when a person is renamed. Listed, never dropped. */
function orphanItem(q, perPersonFields) {
  const people = Array.isArray(q.people) ? q.people : []
  const knownNames = new Set(
    people
      .map(p => asObject(p).name)
      .filter(n => typeof n === 'string' && n.trim() !== '')
  )
  const byName = new Map()
  for (const f of perPersonFields) {
    for (const [storedName, value] of Object.entries(asObject(q[f.key]))) {
      if (knownNames.has(storedName)) continue
      const text = answerText(value)
      if (text === null) continue
      if (!byName.has(storedName)) byName.set(storedName, [])
      byName.get(storedName).push(field(f.placeholder, text))
    }
  }
  if (byName.size === 0) return null
  return {
    kind:    'orphans',
    heading: ORPHANS_HEADING,
    entries: [...byName].map(([name, fields]) => ({
      name: name.trim() !== '' ? name.trim() : null,
      fields,
    })),
  }
}

/* ── Chapter 5: החלטות כלליות לבית ─────────────────────────────────────── */

function houseGeneralChapter(step, answers) {
  const general = asObject(asObject(answers.house).general)
  const legacyHeatingFloors = Array.isArray(general.floorHeatingFloors) ? general.floorHeatingFloors : []
  const items = HOUSE_GENERAL_QUESTION_KEYS.map(key => {
    let v = (general[key] === true || general[key] === false) ? general[key] : null
    /* Mirrors HouseGeneralSection: floor heating with no boolean yet reads
       as "yes" when the legacy per-floor list is non-empty. */
    if (v === null && key === 'floorHeating' && legacyHeatingFloors.length > 0) v = true
    return field(
      HOUSE_GENERAL_QUESTION_LABELS[key],
      v === true ? YES_LABEL : v === false ? NO_LABEL : null,
    )
  })
  return { key: step.key, title: step.title, items, footnote: HOUSE_GENERAL_FOOTNOTE }
}

/* ── Inspiration (rendered last) ───────────────────────────────────────── */

function inspirationSection(step, answers, q) {
  const items = []
  for (const block of step.blocks || []) items.push(...blockItems(block, q))
  const images = (Array.isArray(answers.inspirationImages) ? answers.inspirationImages : [])
    .map(asObject)
    .filter(img => !isBlank(img.url) || !isBlank(img.fileName))
    .map(img => ({
      /* An image whose URL is not http(s) keeps its file name on the page
         but gets no thumbnail and no link. */
      url:      isSafeHttpUrl(img.url) ? img.url : null,
      fileName: typeof img.fileName === 'string' && img.fileName.trim() !== '' ? img.fileName : null,
    }))
  return { title: step.title, items, images }
}

/* ── House builder ─────────────────────────────────────────────────────── */

/* Same validity test houseFromJSON applies: a room needs a non-empty string
   type. The builder drops anything else on load, children included. */
const isValidRoom = (r) =>
  r && typeof r === 'object' && typeof r.type === 'string' && r.type !== ''

/* Every stored characteristic, in stored order, never filtered against the
   config. Handles today's shape (an array per group) and both legacy
   shapes: a single-choice string, and V1's per-option `true` booleans. */
function collectCharacteristics(props) {
  const p = asObject(props)
  const out = []
  const keys = Object.keys(p).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  for (const key of keys) {
    const v = p[key]
    if (Array.isArray(v)) {
      for (const x of v) {
        if ((typeof x === 'string' && x.trim() !== '') || typeof x === 'number') {
          out.push(String(x).trim())
        }
      }
    } else if (typeof v === 'string') {
      if (v.trim() !== '') out.push(v.trim())
    } else if (v === true) {
      const m = LEGACY_CHECKBOX_PROP_KEY.exec(key)
      if (m) out.push(m[1])
    }
  }
  return out
}

function houseSection(answers, config) {
  const house = asObject(answers.house)
  const rooms = asObject(house.rooms)
  const general = asObject(house.general)

  const hasRooms   = Object.values(rooms).some(list => Array.isArray(list) && list.length > 0)
  const hasFloors  = !!(house.floors && typeof house.floors === 'object' && !Array.isArray(house.floors))
  const hasYardKey = Object.prototype.hasOwnProperty.call(house, 'yard')
  const hasTarget  = house.targetArea !== undefined && house.targetArea !== null
  const hasRoof    = !isBlank(general.roof)

  /* A house object carrying only `general` is chapter 5's answers, not
     house-builder data, so it counts as an empty builder. */
  if (!hasRooms && !hasFloors && !hasYardKey && !hasTarget && !hasRoof) {
    return { title: HOUSE_BUILDER_TITLE, empty: true, emptyText: HOUSE_EMPTY_LABEL }
  }

  const floorDefs   = Array.isArray(config && config.FLOOR_DEFS) ? config.FLOOR_DEFS : []
  const areaKeys    = Array.isArray(config && config.AREA_KEYS) ? config.AREA_KEYS : []
  const displayType = (config && typeof config.displayType === 'function') ? config.displayType : (t) => t
  const hasFixedArea = (config && typeof config.hasFixedArea === 'function') ? config.hasFixedArea : () => false

  /* The config's floors: interior floors are in FLOOR_DEFS; the yard is the
     one config area that is not. */
  const isYardArea = (k) => areaKeys.includes(k) && !floorDefs.some(f => f.key === k)
  const areaLabel = (k) => {
    const def = floorDefs.find(f => f.key === k)
    if (def) return def.label
    if (isYardArea(k)) return (config && config.YARD_LABEL) || k
    return k
  }

  const lines = []

  if (hasTarget) {
    /* The raw stored number, deliberately not turned back into the range
       the client may have picked. */
    lines.push({ label: REQUESTED_AREA_LABEL, value: `${house.targetArea} ${AREA_UNIT}` })
  }

  const floorsObj = asObject(house.floors)
  const chosen = []
  for (const k of areaKeys) {
    const on = isYardArea(k) ? house.yard === true : floorsObj[k] === true
    if (on) chosen.push(areaLabel(k))
  }
  /* A floor key the active config does not know is still shown. */
  for (const [k, v] of Object.entries(floorsObj)) {
    if (v === true && !areaKeys.includes(k)) chosen.push(k)
  }
  lines.push({ label: FLOORS_SECTION_TITLE, value: chosen.length ? chosen.join(', ') : null })

  if (hasRoof) lines.push({ label: ROOF_SECTION_TITLE, value: answerText(general.roof) })

  /* Room numbering, exactly as HouseBuilderV2's roomLabelById: count each
     TYPE across the whole house — every area, nested rooms included,
     depth-first in the builder's fixed area order — and number a type only
     when it occurs more than once. */
  const seenByType = new Map()
  const visit = (r) => {
    if (!isValidRoom(r)) return
    if (!seenByType.has(r.type)) seenByType.set(r.type, [])
    seenByType.get(r.type).push(r)
    if (Array.isArray(r.children)) r.children.forEach(visit)
  }
  for (const k of BUILDER_NUMBERING_AREA_ORDER) {
    (Array.isArray(rooms[k]) ? rooms[k] : []).forEach(visit)
  }
  const labelByRoom = new Map()
  for (const [type, list] of seenByType) {
    if (list.length <= 1) labelByRoom.set(list[0], displayType(type))
    else list.forEach((r, i) => labelByRoom.set(r, `${displayType(type)} ${i + 1}`))
  }

  const buildRoom = (raw) => {
    const r = asObject(raw)
    const valid = isValidRoom(r)
    const label = labelByRoom.get(raw) || (valid ? displayType(r.type) : null)

    const details = []
    if (!(valid && hasFixedArea(r.type)) && Object.prototype.hasOwnProperty.call(SIZE_LABELS, r.sizeKey)) {
      details.push({ label: null, value: SIZE_LABELS[r.sizeKey] })
    }
    const chars = collectCharacteristics(r.props)
    if (chars.length) details.push({ label: ROOM_CHARACTERISTICS_LABEL, value: chars.join(', ') })
    const free = (Array.isArray(r.freeProps) ? r.freeProps : [])
      .filter(x => typeof x === 'string' && x.trim() !== '')
      .map(x => x.trim())
    if (free.length) details.push({ label: FREE_PROPS_LABEL, value: free.join(', ') })
    if (typeof r.note === 'string' && r.note.trim() !== '') {
      details.push({ label: ROOM_NOTE_LABEL, value: r.note.trim(), multiline: true })
    }

    return {
      label,
      details,
      children: (Array.isArray(r.children) ? r.children : []).map(buildRoom),
    }
  }

  /* Areas in the config's floor order, then any stored area the config
     does not list — shown, not dropped. */
  const areaOrder = [...areaKeys, ...Object.keys(rooms).filter(k => !areaKeys.includes(k))]
  const areas = []
  for (const k of areaOrder) {
    const list = Array.isArray(rooms[k]) ? rooms[k] : []
    if (list.length === 0) continue
    areas.push({ key: k, label: areaLabel(k), rooms: list.map(buildRoom) })
  }

  return { title: HOUSE_BUILDER_TITLE, empty: false, lines, areas }
}

/* ── Entry point ───────────────────────────────────────────────────────── */

/**
 * @param {object}      args
 * @param {string}      args.projectName
 * @param {Array}       args.contacts   project_contacts rows { first_name, last_name }
 * @param {object|null} args.row        programming_questionnaires row { answers, updated_at }, or null
 * @param {object}      args.config     the adapted config from loadHouseBuilderConfig()
 */
export function buildProgrammingSummary({ projectName, contacts, row, config }) {
  const answers = asObject(row && row.answers)
  const q = asObject(answers.questionnaire)
  const meta = asObject(answers.meta)

  const clientNames = (Array.isArray(contacts) ? contacts : [])
    .map(c => [c && c.first_name, c && c.last_name]
      .map(s => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .join(' '))
    .filter(Boolean)

  const perPersonFields = []
  for (const step of QUESTIONNAIRE_STEPS) {
    for (const block of step.blocks || []) {
      if (block.type === 'per_person') perPersonFields.push(...(block.fields || []))
    }
  }

  const chapters = []
  let inspiration = null
  for (const step of QUESTIONNAIRE_STEPS) {
    if (step.key === INSPIRATION_STEP_KEY) {
      inspiration = inspirationSection(step, answers, q)
      continue
    }
    if (step.key === HOUSE_GENERAL_STEP_KEY) {
      chapters.push(houseGeneralChapter(step, answers))
      continue
    }

    const blocks = step.blocks || []
    /* A chapter made only of per-person blocks is shown inside the people
       chapter, under each person, so it gets no second, empty chapter. */
    if (blocks.length > 0 && blocks.every(b => b.type === 'per_person')) continue

    const items = []
    let hasPeopleBlock = false
    for (const block of blocks) {
      if (block.type === 'people') {
        hasPeopleBlock = true
        items.push(...personItems(q, perPersonFields))
      } else if (block.type !== 'per_person') {
        items.push(...blockItems(block, q))
      }
    }
    if (hasPeopleBlock) {
      const orphans = orphanItem(q, perPersonFields)
      if (orphans) items.push(orphans)
    }
    chapters.push({ key: step.key, title: step.title, items })
  }

  return {
    title:       SUMMARY_TITLE,
    projectName: projectName || '',
    clientNames,
    updatedAt:   formatDate(row && row.updated_at),
    completion: [
      { label: QUESTIONNAIRE_TILE_TITLE, value: meta.questionnaire_done === true ? FILLING_DONE_LABEL : NOT_DONE_LABEL },
      { label: HOUSE_BUILDER_TITLE,      value: meta.house_done === true ? FILLING_DONE_LABEL : NOT_DONE_LABEL },
    ],
    chapters,
    house: houseSection(answers, config),
    inspiration,
  }
}
