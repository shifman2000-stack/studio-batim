// src/lib/programmingLabels.js
//
// Hebrew labels for the programming questionnaire and house builder that
// used to live ONLY as literals inside JSX, extracted so that more than one
// screen can show them without a second copy.
//
// The rule this file exists to enforce: one definition, every consumer
// imports it. Today's consumers are the questionnaire itself
// (ClientProgrammingQuestionnaire.jsx), the house builder (HouseBuilderV2.jsx)
// and the read-only programming summary (lib/programmingSummary.js).
//
// What is deliberately NOT here: anything already defined in
// programmingConfig.js (chapter titles, field labels, chip options),
// houseSizeConfig.js (S/M/L size labels) or the active house_builder_config
// row (floor names, room display names, property options). Those already
// have a single source; copying them here would create the drift this file
// is meant to prevent.

/* ── Questionnaire hub tiles ─────────────────────────────────────────── */
export const QUESTIONNAIRE_TILE_TITLE = 'מילוי השאלון'
export const HOUSE_BUILDER_TITLE      = 'בונה הבית'
/* The "this part is finished" status text on a hub tile. The tile appends
   its own ✓; the label itself carries no glyph. */
export const FILLING_DONE_LABEL       = 'הסתיים המילוי'

/* ── Chapter 1 — the people block's sub-field labels ─────────────────── */
export const PERSON_NAME_LABEL = 'שם'
export const PERSON_AGE_LABEL  = 'גיל'
export const PERSON_SEX_LABEL  = 'מין'

/* ── Chapter 5 — החלטות כלליות לבית ─────────────────────────────────────
   Keyed by the field each answer is stored under in
   answers.house.general, and listed in the order the chapter renders
   them. Iterate HOUSE_GENERAL_QUESTION_KEYS rather than Object.keys so
   the order is explicit, not an artefact of object insertion. */
export const HOUSE_GENERAL_QUESTION_LABELS = {
  floorHeating:    'האם מעוניינים בחימום רצפתי',
  elevator:        'האם מעוניינים במעלית',
  fireplace:       'האם מעוניינים בקמין',
  gasWaterHeating: 'האם מעוניינים בחימום מים בגז',
}
export const HOUSE_GENERAL_QUESTION_KEYS = ['floorHeating', 'elevator', 'fireplace', 'gasWaterHeating']
/* The same four as short nouns, for places that list all four on one line
   (the programming summary). Kept beside the questions they abbreviate. */
export const HOUSE_GENERAL_SHORT_LABELS = {
  floorHeating:    'חימום רצפתי',
  elevator:        'מעלית',
  fireplace:       'קמין',
  gasWaterHeating: 'חימום מים בגז',
}

export const YES_LABEL = 'כן'
export const NO_LABEL  = 'לא'

/* ── House size ──────────────────────────────────────────────────────── */
export const REQUESTED_AREA_LABEL = 'שטח הבית המבוקש'
export const AREA_UNIT            = 'מ״ר'

/* ── House builder section titles and per-room summary prefixes ─────── */
export const FLOORS_SECTION_TITLE       = 'קומות וחצר'
export const ROOF_SECTION_TITLE         = 'סוג גג'
export const ROOM_CHARACTERISTICS_LABEL = 'מאפיינים'
export const ROOM_NOTE_LABEL            = 'הערה'

/* ── Entry points to the programming summary document ───────────────── */
export const PROGRAMMING_SUMMARY_LINK_LABEL = 'הצג סיכום פרוגרמה'

/* The summary document's own route — built in one place so the two entry
   points (project settings, meetings toolbar) cannot drift apart. */
export const programmingSummaryPath = (projectId) => `/programming-summary/${projectId}`
