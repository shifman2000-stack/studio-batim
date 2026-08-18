// src/lib/houseBuilderConfigSource.js
//
// Runtime config-source layer for the house builder.
// -----------------------------------------------------------------
// HouseBuilder used to import FLOOR_DEFS / ROOM_PROPS / ROOM_SIZES /
// FIXED_AREAS / container helpers directly from the static config
// modules. This module lets it instead call `loadHouseBuilderConfig()`
// which:
//
//   1. Reads the ACTIVE row from public.house_builder_config in Supabase.
//   2. Adapts that DB JSON (schema: { floors, palette, rooms:{ ... } })
//      into the SAME accessor shape the builder used to import — so
//      the rest of the code stays unchanged.
//   3. On ANY failure (no row, network error, malformed JSON), returns
//      the in-code fallback config so the builder still works.
//
// The in-code static modules (houseBuilderConfig.js / houseSizeConfig.js)
// stay in place — they're the fallback + the seed source for the DB.

import { supabase }         from '../supabaseClient'
import * as staticCfg       from './houseBuilderConfig'
import { ROOM_SIZES as STATIC_ROOM_SIZES, DEFAULT_CALC_PARAMS } from './houseSizeConfig'

/* The 'חלל אחר' marker lives in the palette arrays in the DB so a
   downstream reader knows WHERE the free-text "custom room" affordance
   goes. The builder renders that affordance separately, OUTSIDE the
   palette map, so we strip the marker before handing the palette to
   HouseBuilder. */
const CUSTOM_MARKER = 'חלל אחר'

/**
 * Build the same Config shape from the current in-code static modules.
 * This is what the fallback path returns, and it's also what the DB
 * adapter uses as a shape reference.
 */
export function getFallbackConfig() {
  return {
    FLOOR_DEFS:                  staticCfg.FLOOR_DEFS,
    AREA_KEYS:                   staticCfg.AREA_KEYS,
    YARD_LABEL:                  staticCfg.YARD_LABEL,
    FLOOR_PALETTE:               staticCfg.FLOOR_PALETTE,
    getPalette:                  staticCfg.getPalette,
    displayType:                 staticCfg.displayType,
    ROOM_PROPS:                  staticCfg.ROOM_PROPS,
    ROOM_SIZES:                  STATIC_ROOM_SIZES,
    calcParams:                  { ...DEFAULT_CALC_PARAMS },
    FIXED_AREAS:                 staticCfg.FIXED_AREAS,
    CONTAINER_TYPES:             staticCfg.CONTAINER_TYPES,
    isContainer:                 staticCfg.isContainer,
    getContainerAllowedChildren: staticCfg.getContainerAllowedChildren,
    getContainerAutoChildren:    staticCfg.getContainerAutoChildren,
    getContainerRequiredTypes:   staticCfg.getContainerRequiredTypes,
    getFixedArea:                staticCfg.getFixedArea,
    hasFixedArea:                staticCfg.hasFixedArea,
    EXCLUDE_FROM_AREA_CALC_TYPES: staticCfg.EXCLUDE_FROM_AREA_CALC_TYPES,
    isExcludedFromAreaCalc:      staticCfg.isExcludedFromAreaCalc,
    /* No per-type defaultSize in the static in-code config — every
       type falls through to the caller's own DEFAULT_SIZE_KEY. */
    getDefaultSize:              () => null,
    /* Provenance marker for debugging / console warnings. */
    __source: 'in-code',
  }
}

/**
 * Adapt a DB config JSON into the Config shape the builder consumes.
 * Every branch either uses the DB-provided value or falls back to the
 * static default so a partial/malformed row can't crash the builder.
 */
