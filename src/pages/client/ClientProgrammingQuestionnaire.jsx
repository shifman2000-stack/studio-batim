// src/pages/client/ClientProgrammingQuestionnaire.jsx
//
// "שאלון פרוגרמה" — the FIRST client-writable screen in the app.
//
// STAGE B: the debug JSON textarea is replaced by a real multi-step
// form driven by src/lib/programmingConfig.js (QUESTIONNAIRE_STEPS).
// Answers live under answers.questionnaire in the jsonb column; the
// load/create/save pipeline from Stage A is unchanged — only the UI
// inside the row changes.
//
// Block dispatcher — every block in a step maps to a small renderer:
//   'people'      → editable list of people (known ones from
//                   project_contacts are read-only for name, editable
//                   for sex/age; manually-added are fully editable +
//                   removable). Writes → questionnaire.people[].
//   'per_person'  → for each named person, render the config's fields
//                   (input / textarea) keyed by the person's name.
//                   Writes → questionnaire.<field.key>[name].
//   'textareas'   → labelled textareas grouped under a store key.
//                   Writes → questionnaire[store][item.key].
//   'options'     → grid of toggle chips. Selected = true.
//                   Writes → questionnaire[store][optKey] = true|false.
//   'textarea'    → single labelled textarea.
//                   Writes → questionnaire[block.key].
//
// Save cadence:
//   * On every הבא / הקודם navigation.
//   * Manual "שמור טיוטה" button.
//   Debounced auto-save would be nicer, but Stage B keeps it obvious.
//
// Lock: when status === 'submitted' the whole form is read-only.
//
// House-builder (a separate feature) is NOT built here — after the
// last step is saved, a "בונה הבית — בקרוב" placeholder card renders.
//
// Prod null-safety inherited from Stage A: any error from the initial
// SELECT or fallback INSERT falls back to a "בקרוב" placeholder
// instead of crashing.

import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, isPreviewBlockedError } from '../../supabaseClient'
import { ClientContext } from '../../components/ClientRoute'
import { IconBack } from '../../components/icons/PortalIcons'
import { ActionRequiredDot } from '../../components/ActionRequiredBadge'
/* Portal navigation — used by the HUB's back-arrow to leave the
   programming module entirely. useClientNav() falls back to no-op
   handlers when there's no provider (embedded/admin usage), so it's
   safe to call unconditionally. */
import { useClientNav } from '../ClientPortal'
import { notifyClientQuestionnaireDone, notifyClientHouseDone } from '../../lib/staffNotify'
import HouseBuilderV2 from '../../components/questionnaire/HouseBuilderV2'
import { logError } from '../../lib/clientActivityLog'
import {
  QUESTIONNAIRE_STEPS,
  AGE_RANGES,
  KNOWN_PEOPLE_FALLBACK,
} from '../../lib/programmingConfig'
import { estimateArea } from '../../lib/houseSizeConfig'
import { getFallbackConfig, loadHouseBuilderConfig } from '../../lib/houseBuilderConfigSource'

/* ── Hub-tile icons (Feather-style, stroke="currentColor") ─────────
   Small inline SVGs so the hub renders without pulling in a heavier
   icon module. The tile sets the color; these inherit via
   currentColor. */
const IconDocument = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
)

const IconHouse = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
)

/* ── Empty-answers template ────────────────────────────────────────
   Every key referenced by the block renderers lives here so a fresh
   row (or a row loaded from prod without a questionnaire yet) has
   the right shape and no `undefined[…]` reads slip through. */
function makeEmptyQData() {
  return {
    people:            [],
    composition:       '',
    pets:              '',
    occ:               {},
    hob:               {},
    ls:                {},
    feel:              {},
    style:             {},
    arch:              {},
    style_notes:       '',
    inspiration_notes: '',
  }
}

/* Normalise whatever came back from the DB into the full-shape template,
   preserving any existing values. Shields the renderers from missing
   keys / wrong types. */
function normalizeQData(raw) {
  const base = makeEmptyQData()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const out = { ...base, ...raw }
  /* Coerce collection shapes so we can safely index them. */
  if (!Array.isArray(out.people))                          out.people = []
  if (!out.occ     || typeof out.occ     !== 'object')     out.occ = {}
  if (!out.hob     || typeof out.hob     !== 'object')     out.hob = {}
  if (!out.ls      || typeof out.ls      !== 'object')     out.ls = {}
  if (!out.feel    || typeof out.feel    !== 'object')     out.feel = {}
  if (!out.style   || typeof out.style   !== 'object')     out.style = {}
  if (!out.arch    || typeof out.arch    !== 'object')     out.arch = {}
  return out
}

/* Pull known people from project_contacts. If the fetch fails or
   returns nothing, fall back to KNOWN_PEOPLE_FALLBACK from the config
   (empty by default). Never throws. */
async function seedPeopleFromContacts(project_id) {
  try {
    const { data, error } = await supabase
      .from('project_contacts')
      .select('first_name')
      .eq('project_id', project_id)
      .order('id')
    if (error) return [...KNOWN_PEOPLE_FALLBACK]
    return (data || [])
      .map(c => (c.first_name || '').trim())
      .filter(Boolean)
      .map(name => ({ name, sex: '', age: '', known: true }))
  } catch (e) {
    console.warn('project_contacts seed failed:', e)
    return [...KNOWN_PEOPLE_FALLBACK]
  }
}

/* ── Shared inline styles (kept tiny, cp-* classes carry the base) ── */
/* ── The house-size sentence, and its colour, in ONE place ──
   requested = what the client typed at Step 1  (שטח הבית המבוקש)
   computed  = what the placed spaces add up to (שטח הבית המחושב)

   Exactly one case is a problem: requested < computed means the house
   came out BIGGER than they asked for. That is the only red state.
   Being under target — or matching it — is fine, and both are sage.

   Both numbers always appear, so the reader never has to hold one of
   them in their head. They arrive already rounded (estimateArea returns
   Math.round, and the target is stored rounded), so nothing is
   re-rounded here. */
const HOUSE_AREA_SAGE = '#7a9478'
const HOUSE_AREA_RED  = '#a83232'
/* Same colour as hubTileDesc — the tile's ordinary body text. */
const HOUSE_AREA_BODY = '#4a4a48'

function houseAreaMessage(comparison, requestedM2, computedM2) {
  /* No requested area at all (comparison is null exactly when
     targetArea is missing). There is nothing to compare against, so
     there is nothing to warn about: state the computed size plainly, in
     body colour. Without this the tile would render a title and nothing
     else, which reads as broken. */
  if (!comparison) {
    return { color: HOUSE_AREA_BODY, text: `שטח הבית המחושב: ${computedM2} מ״ר` }
  }
  const requested = `שטח הבית המבוקש (${requestedM2} מ״ר)`
  const computed  = `שטח הבית המחושב (${computedM2} מ״ר)`
  if (comparison === 'smaller') {
    return { color: HOUSE_AREA_RED,  text: `${requested} קטן מ${computed}` }
  }
  if (comparison === 'bigger') {
    return { color: HOUSE_AREA_SAGE, text: `${requested} גדול מ${computed}` }
  }
  return   { color: HOUSE_AREA_SAGE, text: `${requested} תואם ל${computed}` }
}

const STYLE_FIELD_LABEL = { display: 'block', fontSize: 13, color: '#4a4a48', marginBottom: 4, textAlign: 'right' }
const STYLE_INPUT       = {
  width: '100%', padding: '9px 10px', fontFamily: 'inherit', fontSize: 14,
  border: '1px solid #d9d6cd', borderRadius: 8, boxSizing: 'border-box', outline: 'none',
  background: '#fff', color: '#1a1a18', direction: 'rtl', textAlign: 'right',
}
const STYLE_TEXTAREA = {
  ...STYLE_INPUT, minHeight: 74, resize: 'vertical', lineHeight: 1.55,
}
const STYLE_LOCKED_BG = { background: '#f7f5f2' }

/* ─────────────────────────────────────────────────────────────────
   Block renderers — each takes (block, qData, updateQ, isLocked)
   and mutates the questionnaire object via updateQ (functional).
   ───────────────────────────────────────────────────────────────── */

