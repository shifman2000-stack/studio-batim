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
// ── THE SHAPE IS DENSE ────────────────────────────────────────────────────
// The document is built from LINES, never from a label on one line and its
// value on the next. Each chapter is a list of one-line blocks, then one
// muted line naming whatever in that chapter was left unanswered. A chapter
// with nothing answered at all collapses to a single line.
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
// A chapter made only of per-person blocks (תעסוקה ותחביבים) has no chapter
// of its own: each person's answers join that person's line in chapter 1.
//
// ── THE HOUSE BUILDER ─────────────────────────────────────────────────────
// Display names, floor names and fixed-area types come from the adapted
// house_builder_config the page loads through loadHouseBuilderConfig().
// Stored room characteristics are NOT filtered against that config: every
// value in props is shown, including options the config no longer offers.
// The builder's own step-3 summary filters them and silently loses data;
// this document must not.

import { QUESTIONNAIRE_STEPS, SEX_OPTIONS } from './programmingConfig'
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
  PERSON_AGE_LABEL,
  HOUSE_GENERAL_QUESTION_KEYS,
  HOUSE_GENERAL_SHORT_LABELS,
  YES_LABEL,
  NO_LABEL,
  AREA_UNIT,
  ROOF_SECTION_TITLE,
} from './programmingLabels'

/* ── Labels owned by this document alone ─────────────────────────────────
   None of these exists anywhere else in the app, so they are defined here
   once rather than extracted. */
export const SUMMARY_TITLE          = 'סיכום פרוגרמה'
export const CLIENTS_LABEL          = 'לקוחות'
export const UPDATED_LABEL          = 'עודכן לאחרונה'
export const NOT_DONE_LABEL         = 'טרם הסתיים המילוי'
export const UNANSWERED_LIST_LABEL  = 'לא נענו'
export const NOTHING_ANSWERED_LABEL = 'לא נענה דבר בפרק זה'
export const PERSON_EMPTY_LABEL     = 'לא מולא'
export const ORPHANS_LABEL          = 'תשובות ללא בן בית מתאים'
export const HOUSE_EMPTY_LABEL      = 'בונה הבית טרם מולא'
export const IMAGES_LABEL           = 'תמונות'
export const TARGET_AREA_SHORT_LABEL = 'שטח מבוקש'
export const FLOORS_SHORT_LABEL     = 'קומות'
export const LOAD_ERROR_LABEL       = 'שגיאה בטעינת סיכום הפרוגרמה'
/* Chapter 5's unanswered mark — a dash, since the four answers sit together
   on one line rather than being moved to the unanswered list. */
export const UNANSWERED_MARK        = '—'

/* Chapter 5's answers live in answers.house.general, which the house
   builder rewrites without these three keys — so a blank there is not proof
   the client never answered. Built from the same short labels the chapter
   line uses, so the two can never disagree. */
const S = HOUSE_GENERAL_SHORT_LABELS
export const HOUSE_GENERAL_FOOTNOTE =
  `שים לב: התשובות "${S.floorHeating}", "${S.fireplace}" ו"${S.gasWaterHeating}" נמחקות כאשר הלקוח עורך את בונה הבית. "לא נענה" כאן אינו בהכרח אומר שהלקוח לא ענה.`

/* Short display forms for config fields whose full label is a whole
   question. Keyed by the config's own key/store, so a field not listed here
   simply keeps its config label. */
const SHORT_FIELD_LABELS = {
  composition: 'הרכב הבית',
  pets:        'בעלי חיים',
  arch:        'אלמנטים אדריכליים',
}

/* "בן 31-45" / "בת 31-45". The stored sex values are programmingConfig's
   SEX_OPTIONS: [0] male, [1] female. A person with any other value (none,
   or the legacy "לא לציין") gets the neutral "גיל 31-45" instead. */
const MALE_SEX = SEX_OPTIONS[0]
const FEMALE_SEX = SEX_OPTIONS[1]
const AGE_WORD_MALE = 'בן'
const AGE_WORD_FEMALE = 'בת'

/* The two step keys the questionnaire renders as special cases. */
const HOUSE_GENERAL_STEP_KEY = 'house_general'
const INSPIRATION_STEP_KEY   = 'inspiration'

/* V1's per-option checkbox props shape: props['c<group>_<option>'] = true.
   Documented in houseBuilderConfig.js; the option name is in the key. */