function adaptDbConfig(dbConfig) {
  const fallback = getFallbackConfig()
  if (!dbConfig || typeof dbConfig !== 'object') return fallback

  const floors  = Array.isArray(dbConfig.floors)                     ? dbConfig.floors  : []
  const palette = (dbConfig.palette && typeof dbConfig.palette === 'object' && !Array.isArray(dbConfig.palette)) ? dbConfig.palette : {}
  const rooms   = (dbConfig.rooms   && typeof dbConfig.rooms   === 'object' && !Array.isArray(dbConfig.rooms))   ? dbConfig.rooms   : {}

  /* Floors — { key, name, isYard } → { key, label } (interior) + YARD_LABEL. */
  const floorDefs = floors
    .filter(f => f && !f.isYard && typeof f.key === 'string' && typeof f.name === 'string')
    .map(f => ({ key: f.key, label: f.name }))
  const yardEntry = floors.find(f => f && f.isYard && typeof f.name === 'string')
  const yardLabel = yardEntry ? yardEntry.name : fallback.YARD_LABEL
  const areaKeys  = floors.map(f => f && f.key).filter(k => typeof k === 'string')

  /* Palette — strip the 'חלל אחר' marker (rendered separately by the app). */
  const strippedPalette = {}
  for (const k of Object.keys(palette)) {
    strippedPalette[k] = Array.isArray(palette[k])
      ? palette[k].filter(t => t !== CUSTOM_MARKER)
      : []
  }

  /* Rooms — walk each entry to derive ROOM_PROPS / ROOM_SIZES /
     FIXED_AREAS / display map / container metadata. */
  const roomProps         = {}
  const roomSizes         = {}
  const fixedAreas        = {}
  const excludeFromAreaCalcTypes = []
  const displayMap        = {}
  const defaultSizes      = {}
  const containerTypes    = []
  const containerAllowed  = {}
  const containerAuto     = {}
  const containerRequired = {}

  for (const [type, def] of Object.entries(rooms)) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) continue

    /* Display name — only record when different from the code key
       (identity mapping is the default). */
    if (typeof def.name === 'string' && def.name && def.name !== type) {
      displayMap[type] = def.name
    }

    /* Sizes — accept {S,M,L} of finite positive numbers only. */
    if (def.sizes && typeof def.sizes === 'object' && !Array.isArray(def.sizes)) {
      const s = def.sizes
      if ([s.S, s.M, s.L].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) {
        roomSizes[type] = { S: s.S, M: s.M, L: s.L }
      }
    }

    /* Fixed area — a positive finite number wins over the size selector. */
    if (typeof def.fixedArea === 'number' && Number.isFinite(def.fixedArea) && def.fixedArea > 0) {
      fixedAreas[type] = def.fixedArea
    }

    /* Excluded from total house-area calc — only enable when the flag
       is strictly true (mirrors the isContainer flag below). */
    if (def.excludeFromAreaCalc === true) {
      excludeFromAreaCalcTypes.push(type)
    }

    /* Per-type defaultSize (S/M/L). Only recorded when the DB row
       carries a valid key; anything else falls through so the caller
       uses its own DEFAULT_SIZE_KEY. */
    if (def.defaultSize === 'S' || def.defaultSize === 'M' || def.defaultSize === 'L') {
      defaultSizes[type] = def.defaultSize
    }

    /* Container metadata — only enable when the flag is strictly true. */
    if (def.isContainer === true) {
      containerTypes.push(type)
      containerAllowed[type]  = Array.isArray(def.allowedChildren) ? [...def.allowedChildren] : []
      containerAuto[type]     = Array.isArray(def.autoChildren)    ? [...def.autoChildren]    : []
      containerRequired[type] = Array.isArray(def.requiredTypes)   ? [...def.requiredTypes]   : []
    }

    /* Props — DB shape { title, noTitle, type: 'single'|'multi', options }
       → in-code shape { t, radio?, noTitle?, opts }.

       An EMPTY array is recorded just like a populated one: an admin
       who clears every property group off a room type means "this type
       asks nothing", and that has to survive into ROOM_PROPS. It used
       to be skipped, which made an empty list read back as `undefined`
       and silently inherited a default set of properties the admin
       never configured — so "no properties" was unexpressible. */
    if (Array.isArray(def.props)) {
      roomProps[type] = def.props
        .filter(g => g && typeof g === 'object')
        .map(g => {
          const out = {
            t:    (typeof g.title === 'string') ? g.title : '',
            opts: Array.isArray(g.options) ? g.options.filter(o => typeof o === 'string') : [],
          }
          if (g.noTitle === true) out.noTitle = true
          if (g.type === 'single') out.radio  = true
          return out
        })
    }
  }

  /* Merge sizes: DB overrides win, static defaults fill in gaps. This
     preserves anything the DB may not include (e.g. legacy types) so
     estimateArea can still resolve them. */
  const mergedSizes = { ...fallback.ROOM_SIZES, ...roomSizes }

  /* Calculator params ("פרמטרי מחשבון") — corridorsPct / wallsPct /
     toleranceDeviationPct. Each key merges independently over the
     fallback default so a partial/malformed calcParams object (or one
     missing entirely, e.g. an older row saved before this feature)
     can't wipe out the other two values. */
  const rawCalcParams = (dbConfig.calcParams && typeof dbConfig.calcParams === 'object' && !Array.isArray(dbConfig.calcParams))
    ? dbConfig.calcParams
    : {}
  const calcParams = { ...fallback.calcParams }
  for (const k of ['corridorsPct', 'wallsPct', 'toleranceDeviationPct']) {
    const v = rawCalcParams[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) calcParams[k] = v
  }

  return {
    FLOOR_DEFS:      floorDefs.length ? floorDefs : fallback.FLOOR_DEFS,
    AREA_KEYS:       areaKeys.length  ? areaKeys  : fallback.AREA_KEYS,
    YARD_LABEL:      yardLabel,
    FLOOR_PALETTE:   Object.keys(strippedPalette).length ? strippedPalette : fallback.FLOOR_PALETTE,
    getPalette: (k) => {
      const p = strippedPalette[k]
      if (Array.isArray(p)) return [...p]
      return fallback.getPalette(k)
    },
    displayType: (t) => (t && displayMap[t]) || t,
    ROOM_PROPS:      roomProps,
    ROOM_SIZES:      mergedSizes,
    calcParams,
    FIXED_AREAS:     fixedAreas,
    CONTAINER_TYPES: containerTypes.length ? containerTypes : fallback.CONTAINER_TYPES,
    isContainer: (t) => containerTypes.includes(t),
    getContainerAllowedChildren: (t) => Array.isArray(containerAllowed[t])  ? [...containerAllowed[t]]  : [],
    getContainerAutoChildren:    (t) => Array.isArray(containerAuto[t])     ? [...containerAuto[t]]     : [],
    getContainerRequiredTypes:   (t) => Array.isArray(containerRequired[t]) ? [...containerRequired[t]] : [],
    getFixedArea: (t) => {
      const v = fixedAreas[t]
      return (typeof v === 'number' && Number.isFinite(v) && v > 0) ? v : null
    },
    hasFixedArea: (t) => {
      const v = fixedAreas[t]
      return typeof v === 'number' && Number.isFinite(v) && v > 0
    },
    EXCLUDE_FROM_AREA_CALC_TYPES: excludeFromAreaCalcTypes,
    isExcludedFromAreaCalc: (t) => excludeFromAreaCalcTypes.includes(t),
    /* Per-type default size — returns 'S'|'M'|'L' when the DB row
       carries a valid key, else null so callers fall through to
       their own default. */
    getDefaultSize: (t) => {
      const v = defaultSizes[t]
      return (v === 'S' || v === 'M' || v === 'L') ? v : null
    },
    __source: 'db',
  }
}

/**
 * Fetch the active row from Supabase and return an adapted Config.
 * Any failure at ANY step returns the in-code fallback and logs a
 * console.warn — the caller never has to handle errors.
 */
export async function loadHouseBuilderConfig() {
  try {
    const { data, error } = await supabase
      .from('house_builder_config')
      .select('config')
      .eq('is_active', true)
      .maybeSingle()
    if (error) {
      console.warn('house-builder config: DB query failed; falling back to in-code config.', error)
      return getFallbackConfig()
    }
    if (!data || !data.config) {
      console.warn('house-builder config: no active row found; falling back to in-code config.')
      return getFallbackConfig()
    }
    return adaptDbConfig(data.config)
  } catch (e) {
    console.warn('house-builder config: unexpected error; falling back to in-code config.', e)
    return getFallbackConfig()
  }
}