function BlockPeople({ block, qData, updateQ, isLocked }) {
  const people = qData.people || []

  const updatePersonAt = (i, patch) => {
    updateQ(prev => ({
      ...prev,
      people: prev.people.map((p, idx) => idx === i ? { ...p, ...patch } : p),
    }))
  }
  const removeAt = (i) => {
    /* Removing a person also drops their per-person answers so the
       next step's iteration doesn't render orphan blocks with stale
       occ/hob values. */
    updateQ(prev => {
      const removed = prev.people[i]
      const name = removed?.name || ''
      const nextOcc = { ...(prev.occ || {}) }; delete nextOcc[name]
      const nextHob = { ...(prev.hob || {}) }; delete nextHob[name]
      return {
        ...prev,
        people: prev.people.filter((_, idx) => idx !== i),
        occ:    nextOcc,
        hob:    nextHob,
      }
    })
  }
  const addPerson = () => {
    updateQ(prev => ({
      ...prev,
      people: [...(prev.people || []), { name: '', sex: '', age: '', known: false }],
    }))
  }

  return (
    <div>
      {block.sectionLabel && (
        <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a18', marginBottom: 10 }}>
          {block.sectionLabel}
        </div>
      )}
      {people.length === 0 && (
        <div style={{ fontSize: 13, color: '#8a8680', marginBottom: 10 }}>
          עדיין לא הוספתם בני בית — הוסיפו את הראשון בכפתור למטה.
        </div>
      )}
      {people.map((p, i) => {
        /* Sex is stored as the same Hebrew literals we've always saved
           ('זכר' / 'נקבה'). The UI is a 2-button ז/נ toggle — anything
           else (empty, legacy 'לא לציין', etc.) shows as "neither
           button pressed" until the user picks one. */
        const isMale   = p.sex === 'זכר'
        const isFemale = p.sex === 'נקבה'
        const sexBtn = (letter, value, active) => ({
          width:        34,
          height:       38,
          padding:      0,
          background:   active ? '#7a9478' : '#ffffff',
          color:        active ? '#ffffff' : '#4a4a48',
          border:       `1px solid ${active ? '#5d7259' : '#d9d6cd'}`,
          borderRadius: 8,
          fontFamily:   'inherit',
          fontSize:     14,
          cursor:       isLocked ? 'not-allowed' : 'pointer',
          opacity:      isLocked ? 0.75 : 1,
          boxSizing:    'border-box',
          flexShrink:   0,
        })
        return (
          <div
            key={i}
            style={{
              border: '1px solid #ece8df', borderRadius: 10, padding: 10, marginBottom: 10,
              background: '#fbf9f4',
            }}
          >
            {/* Name + age + sex on ONE flex row — stays on one line all
                the way down to ~320px. Classic flexbox overflow fix:
                every flex child has `min-width: 0` so the input inside
                can shrink below its natural content width instead of
                forcing the whole row to wrap. `flex-wrap: nowrap`
                locks the row. Age is a fixed 88px slot; sex is a
                natural-width fixed pair; name flexes into the rest. */}
            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                <label style={STYLE_FIELD_LABEL}>שם</label>
                <input
                  type="text"
                  value={p.name || ''}
                  onChange={e => updatePersonAt(i, { name: e.target.value })}
                  readOnly={isLocked}
                  placeholder="שם"
                  style={{ ...STYLE_INPUT, ...(isLocked ? STYLE_LOCKED_BG : {}) }}
                />
              </div>

              <div style={{ flex: '0 0 88px', minWidth: 0 }}>
                <label style={STYLE_FIELD_LABEL}>גיל</label>
                <select
                  value={p.age || ''}
                  onChange={e => updatePersonAt(i, { age: e.target.value })}
                  disabled={isLocked}
                  style={{ ...STYLE_INPUT, padding: '9px 6px', ...(isLocked ? STYLE_LOCKED_BG : {}) }}
                >
                  <option value="">בחרו</option>
                  {AGE_RANGES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div style={{ flex: '0 0 auto', minWidth: 0 }}>
                <label style={STYLE_FIELD_LABEL}>מין</label>
                <div role="radiogroup" aria-label="מין" style={{ display: 'flex', gap: 4 }}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isMale}
                    aria-label="זכר"
                    disabled={isLocked}
                    onClick={() => updatePersonAt(i, { sex: 'זכר' })}
                    style={sexBtn('ז', 'זכר', isMale)}
                  >ז</button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isFemale}
                    aria-label="נקבה"
                    disabled={isLocked}
                    onClick={() => updatePersonAt(i, { sex: 'נקבה' })}
                    style={sexBtn('נ', 'נקבה', isFemale)}
                  >נ</button>
                </div>
              </div>
            </div>

            {!p.known && !isLocked && (
              <div style={{ marginTop: 8, textAlign: 'left' }}>
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  style={{
                    background: 'none', border: 'none', color: '#c94b4b',
                    fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer', padding: 0,
                  }}
                >
                  הסר
                </button>
              </div>
            )}
          </div>
        )
      })}
      {!isLocked && (
        <button
          type="button"
          className="cp-shared-upload-btn"
          onClick={addPerson}
        >
          {block.addLabel || '+ הוספת אדם'}
        </button>
      )}
    </div>
  )
}