const LEGACY_CHECKBOX_PROP_KEY = /^c\d+_(.+)$/

/* A line ending in sentence punctuation. */
const SENTENCE_END = /[.!?…]$/

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

const lines = (s) => String(s).split(/\r?\n/).map(l => l.trim()).filter(Boolean)

/* Collapse any stored text onto one line, joining its lines with ", ". */
const oneLine = (s) => lines(s).join(', ')

/* A free-text answer for an inline "label: value" line. Line breaks are
   kept only when the text is genuinely several sentences — two or more of
   its lines end in sentence punctuation. Anything else (a trailing newline,
   a short list typed one item per line) flows as one line. */
function flowText(v) {
  if (isBlank(v)) return null
  if (typeof v !== 'string') return { text: String(v), multiline: false }
  const ls = lines(v)
  const sentences = ls.filter(l => SENTENCE_END.test(l)).length
  if (ls.length > 1 && sentences >= 2) return { text: ls.join('\n'), multiline: true }
  return { text: ls.join(', '), multiline: false }
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

/* A fresh chapter: blocks in order, the unanswered labels, and whether it
   ended up with nothing answered at all. */
const chapter = (key, title) => ({ key, title, blocks: [], unanswered: [], nothingAnswered: false })

/* ── Questionnaire blocks → inline lines ─────────────────────────────────── */

/* Every non-people block becomes zero or more { label, value } entries,
   value null when unanswered. */
function blockEntries(block, q) {
  switch (block.type) {
    case 'textareas': {
      const bag = asObject(q[block.store])
      return (block.items || []).map(item => ({
        label: SHORT_FIELD_LABELS[item.key] || item.label,
        value: flowText(bag[item.key]),
      }))
    }
    case 'options': {
      /* Deselected chips stay in the object as `false`, so selection is
         strictly `=== true` — never "the key exists". Listed in the
         config's option order, which is the order the client saw. */
      const bag = asObject(q[block.store])
      const selected = (block.options || [])
        .filter(([, optKey]) => bag[optKey] === true)
        .map(([label]) => label)
      return [{
        label: SHORT_FIELD_LABELS[block.store] || block.sectionLabel,
        value: selected.length ? { text: selected.join(', '), multiline: false } : null,
      }]
    }
    case 'textarea':
      return [{ label: SHORT_FIELD_LABELS[block.key] || block.label, value: flowText(q[block.key]) }]
    default:
      return []
  }
}

/* Answered entries become inline lines; unanswered ones are named in the
   chapter's closing line. */
function addEntries(ch, entries) {
  for (const e of entries) {
    if (e.value === null) ch.unanswered.push(e.label)
    else ch.blocks.push({ kind: 'inline', label: e.label, text: e.value.text, multiline: e.value.multiline })
  }
}

/* ── Chapter 1: one line per person ─────────────────────────────────────── */

function personLine(raw, q, perPersonFields) {
  const p = asObject(raw)
  const name = typeof p.name === 'string' ? p.name.trim() : ''
  const sex  = isBlank(p.sex) ? '' : String(p.sex).trim()
  const age  = isBlank(p.age) ? '' : String(p.age).trim()

  const parts = []
  if (name) parts.push(name)
  if (sex) parts.push(sex)
  if (age) {
    const word = sex === MALE_SEX ? AGE_WORD_MALE : sex === FEMALE_SEX ? AGE_WORD_FEMALE : PERSON_AGE_LABEL
    parts.push(`${word} ${age}`)
  }
  /* Per-person answers are keyed by the person's stable id. Rows saved
     before ids existed are still keyed by the name as typed, and this
     page reads the STORED row — the questionnaire's lazy migration has
     not necessarily run against it yet — so both are looked up, id
     first. Nothing is written back from here. */
  if (name) {
    for (const f of perPersonFields) {
      const bag = asObject(q[f.key])
      const v = (p.id !== undefined && p.id !== null && bag[p.id] !== undefined)
        ? bag[p.id]
        : bag[p.name]
      if (!isBlank(v)) parts.push(oneLine(v))
    }
  }

  if (parts.length === 0) return null
  /* named: parts[0] is the name (so the document can set it apart).
     empty: a name and nothing else. */
  return { kind: 'person', parts, named: !!name, empty: !!name && parts.length === 1 }
}

/* Per-person answers belonging to nobody in people[] — left behind by a
   rename on a row saved before people had stable ids. Listed, never
   dropped.

   A stored key is accounted for when it matches a person's id OR a
   person's name: the first covers migrated and newly written rows, the
   second covers legacy rows this page may still be reading. A person
   whose answers migrated correctly is therefore never listed here. */
function orphansBlock(q, perPersonFields) {
  const people = Array.isArray(q.people) ? q.people : []
  const claimed = new Set()
  for (const raw of people) {
    const p = asObject(raw)
    if (typeof p.id === 'string' && p.id !== '') claimed.add(p.id)
    if (typeof p.name === 'string' && p.name.trim() !== '') claimed.add(p.name)
  }
  const byName = new Map()
  for (const f of perPersonFields) {
    for (const [storedName, value] of Object.entries(asObject(q[f.key]))) {
      if (claimed.has(storedName) || isBlank(value)) continue
      if (!byName.has(storedName)) byName.set(storedName, [])
      byName.get(storedName).push(oneLine(value))
    }
  }
  if (byName.size === 0) return null
  return {
    kind:    'orphans',
    label:   ORPHANS_LABEL,
    entries: [...byName].map(([name, parts]) => ({ name: name.trim() || null, parts })),
  }
}

function peopleChapter(step, q, perPersonFields) {
  const ch = chapter(step.key, step.title)
  for (const block of step.blocks || []) {
    if (block.type === 'people') {
      const people = Array.isArray(q.people) ? q.people : []
      const personBlocks = people.map(p => personLine(p, q, perPersonFields)).filter(Boolean)
      if (personBlocks.length) ch.blocks.push(...personBlocks)
      else ch.unanswered.push(block.sectionLabel)
    } else if (block.type !== 'per_person') {
      addEntries(ch, blockEntries(block, q))
    }
  }
  const orphans = orphansBlock(q, perPersonFields)
  if (orphans) ch.blocks.push(orphans)
  ch.nothingAnswered = ch.blocks.length === 0
  return ch
}

/* ── Chapter 5: החלטות כלליות לבית ─────────────────────────────────────── */

function houseGeneralChapter(step, answers) {
  const ch = chapter(step.key, step.title)
  const general = asObject(asObject(answers.house).general)
  const legacyHeatingFloors = Array.isArray(general.floorHeatingFloors) ? general.floorHeatingFloors : []
  const items = HOUSE_GENERAL_QUESTION_KEYS.map(key => {
    let v = (general[key] === true || general[key] === false) ? general[key] : null
    /* Mirrors HouseGeneralSection: floor heating with no boolean yet reads
       as "yes" when the legacy per-floor list is non-empty. */
    if (v === null && key === 'floorHeating' && legacyHeatingFloors.length > 0) v = true
    return { label: HOUSE_GENERAL_SHORT_LABELS[key], value: v === true ? YES_LABEL : v === false ? NO_LABEL : null }
  })
  /* The four stay together on one line, a dash for each unanswered one,
     rather than going to the unanswered list. */
  if (items.some(i => i.value !== null)) ch.blocks.push({ kind: 'pairs', items })
  ch.nothingAnswered = ch.blocks.length === 0
  /* Kept even when nothing is answered: that is exactly the state the
     footnote explains. */
  ch.footnote = HOUSE_GENERAL_FOOTNOTE
  return ch
}

/* ── Inspiration (rendered last) ───────────────────────────────────────── */

function inspirationChapter(step, answers, q) {
  const ch = chapter(step.key, step.title)
  for (const block of step.blocks || []) addEntries(ch, blockEntries(block, q))
  const images = (Array.isArray(answers.inspirationImages) ? answers.inspirationImages : [])
    .map(asObject)
    .filter(img => !isBlank(img.url) || !isBlank(img.fileName))
    .map(img => ({
      /* An image whose URL is not http(s) keeps its file name on the page
         but gets no thumbnail and no link. */
      url:      isSafeHttpUrl(img.url) ? img.url : null,
      fileName: typeof img.fileName === 'string' && img.fileName.trim() !== '' ? img.fileName : null,
    }))
  if (images.length) ch.blocks.push({ kind: 'images', images })
  else ch.unanswered.push(IMAGES_LABEL)
  ch.nothingAnswered = ch.blocks.length === 0
  return ch
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

function houseChapter(answers, config) {
  const ch = chapter('house', HOUSE_BUILDER_TITLE)
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
    ch.nothingAnswered = true
    ch.emptyText = HOUSE_EMPTY_LABEL
    return ch
  }

  const floorDefs    = Array.isArray(config && config.FLOOR_DEFS) ? config.FLOOR_DEFS : []
  const areaKeys     = Array.isArray(config && config.AREA_KEYS) ? config.AREA_KEYS : []
  const displayType  = (config && typeof config.displayType === 'function') ? config.displayType : (t) => t
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

  /* ── The one summary line ── */
  const summary = []
  if (hasTarget) {
    /* The raw stored number, deliberately not turned back into the range
       the client may have picked. */
    summary.push({ label: TARGET_AREA_SHORT_LABEL, value: `${house.targetArea} ${AREA_UNIT}` })
  }
  if (hasRoof) summary.push({ label: ROOF_SECTION_TITLE, value: oneLine(general.roof) })
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
  summary.push({ label: FLOORS_SHORT_LABEL, value: chosen.length ? chosen.join(', ') : null })
  ch.blocks.push({ kind: 'pairs', items: summary })

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

  /* One line per room: name, (size), then characteristics, the client's
     own characteristics and the note — all on that line. */
  const buildRoom = (raw) => {
    const r = asObject(raw)
    const valid = isValidRoom(r)
    const label = labelByRoom.get(raw) || (valid ? displayType(r.type) : null)
    const size = (!(valid && hasFixedArea(r.type)) && Object.prototype.hasOwnProperty.call(SIZE_LABELS, r.sizeKey))
      ? SIZE_LABELS[r.sizeKey]
      : null
    const extras = [
      ...collectCharacteristics(r.props),
      ...(Array.isArray(r.freeProps) ? r.freeProps : [])
        .filter(x => typeof x === 'string' && x.trim() !== '')
        .map(x => x.trim()),
    ]
    const note = (typeof r.note === 'string' && r.note.trim() !== '') ? oneLine(r.note) : null
    return {
      label,
      size,
      extras,
      note,
      children: (Array.isArray(r.children) ? r.children : []).map(buildRoom),
    }
  }

  /* Floors in the config's order, then any stored area the config does not
     list — shown, not dropped. A floor with no rooms is left out. */
  const areaOrder = [...areaKeys, ...Object.keys(rooms).filter(k => !areaKeys.includes(k))]
  for (const k of areaOrder) {
    const list = Array.isArray(rooms[k]) ? rooms[k] : []
    if (list.length === 0) continue
    ch.blocks.push({ kind: 'floor', key: k, label: areaLabel(k), rooms: list.map(buildRoom) })
  }
  return ch
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
    if (step.key === INSPIRATION_STEP_KEY) { inspiration = inspirationChapter(step, answers, q); continue }
    if (step.key === HOUSE_GENERAL_STEP_KEY) { chapters.push(houseGeneralChapter(step, answers)); continue }

    const blocks = step.blocks || []
    /* A chapter made only of per-person blocks is folded into the people
       chapter's lines, so it gets no chapter of its own. */
    if (blocks.length > 0 && blocks.every(b => b.type === 'per_person')) continue

    if (blocks.some(b => b.type === 'people')) {
      chapters.push(peopleChapter(step, q, perPersonFields))
      continue
    }
    const ch = chapter(step.key, step.title)
    for (const block of blocks) addEntries(ch, blockEntries(block, q))
    ch.nothingAnswered = ch.blocks.length === 0
    chapters.push(ch)
  }
  chapters.push(houseChapter(answers, config))
  if (inspiration) chapters.push(inspiration)

  const meta_ = []
  if (clientNames.length) meta_.push({ label: CLIENTS_LABEL, value: clientNames.join(', ') })
  const updatedAt = formatDate(row && row.updated_at)
  if (updatedAt) meta_.push({ label: UPDATED_LABEL, value: updatedAt })
  meta_.push({ label: QUESTIONNAIRE_TILE_TITLE, value: meta.questionnaire_done === true ? FILLING_DONE_LABEL : NOT_DONE_LABEL })
  meta_.push({ label: HOUSE_BUILDER_TITLE,      value: meta.house_done === true ? FILLING_DONE_LABEL : NOT_DONE_LABEL })

  return {
    title:       SUMMARY_TITLE,
    projectName: projectName || '',
    meta:        meta_,
    chapters,
  }
}