function BlockPerPerson({ block, qData, updateQ, isLocked }) {
  const named = (qData.people || []).filter(p => (p.name || '').trim())
  if (named.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#8a8680' }}>
        חזרו לשלב הקודם והוסיפו בני בית כדי למלא את השדות כאן.
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {named.map((p, i) => (
        <div
          key={p.name + '::' + i}
          style={{
            border: '1px solid #ece8df', borderRadius: 10, padding: 12,
            background: '#fbf9f4',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a18', marginBottom: 8 }}>
            {p.name}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {block.fields.map(field => {
              const bag = qData[field.key] || {}
              const val = bag[p.name] || ''
              const onChange = e => {
                const nextVal = e.target.value
                updateQ(prev => ({
                  ...prev,
                  [field.key]: { ...(prev[field.key] || {}), [p.name]: nextVal },
                }))
              }
              const commonProps = {
                value: val,
                onChange,
                readOnly: isLocked,
                placeholder: field.placeholder || '',
                style: { ...(field.kind === 'textarea' ? STYLE_TEXTAREA : STYLE_INPUT),
                         ...(isLocked ? STYLE_LOCKED_BG : {}) },
              }
              return field.kind === 'textarea'
                ? <textarea key={field.key} {...commonProps} />
                : <input   key={field.key} type="text" {...commonProps} />
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function BlockTextareas({ block, qData, updateQ, isLocked }) {
  const bag = qData[block.store] || {}
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {block.items.map(item => (
        <div key={item.key}>
          <label style={STYLE_FIELD_LABEL}>{item.label}</label>
          <textarea
            value={bag[item.key] || ''}
            onChange={e => {
              const nextVal = e.target.value
              updateQ(prev => ({
                ...prev,
                [block.store]: { ...(prev[block.store] || {}), [item.key]: nextVal },
              }))
            }}
            readOnly={isLocked}
            placeholder={item.placeholder || ''}
            style={{ ...STYLE_TEXTAREA, ...(isLocked ? STYLE_LOCKED_BG : {}) }}
          />
        </div>
      ))}
    </div>
  )
}

function BlockOptions({ block, qData, updateQ, isLocked }) {
  const bag = qData[block.store] || {}
  const toggle = (optKey) => {
    if (isLocked) return
    updateQ(prev => {
      const cur = !!(prev[block.store] && prev[block.store][optKey])
      return {
        ...prev,
        [block.store]: { ...(prev[block.store] || {}), [optKey]: !cur },
      }
    })
  }
  return (
    <div>
      {block.sectionLabel && (
        <div style={{ fontWeight: 600, fontSize: 14, color: '#1a1a18', margin: '2px 0 10px' }}>
          {block.sectionLabel}
        </div>
      )}
      {/* CSS Grid with auto-fill + minmax(110px, 1fr) gives:
            * every chip within the grid the SAME width (1fr per
              column), regardless of label length — labels no longer
              size their own chip so a short "בוהו" and a long
              "עמדת טעינה חשמלית" render as equal-width pills;
            * as many columns as fit at min 110px — 2 per row at
              ~360px, more per row on wider viewports;
            * unused trailing slots stay empty (auto-fill, not
              auto-fit) so the last row's chips keep the same width
              as the rows above. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 8,
      }}>
        {block.options.map(([label, optKey]) => {
          const selected = !!bag[optKey]
          return (
            <button
              key={optKey}
              type="button"
              onClick={() => toggle(optKey)}
              disabled={isLocked}
              aria-pressed={selected}
              style={{
                background:    selected ? '#7a9478' : '#ffffff',
                color:         selected ? '#ffffff' : '#4a4a48',
                border:        `1px solid ${selected ? '#5d7259' : '#d9d6cd'}`,
                borderRadius:  20,
                padding:       '7px 10px',
                width:         '100%',           /* fill the grid column exactly */
                minWidth:      0,                /* let the grid drive size */
                textAlign:     'center',
                boxSizing:     'border-box',
                fontFamily:    'inherit',
                fontSize:      13.5,
                cursor:        isLocked ? 'not-allowed' : 'pointer',
                opacity:       isLocked ? 0.75 : 1,
                lineHeight:    1.2,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function BlockTextarea({ block, qData, updateQ, isLocked }) {
  return (
    <div>
      {block.label && <label style={STYLE_FIELD_LABEL}>{block.label}</label>}
      <textarea
        value={qData[block.key] || ''}
        onChange={e => {
          const nextVal = e.target.value
          updateQ(prev => ({ ...prev, [block.key]: nextVal }))
        }}
        readOnly={isLocked}
        placeholder={block.placeholder || ''}
        style={{ ...STYLE_TEXTAREA, ...(isLocked ? STYLE_LOCKED_BG : {}) }}
      />
    </div>
  )
}

function renderBlock(block, idx, qData, updateQ, isLocked) {
  const key = `${block.type}-${idx}-${block.key || block.store || ''}`
  switch (block.type) {
    case 'people':     return <div key={key}><BlockPeople    block={block} qData={qData} updateQ={updateQ} isLocked={isLocked} /></div>
    case 'per_person': return <div key={key}><BlockPerPerson block={block} qData={qData} updateQ={updateQ} isLocked={isLocked} /></div>
    case 'textareas':  return <div key={key}><BlockTextareas block={block} qData={qData} updateQ={updateQ} isLocked={isLocked} /></div>
    case 'options':    return <div key={key}><BlockOptions   block={block} qData={qData} updateQ={updateQ} isLocked={isLocked} /></div>
    case 'textarea':   return <div key={key}><BlockTextarea  block={block} qData={qData} updateQ={updateQ} isLocked={isLocked} /></div>
    default:
      return (
        <div key={key} style={{ fontSize: 12, color: '#c94b4b' }}>
          Unknown block type: {String(block.type)}
        </div>
      )
  }
}

/* YesNoRow — compact "כן / לא" connected segmented control paired
   with a question label above it. Toggle-off on re-click of the
   currently-selected value clears back to null (matches the
   elevator control's original behaviour). Used by
   HouseGeneralSection for the heating + elevator questions so
   both read visually identical. */
function YesNoRow({ label, value, onChange, isLocked }) {
  const setVal = (v) => {
    if (isLocked) return
    onChange(value === v ? null : v)
  }
  const selected = (value === true || value === false) ? value : null
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a18', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{
        display:      'inline-flex',
        direction:    'rtl',
        background:   '#ffffff',
        border:       '1px solid #d9d6cd',
        borderRadius: 20,
        overflow:     'hidden',
      }}>
        {[{ value: true, label: 'כן' }, { value: false, label: 'לא' }].map((opt, i) => {
          const sel = selected === opt.value
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => setVal(opt.value)}
              disabled={isLocked}
              aria-pressed={sel}
              style={{
                padding:     '6px 18px',
                background:  sel ? '#7a9478' : '#ffffff',
                color:       sel ? '#ffffff' : '#4a4a48',
                border:      'none',
                borderRight: i > 0 ? '1px solid #d9d6cd' : 'none',
                cursor:      isLocked ? 'not-allowed' : 'pointer',
                opacity:     isLocked ? 0.65 : 1,
                fontFamily:  'inherit',
                fontSize:    12.5,
                lineHeight:  1.2,
                whiteSpace:  'nowrap',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* HouseGeneralSection — bespoke renderer for the house_general
   questionnaire chapter. Reads/writes answers.house.general.* directly
   (NOT answers.questionnaire.*) so the fields keep their existing
   home in the jsonb.

   All four questions are simple yes/no:
     · general.floorHeating     (bool|null) — floor heating yes/no.
     · general.elevator         (bool|null) — elevator yes/no.
     · general.fireplace        (bool|null) — fireplace yes/no.
     · general.gasWaterHeating  (bool|null) — gas water heating yes/no.

   Legacy data compatibility: earlier versions stored heating as
   general.floorHeatingFloors (string[] of floor keys). On READ, if
   the new boolean is missing we derive it from the legacy array —
   "any floors selected" reads as true. On WRITE, only the new
   boolean is set; the old array is left untouched so nothing is
   destructively cleared. */
function HouseGeneralSection({ answers, onHouseChange, isLocked }) {
  const house    = (answers && answers.house) || {}
  const general  = house.general || {}

  const legacyHeatingFloors = Array.isArray(general.floorHeatingFloors)
    ? general.floorHeatingFloors
    : []
  const heatingValue = (general.floorHeating === true || general.floorHeating === false)
    ? general.floorHeating
    : (legacyHeatingFloors.length > 0 ? true : null)
  const elevatorValue = (general.elevator === true || general.elevator === false)
    ? general.elevator
    : null
  const fireplaceValue = (general.fireplace === true || general.fireplace === false)
    ? general.fireplace
    : null
  const gasWaterHeatingValue = (general.gasWaterHeating === true || general.gasWaterHeating === false)
    ? general.gasWaterHeating
    : null

  const patchGeneral = (partial) => {
    if (isLocked) return
    onHouseChange({
      ...house,
      general: { ...general, ...partial },
    })
  }
  const setHeating         = (v) => patchGeneral({ floorHeating:    v })
  const setElevator        = (v) => patchGeneral({ elevator:        v })
  const setFireplace       = (v) => patchGeneral({ fireplace:       v })
  const setGasWaterHeating = (v) => patchGeneral({ gasWaterHeating: v })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <YesNoRow
        label="האם מעוניינים בחימום רצפתי"
        value={heatingValue}
        onChange={setHeating}
        isLocked={isLocked}
      />
      <YesNoRow
        label="האם מעוניינים במעלית"
        value={elevatorValue}
        onChange={setElevator}
        isLocked={isLocked}
      />
      <YesNoRow
        label="האם מעוניינים בקמין"
        value={fireplaceValue}
        onChange={setFireplace}
        isLocked={isLocked}
      />
      <YesNoRow
        label="האם מעוניינים בחימום מים בגז"
        value={gasWaterHeatingValue}
        onChange={setGasWaterHeating}
        isLocked={isLocked}
      />
    </div>
  )
}

/* ── Inspiration images (last questionnaire chapter) ────────────────
   Bucket + small helpers — duplicated locally rather than imported
   from ClientSharedFiles.jsx, matching that file's own stated
   convention ("small and stable" helpers get copied, not shared). */
const INSPIRATION_BUCKET = 'questionnaire-inspiration-images'
const MAX_INSPIRATION_IMAGES = 10

function inspirationFileExt(name) {
  if (!name) return 'jpg'
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return 'jpg'
  return name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
}

function inspirationStoragePath(url) {
  const marker = `/object/public/${INSPIRATION_BUCKET}/`
  const idx = (url || '').indexOf(marker)
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length))
}

const IconTrashSmall = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

/* InspirationImagesSection — upload/grid/delete for the last
   questionnaire chapter. Any family member on the project may manage
   these (RLS on the bucket is scoped to client_users → project_id,
   not per-uploader), so unlike ClientSharedFiles' trash icon there is
   no "isOwn" gate here — every image's delete icon is visible to every
   viewer with edit access. */
function InspirationImagesSection({ images, project_id, onChange, isLocked }) {
  const list = Array.isArray(images) ? images : []
  /* Same clientCtx-only sourcing rule as the parent's logCtx (see its
     comment) — read directly here rather than threading a prop through,
     since this is the only place in the sub-tree that needs it. */
  const clientCtx = useContext(ClientContext)
  const logCtx = {
    projectId:    (clientCtx && clientCtx.project_id) || null,
    clientUserId: (clientCtx && clientCtx.id) || null,
    previewMode:  !!(clientCtx && clientCtx.previewMode),
  }
  const isMountedRef = useRef(true)
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [confirmIdx, setConfirmIdx] = useState(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const atMax = list.length >= MAX_INSPIRATION_IMAGES

  const handlePick = () => {
    if (isLocked || uploading || atMax) return
    setPageError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (isLocked || uploading || atMax) return
    if (!file.type || !file.type.startsWith('image/')) {
      setPageError('נא לבחור קובץ תמונה')
      return
    }

    setUploading(true)
    setPageError('')
    try {
      if (!project_id) throw new Error('no project_id')

      const ext  = inspirationFileExt(file.name)
      const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const path = `${project_id}/${uuid}.${ext}`

      const { error: upErr } = await supabase.storage.from(INSPIRATION_BUCKET).upload(path, file)
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage.from(INSPIRATION_BUCKET).getPublicUrl(path)

      onChange([...list, { url: publicUrl, fileName: file.name, uploadedAt: new Date().toISOString() }])
    } catch (err) {
      /* Preview mode blocks the upload on purpose — bail out quietly
         (the throw already skipped adding the image to local state, so
         there's no half-done entry to clean up). */
      if (!isPreviewBlockedError(err)) {
        console.error('inspiration image upload error:', err)
        if (isMountedRef.current) setPageError('שגיאה בהעלאה, נסה שוב')
        logError('questionnaire', 'inspiration_upload_failed', logCtx)
      }
    }
    if (isMountedRef.current) setUploading(false)
  }

  const handleDelete = async (idx) => {
    const img = list[idx]
    if (!img) return
    try {
      const path = inspirationStoragePath(img.url)
      if (path) {
        const { error: rmErr } = await supabase.storage.from(INSPIRATION_BUCKET).remove([path])
        if (rmErr) console.warn('inspiration image storage remove warning:', rmErr) /* non-fatal */
      }
      onChange(list.filter((_, i) => i !== idx))
      setConfirmIdx(null)
    } catch (err) {
      /* Same preview carve-out as the upload path above. (The storage
         remove itself is already non-fatal here, so this mainly guards
         against a future write in this block surfacing a red banner
         inside a read-only preview.) */
      if (!isPreviewBlockedError(err)) {
        console.error('inspiration image delete error:', err)
        logError('questionnaire', 'inspiration_delete_failed', logCtx)
        if (isMountedRef.current) {
          setPageError('שגיאה במחיקה, נסה שוב')
          setTimeout(() => isMountedRef.current && setPageError(''), 3000)
        }
      }
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {!isLocked && !atMax && (
          <button
            type="button"
            className="cp-shared-upload-btn"
            onClick={handlePick}
            disabled={uploading}
          >
            {uploading ? 'מעלה...' : '+ הוסף תמונה'}
          </button>
        )}
        {!isLocked && atMax && (
          <span style={{ fontSize: 13, color: '#8a8680' }}>הגעתם למספר המקסימלי של תמונות</span>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />
      </div>

      {pageError && <div className="cp-save-error" role="alert" style={{ marginBottom: 12 }}>{pageError}</div>}

      {list.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
          {list.map((img, idx) => (
            <div key={img.url || idx} style={{ position: 'relative' }}>
              <a href={img.url} target="_blank" rel="noopener noreferrer">
                <div style={{
                  aspectRatio: '1 / 1', borderRadius: 8, overflow: 'hidden',
                  border: '1px solid #d9d6cd', background: '#f2f0eb',
                }}>
                  <img
                    src={img.url}
                    alt={img.fileName || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
              </a>
              <div
                title={img.fileName}
                style={{
                  marginTop: 4, fontSize: 11, color: '#8a8680', textAlign: 'center',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {img.fileName}
              </div>

              {!isLocked && (
                confirmIdx === idx ? (
                  <div style={{
                    position: 'absolute', top: 4, left: 4,
                    display: 'flex', gap: 4, background: 'rgba(255,255,255,0.95)',
                    borderRadius: 6, padding: '3px 4px',
                  }}>
                    <button type="button" className="cp-shared-card-confirm-yes" onClick={() => handleDelete(idx)}>כן</button>
                    <button type="button" className="cp-shared-card-confirm-no" onClick={() => setConfirmIdx(null)}>לא</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmIdx(idx)}
                    aria-label="מחק"
                    title="מחק"
                    style={{
                      position: 'absolute', top: 4, left: 4,
                      width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(255,255,255,0.9)', border: '1px solid rgba(168,50,50,0.25)',
                      borderRadius: 6, color: '#a83232', cursor: 'pointer',
                    }}
                  >
                    <IconTrashSmall />
                  </button>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────
   Main component
   ───────────────────────────────────────────────────────────────── */

/**
 * Renders the client's programming questionnaire + house builder.
 *
 * Props (all optional — the default `<ClientProgrammingQuestionnaire />`
 * remains the client-portal usage):
 *   embeddedProjectId  — when provided, use this project_id instead of
 *                        reading from the ClientRoute context. Lets an
 *                        admin embed this screen for a project the
 *                        current viewer isn't a client of.
 *   forceAdminEdit     — when true, skip the profiles.role probe and
 *                        act as if the viewer is admin. Combined with
 *                        the existing isLockedForViewer split, this
 *                        lets the questionnaire be fully editable in
 *                        the admin split-screen even on a submitted
 *                        row.
 *   embedded           — when true, drop the "שאלון פרוגרמה" screen
 *                        title so the surrounding container (e.g. the
 *                        admin split-screen pane) can own the header.
 */
export default function ClientProgrammingQuestionnaire({
  embeddedProjectId,
  forceAdminEdit = false,
  embedded       = false,
  /* ── STAFF notifications — a single opt-in prop, default null ────────
     THE CLIENT NEVER SEES THESE DOTS, and not because of a runtime role
     check that could be got wrong: the client portal renders
     <ClientProgrammingQuestionnaire /> with no props at all, so this is
     null there and every staff affordance below is unreachable by
     construction. Only the staff full page (StaffQuestionnaireView)
     passes it.

     These dots mean the OPPOSITE of the client's own dots on the same
     two tiles. The client's say "you still have this to do" and come
     from computeQuestionnaireActionRequired via questionnaireDone /
     houseDone. These say "the client FINISHED — go look". The two are
     computed from different sources, named differently, and positioned
     on opposite corners, so a staff member who sees both at once (the
     client un-ticked a side while a notification was still pending) can
     tell them apart.

     Shape: { questionnairePending, housePending, onEnterQuestionnaire,
              onEnterHouse } — one object so it cannot be half-wired. */
  staffNotifications = null,
} = {}) {
  /* ClientContext is null when we render OUTSIDE a ClientRoute (the
     admin split-screen case). Reading it via useContext is safe —
     unlike the useClient() hook which throws. Fall back to the prop
     when there's no context. */
  const clientCtx = useContext(ClientContext)
  const project_id = embeddedProjectId ?? (clientCtx && clientCtx.project_id)
  const isMounted = useRef(true)

  /* Activity-log context — deliberately sourced ONLY from clientCtx
     (never embeddedProjectId), so logging fires for genuine client-
     portal renders (real login OR the admin's "תצוגת לקוח" preview,
     the latter excluded via previewMode) but stays silent for the
     admin's own direct split-screen edit (embedded=true, no
     clientCtx) — that's admin activity, not client usage. */
  const logCtx = {
    projectId:     (clientCtx && clientCtx.project_id) || null,
    clientUserId:  (clientCtx && clientCtx.id) || null,
    previewMode:   !!(clientCtx && clientCtx.previewMode),
  }

  /* Portal nav — the hub's back-arrow leaves the programming module.
     Safe no-ops when rendered outside the portal (embedded admin). */
  const { goBack } = useClientNav()

  /* Who to attribute a staff notification to, or null for "nobody — this
     is not a client finishing anything". Deliberately the SAME
     clientCtx-only sourcing rule as logCtx above, for the same reason:
     this component renders in four contexts and only ONE of them is a
     real client.
       · admin split-screen (embedded, forceAdminEdit) → no clientCtx
       · desktop "תצוגת לקוח" preview                  → previewMode
       · admin mobile client view (StaffClientViewMount) → isStaffView,
         and the admin's own uid, which has no client_users row and would
         be refused by client_can_create_own_notification as a 42501
       · a real client in the portal                    → notifies */
  const notifyingClientId =
    (clientCtx && !clientCtx.previewMode && !clientCtx.isStaffView)
      ? clientCtx.id
      : null

  /* Staff dot state, read once. Deliberately NOT named *Done or
     *Required — those belong to the client's mechanism a few lines
     below, and mixing the vocabularies is how the two would get
     confused. `staffPending*` means "a notification is waiting". */
  const staffPendingQuestionnaire = !!(staffNotifications && staffNotifications.questionnairePending)
  const staffPendingHouse         = !!(staffNotifications && staffNotifications.housePending)

  const [loading,          setLoading]          = useState(true)
  const [tableUnavailable, setTableUnavailable] = useState(false)
  const [pageError,        setPageError]        = useState('')

  const [rowId,       setRowId]       = useState(null)
  const [answers,     setAnswers]     = useState({})   /* whole answers jsonb */
  const [status,      setStatus]      = useState('draft')
  /* NEW columns on public.programming_questionnaires drive the lock:
       submitted    (bool, default false)
       submitted_at (timestamptz)
     Once submitted flips true the ENTIRE questionnaire + house builder
     become read-only for the client. See isLocked below. */
  const [submitted,   setSubmitted]   = useState(false)
  const [submittedAt, setSubmittedAt] = useState(null)

  /* Confirmation dialog + in-flight guard for "סיים ושלח". Local UI
     only — no persistence. */
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false)
  const [submitting,        setSubmitting]        = useState(false)
  const [submitError,       setSubmitError]       = useState('')

  /* Viewer-role probe. The lock (submitted=true) makes the form
     read-only for CLIENTS only — an admin must still be able to
     edit a submitted questionnaire. We reuse the same admin
     detection pattern the rest of the app uses (Reports.jsx /
     ProjectsKanban.jsx): SELECT role FROM profiles WHERE
     id = session.user.id. A row with role='admin' → treat as admin.
     Anything else (no row / other role / fetch error) → not admin,
     the client lock stays in effect. Default false so the transient
     "before-probe" render errs on the safe side (behaves as client).

     Short-circuit: when the parent explicitly passes forceAdminEdit
     (admin split-screen embed), skip the probe entirely and start as
     admin — the caller has already vouched for the viewer's role. */
  const [isAdmin, setIsAdmin] = useState(!!forceAdminEdit)

  /* House-builder config — needed here (outside the builder itself)
     to compute the hub's "estimated size" line via estimateArea(),
     which needs each room type's fixedArea / excludeFromAreaCalc /
     size-in-m² from config. Same seed-then-upgrade pattern
     HouseBuilderV2 uses: render immediately with the in-code
     fallback, swap to the DB-sourced config once it resolves. */
  const [houseConfig, setHouseConfig] = useState(() => getFallbackConfig())
  useEffect(() => {
    let cancelled = false
    loadHouseBuilderConfig()
      .then(cfg => { if (!cancelled) setHouseConfig(cfg) })
      .catch(e => console.warn('hub house config load failed:', e))
    return () => { cancelled = true }
  }, [])

  /* Questionnaire-scoped state: the shape from the config, live-edited. */
  const [qData,          setQData]          = useState(() => makeEmptyQData())
  const [stepIndex,      setStepIndex]      = useState(0)
  const [savingDraft,    setSavingDraft]    = useState(false)
  const [savedFlash,     setSavedFlash]     = useState(false)
  /* Three-view hub layer:
       'hub'           — the landing screen with intro text + two tiles
                         (מילוי השאלון / בונה הבית). Default on entry.
       'questionnaire' — the 5-step form (Stage B). "סיום ושליחה" on
                         the last step saves and returns to the hub.
       'house'         — the interactive house-builder (Stage C-2 / C-3).
     Local only — does not persist across mounts; entering the screen
     always starts on the hub. */
  const [view, setView] = useState('hub')

  /* Reset scroll to the top on every step change (הבא/הקודם, or the
     step-number pills) — the SAME approach HouseBuilderV2 uses for its
     own wizard, kept identical so the two modules behave the same.

     Which thing actually needs resetting depends on how this component
     is hosted, and it isn't always the same:
       · The standalone client portal scrolls .cp-content (the portal
         shell's own overflow container), not the window.
       · The admin split-screen embed (MeetingSummariesTab) wraps this
         whole component in ITS OWN fixed-height, internally-scrolling
         panel.
     Rather than special-case each host, walk up from the step body to
     find whichever ancestor is ACTUALLY scrolled (scrollHeight >
     clientHeight) within a few hops and reset it; only fall back to the
     window when none is found, so we don't yank an unrelated outer page
     to the top when an inner container already owns the scroll.

     Guarded on `view` because the ref is only attached in the
     questionnaire view — without it, a stepIndex change made while
     entering from the hub (openQuestionnaire sets both) would find a
     null ref and scroll the window for no reason. */
  const stepBodyRef = useRef(null)
  useEffect(() => {
    if (view !== 'questionnaire') return
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
  }, [stepIndex, view])

  /* ── Auto-save refs (hooks; top-level, before any early return) ────
     hasLoadedRef       : flipped true after the initial load runs, so
                          the debounce doesn't try to save an empty row
                          on mount before we know the row id.
     savedSnapshotRef   : { answers, qData } we last WROTE. The effect
                          compares to current state by reference and
                          only schedules a save when something differs
                          — so save-induced setAnswers doesn't loop.
     autoSaveTimerRef   : debounce handle. Cleanup on each effect run
                          clears the previous timer so only the LATEST
                          schedule fires (900ms after user idles). */
  const hasLoadedRef     = useRef(false)
  const savedSnapshotRef = useRef({ answers: null, qData: null })
  const autoSaveTimerRef = useRef(null)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  /* Probe the CURRENT session user's profiles.role once on mount.
     Mirrors the check in Reports.jsx / ProjectsKanban.jsx. The
     component always lives inside ClientRoute, so the normal
     visitor is a client (client_users row) and this probe returns
     null — isAdmin stays false. When an admin ever loads this
     screen (e.g. from a future admin-side embed) their profiles
     row flips isAdmin=true and the lock lifts for them. */
  useEffect(() => {
    /* Skip the probe when the parent has already asserted admin.
       Saves a round-trip and keeps isAdmin sticky-true even if the
       profiles fetch would fail (embedded consumer's responsibility). */
    if (forceAdminEdit) return
    let cancelled = false
    const checkAdmin = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const { data } = await supabase
          .from('profiles').select('role')
          .eq('id', session.user.id).maybeSingle()
        if (!cancelled && data && data.role === 'admin') {
          setIsAdmin(true)
        }
      } catch (e) {
        console.warn('admin role probe failed:', e)
      }
    }
    checkAdmin()
    return () => { cancelled = true }
  }, [forceAdminEdit])

  useEffect(() => {
    if (!project_id) return
    const load = async () => {
      setLoading(true)
      setPageError('')
      setTableUnavailable(false)

      /* SELECT (Stage A). Any error → "בקרוב" placeholder. */
      const { data: existing, error: selErr } = await supabase
        .from('programming_questionnaires')
        .select('id, answers, status, submitted, submitted_at')
        .eq('project_id', project_id)
        .maybeSingle()

      if (!isMounted.current) return
      if (selErr) {
        console.warn('programming_questionnaires load — treating as unavailable:', selErr)
        setTableUnavailable(true); setLoading(false); return
      }

      /* The row is now created up front — when an admin flips
         projects.show_programming_questionnaire ON (see ProjectsKanban's
         handleSettingsSave) — so a REAL client should always find one
         already here; the tile that leads to this screen isn't even
         visible to them otherwise. If it's still missing, degrade to
         "בקרוב" rather than writing, same as any other load failure.

         The one exception: forceAdminEdit (the meeting-embedded editor,
         MeetingSummariesTab.jsx) lets an admin fill this in BEFORE ever
         toggling the client-visibility flag on — that pre-existing
         workflow keeps its own create-on-first-open fallback so it isn't
         blocked on the toggle. */
      let row = existing
      if (!row) {
        if (!forceAdminEdit) {
          setTableUnavailable(true); setLoading(false); return
        }
        const { data: inserted, error: insErr } = await supabase
          .from('programming_questionnaires')
          .insert({ project_id: project_id, answers: {} })
          .select('id, answers, status, submitted, submitted_at')
          .single()
        if (!isMounted.current) return
        if (insErr) {
          console.warn('programming_questionnaires create failed — treating as unavailable:', insErr)
          setTableUnavailable(true); setLoading(false); return
        }
        row = inserted
      }

      const rawAnswers   = row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers) ? row.answers : {}
      const savedQ       = rawAnswers.questionnaire
      const hasSavedQ    = savedQ && typeof savedQ === 'object' && !Array.isArray(savedQ)
      let normalizedQ    = normalizeQData(hasSavedQ ? savedQ : null)

      /* First-ever load (no questionnaire under answers) → seed people
         from project_contacts. Once ANY draft is saved this branch is
         skipped and the saved list wins. */
      if (!hasSavedQ) {
        const seeded = await seedPeopleFromContacts(project_id)
        if (!isMounted.current) return
        normalizedQ = { ...normalizedQ, people: seeded }
      }

      setRowId(row.id)
      setAnswers(rawAnswers)
      setStatus(row.status || 'draft')
      setSubmitted(row.submitted === true)
      setSubmittedAt(row.submitted_at || null)
      setQData(normalizedQ)
      setLoading(false)
      /* Seed the auto-save snapshot to EXACTLY what we just loaded, so
         the post-commit effect run sees "nothing to save" (references
         match) and doesn't schedule a redundant round-trip. */
      savedSnapshotRef.current = { answers: rawAnswers, qData: normalizedQ }
      hasLoadedRef.current = true
    }
    load()
  }, [project_id])

  /* Lock derives from the `submitted` boolean (the source of truth on
     the DB row). We keep the legacy `status === 'submitted'` check as
     a belt-and-suspenders OR so any pre-existing rows that happened to
     carry that status (there aren't any today, but future-proof) also
     lock. UI-only lock — see the TODO in handleConfirmSubmit.

     `isLocked` reflects the ROW STATE (used for the "הושלם ✓" tile
     hint that both viewers see).
     `isLockedForViewer` is the ACTUAL edit-gating signal — admins can
     still edit a submitted row. Every save-guard, updateQ block, and
     readOnly prop passes through the viewer version. */
  const isLocked          = submitted === true || status === 'submitted'
  const isLockedForViewer = isLocked && !isAdmin
  const totalSteps = QUESTIONNAIRE_STEPS.length
  const step       = QUESTIONNAIRE_STEPS[stepIndex]
  const isLastStep = stepIndex === totalSteps - 1

  /* Updater passed down to every block renderer. Guards against writes
     when the form is locked so nothing silently mutates local state. */
  const updateQ = (updater) => {
    if (isLockedForViewer) return
    setQData(prev => (typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }))
  }

  /* Persist a snapshot into the answers jsonb. Bumps updated_at.
     Accepts an optional `houseOverride` — when the house builder
     hands us a fresh JSON via onBack / onDone / onChange we pass it
     here so the write includes it. When not provided, whatever's in
     `answers.house` from prior loads is preserved (via the spread).
     Returns true on success so callers can chain (e.g. goNext /
     handleHouseBack navigate on success only). */
  const saveDraftNow = async ({ silent = false, houseOverride, metaOverride } = {}) => {
    if (!rowId || isLockedForViewer || savingDraft) return false
    setSavingDraft(true)
    setPageError('')
    try {
      const nextAnswers = {
        ...(answers || {}),
        questionnaire: qData,
      }
      if (houseOverride !== undefined) {
        nextAnswers.house = houseOverride
      }
      /* Symmetric to houseOverride — dodges the setAnswers-is-async
         race when the caller wants to flip meta flags and immediately
         persist them (e.g. questionnaire mark-done, house-done checkbox
         toggle). Patch-merge onto the existing meta object so unrelated
         keys survive. */
      if (metaOverride !== undefined) {
        nextAnswers.meta = { ...(((answers && answers.meta) || {})), ...metaOverride }
      }
      const { error } = await supabase
        .from('programming_questionnaires')
        .update({
          answers:    nextAnswers,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rowId)
      /* In the admin's "תצוגת לקוח" preview every write is blocked BY
         DESIGN. Treat that as a silent success rather than an error:
         the local state below still updates (in-memory only — nothing
         reaches the DB), so the admin can page through the whole flow
         and see exactly what the client sees. Returning false here
         instead would strand them — goNext / handleHouseDone and the
         other callers all gate their navigation on this result. */
      const previewBlocked = isPreviewBlockedError(error)
      if (error && !previewBlocked) throw error
      if (!isMounted.current) return false
      /* Stamp what we JUST WROTE so the auto-save effect (which fires
         after the setAnswers below) sees "nothing to save" (references
         match) and doesn't schedule a redundant round-trip. */
      savedSnapshotRef.current = { answers: nextAnswers, qData: qData }
      setAnswers(nextAnswers)
      /* No "נשמר ✓" flash under preview — nothing was actually saved,
         and claiming otherwise would be a lie. */
      if (!silent && !previewBlocked) {
        setSavedFlash(true)
        setTimeout(() => isMounted.current && setSavedFlash(false), 1800)
      }
      return true
    } catch (err) {
      console.error('programming_questionnaires save error:', err)
      if (isMounted.current) setPageError('שגיאה בשמירה, נסה שוב')
      logError('questionnaire', 'save_failed', logCtx)
      return false
    } finally {
      if (isMounted.current) setSavingDraft(false)
    }
  }

  /* ── Debounced auto-save (safety net) ─────────────────────────────
     Fires after every change to `qData` or `answers` that isn't just
     the load or a save-echo. Compares CURRENT state against the last
     snapshot we wrote (savedSnapshotRef) — reference equality is
     enough because save always creates new object identities.

     Guards:
       * hasLoadedRef       — don't fire before the row loads.
       * loading            — same.
       * tableUnavailable   — no row to write to (prod-fallback).
       * !rowId             — belt-and-suspenders on the row id.
       * isLocked           — submitted rows are read-only.
     Snapshot match          — nothing changed since last write → skip.

     Only the LATEST scheduled callback fires: cleanup on each effect
     run clears the previous timer. */
  useEffect(() => {
    if (!hasLoadedRef.current) return
    if (loading || tableUnavailable || !rowId || isLockedForViewer) return
    const saved = savedSnapshotRef.current
    if (saved && saved.answers === answers && saved.qData === qData) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveDraftNow({ silent: true })
    }, 900)

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qData, answers, rowId, isLockedForViewer, loading, tableUnavailable])

  /* Small helper — cancels any pending debounced save. Called at the
     top of every explicit save path (manual button / navigation /
     house back / house done) so we don't chase our own tail. */
  const cancelPendingAutoSave = () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
  }

  /* ── House-builder wiring ────────────────────────────────────────
     onChange writes the fresh JSON into `answers.house` directly, so
     the shared debounced auto-save above picks it up alongside the
     questionnaire. onBack + onDone are "flush" paths — they cancel
     the debounce and force an immediate save (using houseOverride to
     dodge the stale-closure race when the save runs synchronously
     right after setAnswers). */

  const handleHouseChange = (json) => {
    setAnswers(prev => ({ ...(prev || {}), house: json }))
  }

  /* Inspiration-images setter — mirrors handleHouseChange: writes
     straight into answers.inspirationImages (NOT answers.questionnaire)
     so the existing debounced auto-save + "שמור טיוטה" picks it up
     alongside everything else, no separate save path needed. */
  const handleInspirationImagesChange = (nextImages) => {
    setAnswers(prev => ({ ...(prev || {}), inspirationImages: nextImages }))
  }

  const handleHouseBack = async (jsonFromBuilder) => {
    cancelPendingAutoSave()
    if (jsonFromBuilder !== undefined && jsonFromBuilder !== null) {
      /* setAnswers is async — pass the fresh JSON to saveDraftNow so
         the write uses the LATEST house value, not a stale closure. */
      setAnswers(prev => ({ ...(prev || {}), house: jsonFromBuilder }))
      await saveDraftNow({ silent: true, houseOverride: jsonFromBuilder })
    }
    setView('hub')
  }

  /* House-builder finish ("סיימתי" on its last step) — the exact
     mirror of handleMarkQuestionnaireDone below: flip the part's
     meta flag, persist with the SAME explicit save the "שמור טיוטה"
     button uses (never the debounced autosave, which navigating away
     could race and silently drop), then return to the hub on success.

     The builder passes its current JSON, so the house content and the
     flag land in ONE write. Like the questionnaire's flag this only
     records "the client says this part is ready" — it locks nothing,
     stays reversible, and does not touch submitted / submitted_at. */
  const handleHouseDone = async (jsonFromBuilder) => {
    if (isLockedForViewer) return
    cancelPendingAutoSave()
    const nextHouse = (jsonFromBuilder !== undefined && jsonFromBuilder !== null)
      ? jsonFromBuilder
      : undefined
    setAnswers(prev => ({
      ...(prev || {}),
      ...(nextHouse !== undefined ? { house: nextHouse } : {}),
      meta: { ...((prev && prev.meta) || {}), house_done: true },
    }))
    /* metaOverride/houseOverride sidestep the setAnswers stale-closure
       race so the FIRST save already carries both. */
    const ok = await saveDraftNow({
      silent: true,
      ...(nextHouse !== undefined ? { houseOverride: nextHouse } : {}),
      metaOverride: { house_done: true },
    })
    if (ok) {
      /* house_done is set from TWO places — the builder's own "סיימתי"
         here, and the hub checkbox in handleHouseDoneChange. Both notify;
         the partial unique index caps the pair at one pending row, so
         using both in sequence raises one dot, not two. */
      if (notifyingClientId) {
        void notifyClientHouseDone({ projectId: project_id, actorId: notifyingClientId })
      }
      setView('hub')
    }
  }

  /* ── Per-part completion flags ─────────────────────────────────────
     Two REVERSIBLE booleans live at answers.meta.{questionnaire_done,
     house_done}. They persist through the normal answers-jsonb save
     path, no schema/DB change. Both default false; the final "סיים
     ושלח" button is enabled only when BOTH are true.

     The flags are just "the client indicated this part is ready" —
     they do NOT lock anything. Only the separate submitted=true write
     locks the row (see handleConfirmSubmit above / isLocked). Editing
     a part after marking it done keeps the flag true; the client can
     re-confirm from the same button. */

  const handleMarkQuestionnaireDone = async () => {
    if (isLockedForViewer) return
    cancelPendingAutoSave()
    setAnswers(prev => ({
      ...(prev || {}),
      meta: { ...((prev && prev.meta) || {}), questionnaire_done: true },
    }))
    /* metaOverride sidesteps the setAnswers stale-closure race so the
       write includes the fresh flag on the FIRST save, not a follow-up. */
    const ok = await saveDraftNow({ silent: true, metaOverride: { questionnaire_done: true } })
    if (ok) {
      if (notifyingClientId) {
        void notifyClientQuestionnaireDone({ projectId: project_id, actorId: notifyingClientId })
      }
      setView('hub')
    }
  }

  const handleHouseDoneChange = async (nextChecked) => {
    if (isLockedForViewer) return
    cancelPendingAutoSave()
    setAnswers(prev => ({
      ...(prev || {}),
      meta: { ...((prev && prev.meta) || {}), house_done: !!nextChecked },
    }))
    const ok = await saveDraftNow({ silent: false, metaOverride: { house_done: !!nextChecked } })
    /* ONLY ticking is an event. Unticking inserts nothing and deletes
       nothing — a pending dot stays pending, because the studio still
       ought to look, and a later re-tick is capped to that same one row. */
    if (ok && nextChecked && notifyingClientId) {
      void notifyClientHouseDone({ projectId: project_id, actorId: notifyingClientId })
    }
  }

  /* ── DEV-ONLY: reset the row to fully-editable/not-submitted ─────
     Guarded by import.meta.env.DEV on the render side so the
     button doesn't ship. The handler still runs if invoked, but
     production bundles never render the button.

     Writes ALL of:
       * submitted        → false
       * submitted_at     → null
       * answers.meta.questionnaire_done → false
       * answers.meta.house_done         → false
     in a single UPDATE so the row is consistent when it lands.
     Bypasses saveDraftNow because that path is gated on
     !isLockedForViewer (which would be true right now for the
     client, blocking the reset). */
  const handleDevReactivate = async () => {
    if (!rowId) return
    setPageError('')
    try {
      cancelPendingAutoSave()
      const nextAnswers = {
        ...(answers || {}),
        meta: {
          ...((answers && answers.meta) || {}),
          questionnaire_done: false,
          house_done:         false,
        },
      }
      const { error } = await supabase
        .from('programming_questionnaires')
        .update({
          submitted:    false,
          submitted_at: null,
          answers:      nextAnswers,
          updated_at:   new Date().toISOString(),
        })
        .eq('id', rowId)
      if (error) throw error
      if (!isMounted.current) return

      setSubmitted(false)
      setSubmittedAt(null)
      setStatus('draft')
      setAnswers(nextAnswers)
      /* Sync the auto-save snapshot with what we just wrote so the
         post-commit debounced effect sees "nothing to save" (identity
         match) and doesn't trigger a redundant round-trip. */
      savedSnapshotRef.current = { answers: nextAnswers, qData }
    } catch (err) {
      console.error('dev reactivate failed:', err)
      if (isMounted.current) setPageError('שגיאה בהחזרת השאלון (DEV)')
    }
  }

  const goNext = async () => {
    cancelPendingAutoSave()
    /* Last step's button (labelled "סיימתי את השאלון") marks the
       questionnaire part complete and returns to the hub. It does
       NOT lock — only the hub's "סיים ושלח" locks. */
    if (isLastStep) {
      await handleMarkQuestionnaireDone()
      return
    }
    const ok = await saveDraftNow({ silent: true })
    if (!ok) return
    setStepIndex(i => Math.min(totalSteps - 1, i + 1))
  }

  const goPrev = async () => {
    if (stepIndex === 0) return
    cancelPendingAutoSave()
    await saveDraftNow({ silent: true })
    setStepIndex(i => Math.max(0, i - 1))
  }

  const jumpToStep = async (i) => {
    if (i === stepIndex) return
    cancelPendingAutoSave()
    await saveDraftNow({ silent: true })
    setStepIndex(i)
  }

  /* Manual "שמור טיוטה" — flushes any pending debounce and forces
     an immediate save with the "נשמר ✓" flash. Used by the buttons
     in BOTH the questionnaire nav row and the house builder view. */
  const handleManualSave = async () => {
    cancelPendingAutoSave()
    await saveDraftNow({ silent: false })
  }

  /* ── "סיים ושלח" — final-submit flow ────────────────────────────────
     Called after the client confirms the dialog. Two-phase write:
       1. Flush any pending debounced save so the latest questionnaire
          answers + house JSON actually land in the DB before the row
          is frozen. saveDraftNow returns false on failure and aborts
          — we DON'T flip submitted=true on top of a failed draft.
       2. UPDATE { submitted: true, submitted_at: <now> }. On success,
          mirror into local state → isLocked becomes true → every
          renderer + the debounced auto-save switch to read-only.
     Failure at either phase leaves submitted=false so the client can
     retry. `submitting` gates the dialog button + hides the submit
     tile so we can't fire twice.

     TODO: enforce lock at DB level (RLS) before production — UI lock
     alone can be bypassed by a technical client. Once a row has
     submitted=true, the anon/client role must not be allowed to
     UPDATE its answers/house columns (or reset submitted). */
  const handleConfirmSubmit = async () => {
    if (!rowId || submitting || isLocked) return
    setSubmitError('')
    setSubmitting(true)
    try {
      /* Phase 1 — flush the pending debounced save and force an
         immediate write of the latest local state. If the draft save
         fails we surface the message and stop; the row is not yet
         locked. */
      cancelPendingAutoSave()
      const draftOk = await saveDraftNow({ silent: true })
      if (!draftOk) {
        setSubmitError('שגיאה בשמירת התשובות. נסו שוב.')
        logError('questionnaire', 'submit_draft_failed', logCtx)
        return
      }

      /* Phase 2 — flip the submit flags. Uses the local ISO timestamp
         for immediate UI (banner) while the DB row itself carries the
         server value via the same string. */
      const nowIso = new Date().toISOString()
      const { error } = await supabase
        .from('programming_questionnaires')
        .update({ submitted: true, submitted_at: nowIso })
        .eq('id', rowId)
      /* Preview mode: close the dialog and stop. Unlike saveDraftNow
         (whose local-only write is harmless), flipping `submitted` here
         would lock the entire questionnaire read-only in the preview —
         a confusing dead end for an admin who is just looking. */
      if (isPreviewBlockedError(error)) {
        setConfirmSubmitOpen(false)
        return
      }
      if (error) throw error
      if (!isMounted.current) return

      setSubmitted(true)
      setSubmittedAt(nowIso)
      setConfirmSubmitOpen(false)
      /* Ensure we're on the hub so the client sees the "sent" banner
         and status readouts without an intermediate step view. */
      setView('hub')
    } catch (err) {
      console.error('programming_questionnaires submit error:', err)
      if (isMounted.current) setSubmitError('שגיאה בשליחה, נסו שוב.')
      logError('questionnaire', 'submit_failed', logCtx)
    } finally {
      if (isMounted.current) setSubmitting(false)
    }
  }

  /* ── Hub-derived readouts ──────────────────────────────────────────
     Moved ABOVE the early returns because one of the four (the
     `hasHouseDraft` useMemo) is a HOOK — React's rules-of-hooks
     require every hook to run on every render in the same order.
     Leaving the useMemo below `if (loading) return …` meant it was
     skipped during the loading render and called after, so the hook
     count differed between renders → "Rendered more hooks than
     during the previous render".

     `hasDraft`: any saved answers.questionnaire → the client has
     started at least once. Drives the tile's status line.
     `questionnaireStatusLine` and `houseStatusLine`: submitted →
     "הושלם ✓"; has draft → "יש טיוטה שמורה"; otherwise → null.
     The other three are plain const (not hooks) — they ride along
     here for readability so the whole derived block sits together. */
  const hasDraft = answers && answers.questionnaire && typeof answers.questionnaire === 'object'
  /* Per-part completion flags from the jsonb bag. See the
     handleMark* handlers above for the write path. */
  const questionnaireDone = !!(answers && answers.meta && answers.meta.questionnaire_done === true)
  const houseDone         = !!(answers && answers.meta && answers.meta.house_done === true)

  const questionnaireStatusLine =
      isLocked          ? { text: 'הושלם ✓',           color: '#4a7f4a' }
    : questionnaireDone ? { text: 'הסתיים המילוי ✓',   color: '#7a9478' }
    : hasDraft          ? { text: 'יש טיוטה שמורה',    color: '#8a8680' }
    : null

  /* Draft-hint on the "בונה הבית" tile — mirrors the questionnaire's.
     "Has content" = any floor turned on, any yard turned on, or any
     room in any area. Default state (ground:true, no rooms) still
     counts as "started" once the client has hit ↩ חזרה or the finish
     checkbox at least once (which is when we persist). */
  const hasHouseDraft = useMemo(() => {
    const h = answers && answers.house
    if (!h || typeof h !== 'object') return false
    const anyFloor = h.floors && Object.values(h.floors).some(v => v === true)
    const anyRooms = h.rooms  && Object.keys(h.rooms).some(k =>
                       Array.isArray(h.rooms[k]) && h.rooms[k].length > 0)
    return !!(anyFloor || h.yard === true || anyRooms)
  }, [answers])

  const houseStatusLine =
      isLocked      ? { text: 'הושלם ✓',           color: '#4a7f4a' }
    : houseDone     ? { text: 'הסתיים המילוי ✓',   color: '#7a9478' }
    : hasHouseDraft ? { text: 'יש טיוטה שמורה',    color: '#8a8680' }
    : null

  /* ── "בונה הבית" tile — computed size line (once houseDone) ───────
     X = estimateArea() over every placed room, flattened out of the
     nested rooms-by-area / children tree (estimateArea itself expects
     a flat list — it does not recurse). fixedArea / excludeFromAreaCalc
     are TYPE-level flags from houseConfig, not stored per room
     instance, so each flattened room is annotated from config before
     the call. Y = the Step-1 target (answers.house.targetArea),
     already persisted as a plain number (see HouseBuilderV2's
     targetArea field) — null/0/missing means "not filled in yet". */
  const computedHouseArea = useMemo(() => {
    const roomsByArea = answers && answers.house && answers.house.rooms
    if (!roomsByArea || typeof roomsByArea !== 'object') return 0
    const flat = []
    const visit = (list) => {
      for (const r of (Array.isArray(list) ? list : [])) {
        flat.push(r)
        if (Array.isArray(r.children)) visit(r.children)
      }
    }
    for (const areaKey of Object.keys(roomsByArea)) visit(roomsByArea[areaKey])

    const annotated = flat.map(r => ({
      type:                r.type,
      sizeKey:              r.sizeKey,
      fixedArea:            houseConfig.getFixedArea ? houseConfig.getFixedArea(r.type) : null,
      excludeFromAreaCalc:  houseConfig.isExcludedFromAreaCalc ? houseConfig.isExcludedFromAreaCalc(r.type) : false,
    }))
    return estimateArea(annotated, { sizesMap: houseConfig.ROOM_SIZES, calcParams: houseConfig.calcParams })
  }, [answers, houseConfig])

  const targetAreaY = (
    typeof answers?.house?.targetArea === 'number'
    && Number.isFinite(answers.house.targetArea)
    && answers.house.targetArea > 0
  ) ? answers.house.targetArea : null

  /* Tolerance ("אחוז סטייה מותר") — admin-editable via "פרמטרי מחשבון",
     defaults to 10% (DEFAULT_CALC_PARAMS.toleranceDeviationPct) when the
     active config row doesn't carry a valid override. */
  const toleranceDeviationPct = (
    houseConfig.calcParams
    && typeof houseConfig.calcParams.toleranceDeviationPct === 'number'
    && Number.isFinite(houseConfig.calcParams.toleranceDeviationPct)
  ) ? houseConfig.calcParams.toleranceDeviationPct : 10

  /* Three-way comparison, replacing the old binary matches/exceeds
     check. toleranceAmount is computed off the TARGET (same base the
     old single-sided check used), not the calculated size.
       target > calculated + tolerance → the client's requested size is
         bigger than what the rooms actually add up to ('bigger').
       target < calculated - tolerance → the requested size is smaller
         than the calculated one ('smaller').
       otherwise (within calculated ± tolerance either direction) →
         'matches', same wording as before. */
  const toleranceAmount = targetAreaY != null ? targetAreaY * (toleranceDeviationPct / 100) : 0
  const houseAreaComparison =
      targetAreaY == null                                  ? null
    : targetAreaY > computedHouseArea + toleranceAmount     ? 'bigger'
    : targetAreaY < computedHouseArea - toleranceAmount     ? 'smaller'
    :                                                          'matches'

  /* ── Render ─────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="cp-page">
        <div className="cp-container">
          {!embedded && <h1 className="cp-screen-title">שאלון פרוגרמה</h1>}
          <div className="cp-loading"><p>טוען...</p></div>
        </div>
      </div>
    )
  }

  if (tableUnavailable) {
    return (
      <div className="cp-page">
        <div className="cp-container">
          {!embedded && <h1 className="cp-screen-title">שאלון פרוגרמה</h1>}
          <section className="cp-card">
            <p className="cp-empty-card">בקרוב</p>
          </section>
        </div>
      </div>
    )
  }

  /* Shared inline styles for the two hub tiles — same base for both;
     the disabled tile overrides colour + cursor. Kept inline so we
     don't touch the shared CSS. */
  const hubTileBase = {
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    gap:            10,
    padding:        '24px 18px',
    background:     '#ffffff',
    border:         '1px solid #e5e3dd',
    borderRadius:   14,
    textAlign:      'center',
    fontFamily:     'inherit',
    boxShadow:      '0 1px 2px rgba(0,0,0,0.03)',
    position:       'relative',
    boxSizing:      'border-box',
    minHeight:      180,
  }
  const hubTileIconWrap = {
    width:          56,
    height:         56,
    borderRadius:   '50%',
    background:     'rgba(122, 148, 120, 0.12)',
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    color:          '#7a9478',
  }
  const hubTileTitle = { fontSize: 15.5, fontWeight: 600, color: '#1a1a18' }
  const hubTileDesc  = { fontSize: 13, color: '#4a4a48', lineHeight: 1.5 }

  const openQuestionnaire = () => {
    setStepIndex(0)
    setView('questionnaire')
  }
  const returnToHub = () => {
    setView('hub')
  }

  return (
    <div className="cp-page">
      <div className="cp-container">
        {/* Screen header row — title at the RTL start (visual RIGHT)
            and the round back-arrow at the visual LEFT of the SAME
            row, vertically centered.
              · hub view       → title only (nothing to go back to
                                 within the module).
              · questionnaire  → title + arrow.
              · house view     → SUPPRESSED ENTIRELY. HouseBuilderV2
                                 renders its own "מערכת בונה הבית"
                                 header row with the same arrow, so
                                 showing "שאלון פרוגרמה" here too
                                 would double up the titles.
            Bottom margin is deliberately tight (6px) so content
            starts close under the title — the h1's own 12px bottom
            margin is zeroed out here. */}
        {view !== 'house' && (!embedded || view === 'questionnaire') && (
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            gap:            10,
            direction:      'rtl',
            marginBottom:   6,
          }}>
            {!embedded ? (
              <h1
                className="cp-screen-title"
                style={{ margin: 0, flex: 1, minWidth: 0 }}
              >
                שאלון פרוגרמה
              </h1>
            ) : (
              <span style={{ flex: 1 }} />
            )}
            {view === 'questionnaire' && (
              <button
                type="button"
                className="cp-screen-back"
                onClick={returnToHub}
                aria-label="חזרה למרחב הפרוגרמה"
                title="חזרה למרחב הפרוגרמה"
              >
                <IconBack size={20} />
              </button>
            )}
            {/* HUB back-arrow — same round control, but this one
                leaves the programming module entirely and returns to
                the portal (goBack), since the hub IS the module's
                root. Hidden in embedded/admin usage where there's no
                portal nav to go back to. */}
            {view === 'hub' && !embedded && (
              <button
                type="button"
                className="cp-screen-back"
                onClick={() => goBack()}
                aria-label="חזרה"
                title="חזרה"
              >
                <IconBack size={20} />
              </button>
            )}
          </div>
        )}

        {/* Row-state banner. Two variants:
              * client viewing a submitted row → "לצפייה בלבד" (locked
                for editing).
              * admin viewing a submitted row → sage note "ניתן לעריכה
                (מנהל)" so the admin sees the row's submitted-state at
                a glance while still being able to edit. */}
        {isLocked && !isAdmin && (
          <section className="cp-card" style={{
            marginBottom: 12,
            background: '#f2efe6',
            borderInlineStart: '4px solid #7a9478',
          }}>
            <div style={{ fontSize: 13.5, color: '#1a1a18', fontWeight: 500 }}>
              {(() => {
                /* he-IL DATE only (no time). submittedAt might be null
                   on a legacy row that got locked by status alone; in
                   that case we drop the parenthetical. */
                const d = submittedAt ? new Date(submittedAt) : null
                const dateStr = d && !isNaN(d.getTime())
                  ? d.toLocaleDateString('he-IL')
                  : null
                return dateStr
                  ? `השאלון נשלח (${dateStr}) — לצפייה בלבד`
                  : 'השאלון נשלח — לצפייה בלבד'
              })()}
            </div>
          </section>
        )}
        {isLocked && isAdmin && (
          <section className="cp-card" style={{
            marginBottom: 12,
            background: '#eef3ec',
            borderInlineStart: '4px solid #5d7259',
          }}>
            <div style={{ fontSize: 13.5, color: '#1a1a18', fontWeight: 500 }}>
              {(() => {
                const d = submittedAt ? new Date(submittedAt) : null
                const dateStr = d && !isNaN(d.getTime())
                  ? d.toLocaleDateString('he-IL')
                  : null
                return dateStr
                  ? `נשלח על ידי הלקוח (${dateStr}) — ניתן לעריכה (מנהל)`
                  : 'נשלח על ידי הלקוח — ניתן לעריכה (מנהל)'
              })()}
            </div>
          </section>
        )}

        {pageError && (
          <div className="cp-save-error" role="alert">{pageError}</div>
        )}

        {view === 'hub' ? (
          /* ── HUB VIEW ─────────────────────────────────────────────
             Intro paragraphs (verbatim) + two tiles. Tile 1 opens the
             questionnaire; tile 2 is disabled ("בקרוב"). */
          <>
            <section className="cp-card" style={{ marginBottom: 16 }}>
              <p style={{ fontSize: 14, color: '#4a4a48', lineHeight: 1.7, margin: '0 0 12px' }}>
                השאלון הוא חלק מהותי בהבנת הצרכים, הרצונות והחלומות שלכם, כדי שנוכל לתכנן את ביתכם באופן המיטבי שמתאים בדיוק לכם ולאורח חייכם.
              </p>
              <p style={{ fontSize: 13, color: '#4a4a48', lineHeight: 1.7, margin: 0 }}>
                התהליך מורכב משני חלקים: מילוי שאלון — שאלות על אורח החיים והרצונות שלכם; ובונה הבית — כלי אינטראקטיבי שבו תבנו את מבנה הבית והחללים. אפשר למלא בכל סדר, ולחזור לכאן בכל שלב.
              </p>
            </section>

            {/* Two tiles — side-by-side on desktop, stacked on narrow
                phones. auto-fit + minmax(240, 1fr) collapses to a
                single column when each tile can't fit its 240px min. */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
            }}>
              {/* Tile 1 — מילוי השאלון (enabled) */}
              <button
                type="button"
                onClick={() => {
                  /* Entering this side clears ONLY this side. Click only —
                     nothing here is bound to hover or visibility. */
                  staffNotifications?.onEnterQuestionnaire?.()
                  openQuestionnaire()
                }}
                style={{ ...hubTileBase, cursor: 'pointer' }}
              >
                {/* CLIENT's dot — "you still have this to do". Untouched. */}
                {!questionnaireDone && (
                  <ActionRequiredDot style={{ position: 'absolute', top: 10, right: 10 }} />
                )}
                {/* STAFF's dot — "the client finished, go look". Opposite
                    corner (top-LEFT, i.e. visually left in this RTL page)
                    so the two are never mistaken for one another on the
                    rare render where both are true. */}
                {staffPendingQuestionnaire && (
                  <ActionRequiredDot
                    label="הלקוח סיים את מילוי השאלון"
                    style={{ position: 'absolute', top: 10, left: 10 }}
                  />
                )}
                <span style={hubTileIconWrap}>
                  <IconDocument size={28} />
                </span>
                <span style={hubTileTitle}>מילוי השאלון</span>
                <span style={hubTileDesc}>אורח חיים, רצונות, אווירה וסגנון</span>
                {questionnaireStatusLine && (
                  <span style={{
                    fontSize: 12.5, fontWeight: 500, marginTop: 2,
                    color: questionnaireStatusLine.color,
                  }}>
                    {questionnaireStatusLine.text}
                  </span>
                )}
              </button>

              {/* Tile 2 — בונה הבית. Same live-tile chrome as Tile 1;
                  Stage C-3 adds the "יש טיוטה שמורה" / "הושלם ✓" hint
                  based on answers.house. */}
              <button
                type="button"
                onClick={() => {
                  staffNotifications?.onEnterHouse?.()
                  setView('house')
                }}
                style={{ ...hubTileBase, cursor: 'pointer' }}
              >
                {/* CLIENT's dot — untouched. */}
                {!houseDone && (
                  <ActionRequiredDot style={{ position: 'absolute', top: 10, right: 10 }} />
                )}
                {/* STAFF's dot — opposite corner, see tile 1. */}
                {staffPendingHouse && (
                  <ActionRequiredDot
                    label="הלקוח סיים את בונה הבית"
                    style={{ position: 'absolute', top: 10, left: 10 }}
                  />
                )}
                <span style={hubTileIconWrap}>
                  <IconHouse size={28} />
                </span>
                <span style={hubTileTitle}>בונה הבית</span>
                {houseDone ? (
                  /* ONE sentence. The old introductory line ("בחישוב
                     החללים... יוצא כ-N מ״ר") is gone: both numbers now
                     live in the comparison itself, so repeating one of
                     them above it said nothing extra. */
                  <>
                    {(() => {
                      const msg = houseAreaMessage(houseAreaComparison, targetAreaY, computedHouseArea)
                      return msg ? (
                        <span style={{
                          fontSize: 12.5, lineHeight: 1.5,
                          color: msg.color, fontWeight: 500,
                        }}>
                          {msg.text}
                        </span>
                      ) : null
                    })()}
                  </>
                ) : (
                  <>
                    <span style={hubTileDesc}>מבנה הבית והחללים</span>
                    {houseStatusLine && (
                      <span style={{
                        fontSize: 12.5, fontWeight: 500, marginTop: 2,
                        color: houseStatusLine.color,
                      }}>
                        {houseStatusLine.text}
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>

            {/* The "סיים ושלח" final-submit button + its explanatory
                copy were REMOVED. The workflow changed: the client no
                longer submits the programming module — Einav sees the
                data live at any time, and the client's data stays
                editable indefinitely. Auto-save + the manual
                "שמור טיוטה" button keep persisting everything.

                The submit machinery below (handleSubmit, the confirm
                dialog, the `submitted` / `submitted_at` columns and
                the isLocked read-only path) is intentionally LEFT IN
                PLACE but is now unreachable from the client UI —
                nothing sets confirmSubmitOpen any more. Existing rows
                that were already submitted still render their banner
                and stay locked; no DB columns were dropped. */}

            {/* DEV-ONLY reactivate — resets submitted / submitted_at
                and the two per-part flags so the flow can be re-tested
                from scratch. import.meta.env.DEV is false in prod
                builds → button not rendered → dead code eliminated. */}
            {import.meta.env.DEV && (
              <div style={{
                marginTop: 24, paddingTop: 12,
                borderTop: '1px dashed #e5e3dd',
                textAlign: 'center', direction: 'rtl',
              }}>
                <button
                  type="button"
                  onClick={handleDevReactivate}
                  title="כלי מפתחים בלבד — לא זמין בגרסת production"
                  style={{
                    background:  'transparent',
                    color:       '#c94b4b',
                    border:      '1px dashed #c94b4b',
                    borderRadius: 6,
                    padding:     '4px 10px',
                    fontFamily:  'inherit',
                    fontSize:    11.5,
                    cursor:      'pointer',
                    opacity:     0.8,
                  }}
                >
                  החזר שאלון לפעיל (DEV)
                </button>
              </div>
            )}
          </>
        ) : view === 'house' ? (
          /* ── HOUSE-BUILDER VIEW (Stage C-3) ──────────────────────
             Persisted to answers.house. HouseBuilderV2 hydrates from
             initialData, broadcasts every state change via onChange
             which writes it straight into `answers` on the parent so
             the shared debounced auto-save picks it up automatically.
             onBack (silent save → hub) and onDone (explicit save of
             the house JSON + meta.house_done, then → hub) are the
             "flush" paths.
             readOnly mirrors the parent lock (status === 'submitted')
             so a locked row disables every mutating control.
             The builder hosts the "שמור טיוטה" button INSIDE its
             footer — we pass the immediate-save handler + the two
             in-flight flags via onManualSave / savingDraft /
             savedFlash props. */
          <>
            <HouseBuilderV2
              initialData={answers?.house || null}
              onChange={handleHouseChange}
              onBack={handleHouseBack}
              onDone={handleHouseDone}
              readOnly={isLockedForViewer}
              onManualSave={handleManualSave}
              savingDraft={savingDraft}
              doneChecked={houseDone}
              onDoneChange={handleHouseDoneChange}
              savedFlash={savedFlash}
            />
          </>
        ) : (
          /* ── QUESTIONNAIRE VIEW ──────────────────────────────────
             Existing 5-step form, plus a top back-link that returns
             the client to the hub. "סיום ושליחה" on the last step
             saves and also returns to the hub (goNext handles that). */
          <>
            {/* Back-arrow now lives on the screen-title row above —
                see the header block at the top of this return. */}

            {/* Step pills — clickable, current one filled sage. Scrolls
                horizontally on narrow mobile so all steps stay reachable. */}
            <div style={{
              display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto',
              paddingBottom: 4, direction: 'rtl',
            }}>
              {QUESTIONNAIRE_STEPS.map((s, i) => {
                const active = i === stepIndex
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => jumpToStep(i)}
                    aria-current={active ? 'step' : undefined}
                    title={s.title}
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

            {/* Step counter + current step title. Also the scroll-to-top
                anchor (stepBodyRef) — deliberately NOT the step-pills
                row above, which is itself overflowX:auto: resetting its
                scroll would drag the pill strip back to step 1. This is
                a plain block, so scrollTo(0,0) on it is a harmless no-op
                and only the walk-up to the real scroller matters. */}
            <div
              ref={stepBodyRef}
              style={{ fontSize: 12.5, color: '#8a8680', marginBottom: 10 }}
            >
              שלב {stepIndex + 1} מתוך {totalSteps}
            </div>

            <section className="cp-card">
              <h2 style={{ fontSize: 17, fontWeight: 600, color: '#1a1a18', margin: '0 0 8px' }}>
                {step.title}
              </h2>
              {step.intro && (
                <p style={{ fontSize: 13.5, color: '#4a4a48', lineHeight: 1.6, margin: '0 0 16px' }}>
                  {step.intro}
                </p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {step.key === 'house_general' ? (
                  /* Chapter 5 — house-level toggles (heating floors +
                     elevator). Data lives in answers.house.general so we
                     use handleHouseChange (the same setter the builder
                     uses) instead of updateQ (which writes to
                     answers.questionnaire). */
                  <HouseGeneralSection
                    answers={answers}
                    onHouseChange={handleHouseChange}
                    isLocked={isLockedForViewer}
                  />
                ) : step.key === 'inspiration' ? (
                  /* Last chapter — the config-driven textarea block
                     PLUS a bespoke image-upload section. Images live at
                     answers.inspirationImages (NOT answers.questionnaire),
                     mirroring how house_general reaches past qData into
                     answers directly. */
                  <>
                    {step.blocks.map((block, idx) => renderBlock(block, idx, qData, updateQ, isLockedForViewer))}
                    <InspirationImagesSection
                      images={answers && answers.inspirationImages}
                      project_id={project_id}
                      onChange={handleInspirationImagesChange}
                      isLocked={isLockedForViewer}
                    />
                  </>
                ) : (
                  step.blocks.map((block, idx) => renderBlock(block, idx, qData, updateQ, isLockedForViewer))
                )}
              </div>
            </section>

            {/* Navigation row — הקודם / שמור טיוטה / הבא (or סיום ושליחה).
                Same shape as before: stays ONE row down to ~320px via
                flex-wrap: nowrap + shrinkable edge/middle buttons. */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginTop: 14,
              justifyContent: 'space-between', flexWrap: 'nowrap',
            }}>
              <button
                type="button"
                onClick={goPrev}
                disabled={stepIndex === 0 || savingDraft}
                style={{
                  flex:        '0 1 108px',
                  minWidth:    100,
                  background:  'none', border: '1px solid #d9d6cd', borderRadius: 8,
                  padding:     '8px 4px', textAlign: 'center',
                  cursor:      (stepIndex === 0 || savingDraft) ? 'not-allowed' : 'pointer',
                  fontFamily:  'inherit', fontSize: 14, color: '#4a4a48',
                  opacity:     (stepIndex === 0) ? 0.4 : 1,
                  boxSizing:   'border-box',
                }}
              >
                הקודם
              </button>

              <button
                type="button"
                className="cp-shared-upload-btn"
                onClick={handleManualSave}
                disabled={isLockedForViewer || savingDraft}
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
          </>
        )}

        {/* ── Confirm-submit dialog ──────────────────────────────────
              Overlays the page. Cancel = close & drop error. Confirm =
              handleConfirmSubmit (flush draft → set submitted=true).
              Backdrop click also cancels. The dialog is only rendered
              when open, so it doesn't interfere with normal focus. */}
        {confirmSubmitOpen && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => { if (!submitting) setConfirmSubmitOpen(false) }}
            style={{
              position: 'fixed', inset: 0, zIndex: 60,
              background: 'rgba(26,26,24,0.42)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 16, direction: 'rtl',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#ffffff', borderRadius: 14,
                padding: '20px 20px 16px',
                maxWidth: 400, width: '100%',
                boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
                textAlign: 'right',
              }}
            >
              <h2 style={{
                margin: '0 0 10px', fontSize: 17, fontWeight: 600, color: '#1a1a18',
              }}>
                שליחת השאלון
              </h2>
              <p style={{
                margin: '0 0 16px', fontSize: 14, color: '#4a4a48', lineHeight: 1.6,
              }}>
                לאחר השליחה לא ניתן יהיה לערוך את השאלון. לשלוח?
              </p>

              {submitError && (
                <div style={{
                  background: '#fdecea', border: '1px solid #f5c6c6',
                  color: '#a02525', fontSize: 13, borderRadius: 8,
                  padding: '8px 10px', marginBottom: 12,
                }}>
                  {submitError}
                </div>
              )}

              <div style={{
                display: 'flex', gap: 8, justifyContent: 'flex-start',
              }}>
                <button
                  type="button"
                  onClick={handleConfirmSubmit}
                  disabled={submitting}
                  style={{
                    background: '#7a9478', color: '#ffffff',
                    border: '1px solid #5d7259', borderRadius: 8,
                    padding: '8px 20px', fontFamily: 'inherit', fontSize: 14,
                    fontWeight: 600,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                    opacity: submitting ? 0.7 : 1,
                  }}
                >
                  {submitting ? 'שולח...' : 'שלח'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmSubmitOpen(false)}
                  disabled={submitting}
                  style={{
                    background: '#ffffff', color: '#4a4a48',
                    border: '1px solid #d9d6cd', borderRadius: 8,
                    padding: '8px 20px', fontFamily: 'inherit', fontSize: 14,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  ביטול
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
