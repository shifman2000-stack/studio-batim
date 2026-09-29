// src/pages/client/ClientProgressJourney.jsx
//
// Client portal — read-only "שלבי התקדמות", drawn as a journey map.
//
// Replaces the accordion in ClientProgress.jsx, which is still in the tree
// and still works; see the switch note in ClientPortal.jsx.
//
// EVERYTHING on this screen is derived, nothing is transcribed:
//   * structure, tracks, vertical rows and the cross-track arrows →
//     buildJourney() over gridDefinition.js
//   * per-point status → projects.gantt_state ('done' | 'current' | 'future')
// One read-only SELECT, no writes of any kind.
//
// LAYOUT. The map is the ONLY thing that scrolls. index.css pins body and
// #root to overflow:hidden, so a screen cannot rely on the page scrolling
// for it: the portal's content frame becomes a flex column for this tab
// (.cp-content--fixed in ClientPortal.css), this file's root and .cpj carry
// that column down, and .cpj-scroll takes flex:1 / min-height:0 /
// overflow-y:auto. That is what keeps the summary, the legend and the track
// headings still while the blocks move, with exactly one scrollbar.
//
// The step detail is a floating bubble anchored to the selected block rather
// than a panel below the map — there is no "below the map" any more.
//
// RTL: this screen is dir="rtl", so the FIRST track is drawn on the visual
// RIGHT — x() below counts inward from the right edge, and the CSS uses
// logical properties throughout.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'
import {
  buildJourney,
  statusOf,
  relationsFor,
  countStatuses,
} from '../../components/gantt/journeyModel'
import './ClientProgressJourney.css'

/* ── Map geometry ──────────────────────────────────────────────────────
   Row pitch and block size are fixed; only the width is measured, so the
   four tracks stay evenly spaced from 360px up to the desktop overlay.

   ROW_PITCH is 50 because the step NAMES sit on the map: a label goes
   directly under its block, wraps to at most two lines, and the pitch is
   what guarantees it cannot reach the block on the row below. Everything
   below is derived from the numbers in one place so the two cannot drift:

       block occupies   y − 9·scale  …  y + 19·scale     (top vertex … shadow)
       label occupies   y + LABEL_TOP … + 2·LABEL_LINE
       next block tops at y + ROW_PITCH − 9·scale

   With scale ≈ 0.82 that is a clear ≈5px gap; the overlap audit in the
   verification harness checks it rather than trusting the arithmetic. */
const ROW_PITCH   = 50
const TOP_PAD     = 16
const BLOCK_UNIT  = 39      // the isometric block is drawn at this nominal size
const MAX_BLOCK_W = 38
const LABEL_TOP   = 18      // from the block's centre to the label's top edge
const LABEL_LINE  = 11      // must match .cpj-label's line-height

/* The selection wash spans the block AND its label as ONE shape — hence a
   single rect from just above the block to just below a two-line label,
   rather than a box round the block and a second one round the text. 52
   still clears the next row's block top at y + 50 − 9·scale ≈ y + 42.6. */
const SEL_TOP = 11
const SEL_H   = 52

/* An arrow runs between two block CENTRES, but it must not be DRAWN between
   them: the blocks paint after the edges, so a line ending at the target's
   centre has its last ~15px — arrowhead included — buried under the block.
   Both ends are therefore pulled back by the block's painted half-width plus
   a gap, which puts the head's tip in clear air just short of the edge.
   BLOCK_HALF_U is in the block's own units (its faces span ∓18), so it has
   to be multiplied by the same scale the block is drawn at. */
const BLOCK_HALF_U = 18
const HEAD_GAP     = 4      // clear air between the head's tip and the block

const BUBBLE_GAP = 8        // between the bubble and the block it belongs to
const BUBBLE_PAD = 6        // smallest distance from the map's side edges

const STATUS_LABEL = { done: 'הושלם', current: 'בעבודה', future: 'בהמשך' }

/* THE block drawing, in its own units — the shadow, the three faces, and the
   four hollow cells with their lips and grain edges. The map and the legend
   both render THIS and nothing else, so a legend swatch is the same picture
   seen smaller rather than a simplified stand-in that can drift from it.
   Colour comes from the .cpj-block--<status> class on a wrapping <g>. */
function BlockDrawing() {
  const project = (u, v) => [-18 + 26 * u + 10 * v, -2 - 7 * u + 8 * v]
  const pts = (arr) => arr.map(p => p.join(',')).join(' ')

  const cells = []
  for (const [u0, u1] of [[0.10, 0.44], [0.56, 0.90]]) {
    for (const [v0, v1] of [[0.13, 0.43], [0.57, 0.87]]) {
      const a = project(u0, v0), b = project(u1, v0)
      const c = project(u1, v1), d = project(u0, v1)
      cells.push({ a, b, c, d })
    }
  }

  return (
    <>
      <ellipse className="cpj-shadow" cx={1} cy={17} rx={18} ry={2} />
      <polygon className="cpj-face cpj-face--side"  points="-18,-2 -8,6 -8,17 -18,9" />
      <polygon className="cpj-face cpj-face--front" points="-8,6 18,-1 18,10 -8,17" />
      <polygon className="cpj-face cpj-face--top"   points="-18,-2 8,-9 18,-1 -8,6" />
      {cells.map(({ a, b, c, d }, i) => (
        <g key={i}>
          <polygon className="cpj-cell"      points={pts([a, b, c, d])} />
          <polygon className="cpj-cell-lip"  points={pts([a, b, [b[0], b[1] + 1.25], [a[0], a[1] + 1.25]])} />
          <path    className="cpj-cell-edge" d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]}`} fill="none" />
        </g>
      ))}
    </>
  )
}

/* Legend swatch: the map's block, unchanged, seen smaller. The viewBox is the
   drawing's FULL extent — the faces span x ∓18 and y −9…17, and the shadow
   reaches x 19 and y 19 — so nothing is cropped and the proportions are the
   map's exactly. Size comes from the SVG's CSS box alone, which takes the
   strokes down with it. */
function MiniBlock({ status }) {
  return (
    <svg className="cpj-mini" viewBox="-19 -10 38 30" aria-hidden="true" focusable="false">
      <g className={`cpj-block--${status}`}><BlockDrawing /></g>
    </svg>
  )
}

/* One block on the map: the shared drawing, placed and scaled, wrapped in
   the interaction layer — hit area, role, keyboard, and the live dot. */
function JourneyBlock({ point, status, selected, onSelect, x, y, scale }) {
  return (
    <g
      /* data-cpj-hold marks everything that must NOT clear the selection;
         the document-level listener in the screen below reads it. */
      data-cpj-hold=""
      className={
        'cpj-block' +
        ` cpj-block--${status}` +
        (selected ? ' cpj-block--selected' : '')
      }
      role="button"
      tabIndex={0}
      aria-label={`${point.label} — ${STATUS_LABEL[status]}`}
      aria-pressed={selected}
      onClick={() => onSelect(point.pointId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(point.pointId) }
      }}
    >
      <title>{`${point.label} — ${STATUS_LABEL[status]}`}</title>
      {/* Generous invisible hit area — the drawn block is ~36×26 CSS px and
          a finger is not. */}
      <rect className="cpj-hit" x={x - 22} y={y - 14} width={44} height={30} rx={8} />

      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <BlockDrawing />
      </g>

      {/* The live dot — only on a step actually in progress, so "where are
          we right now" survives even when something else is selected. */}
      {status === 'current' && (
        <circle className="cpj-live" cx={x + 17} cy={y - 10} r={3.2} />
      )}
    </g>
  )
}

export default function ClientProgressJourney() {
  const { project_id } = useClient()
  const [ganttState, setGanttState] = useState(null)   // null until loaded
  const [loading, setLoading] = useState(true)
  /* Nothing is selected when the screen opens — the map is the subject, and
     a step's detail appears only once someone asks for it. */
  const [selectedId, setSelectedId] = useState(null)

  /* Derived once — the grid is a module constant. */
  const journey = useMemo(() => buildJourney(), [])

  /* One read-only fetch. The project NAME is not read here any more: it is
     shown once, beside the tab title in the portal's own header. */
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!project_id) { setLoading(false); return }
      const { data } = await supabase
        .from('projects')
        .select('gantt_state')
        .eq('id', project_id)
        .single()
      if (cancelled) return
      setGanttState(data?.gantt_state || {})
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [project_id])

  /* Anything that is not a block, a label or the bubble clears the
     selection — empty map, the legend, the track headings, and the portal's
     own header, which is why this listens on the document rather than on
     this screen's root. Capture phase so it runs before React's own
     handlers, and pointerdown so a tap on the SELECTED block still reaches
     its onClick, which toggles it off. */
  useEffect(() => {
    if (!selectedId) return undefined
    const onDown = (e) => {
      if (e.target instanceof Element && e.target.closest('[data-cpj-hold]')) return
      setSelectedId(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [selectedId])

  /* Width drives the whole map, so it is measured rather than assumed, and
     re-measured whenever the element resizes — the desktop "תצוגת לקוח"
     overlay is a different width from a phone. */
  const mapRef = useRef(null)
  const [mapWidth, setMapWidth] = useState(0)
  useLayoutEffect(() => {
    const el = mapRef.current
    if (!el) return
    const measure = () => setMapWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [loading])

  const state    = ganttState || {}
  const selected = journey.byId[selectedId] || null

  /* Track 0 on the visual RIGHT: measure inward from the right edge. */
  const trackCount = journey.tracks.length
  const step  = mapWidth / trackCount
  const xOf   = (trackIndex) => mapWidth - step * (trackIndex + 0.5)
  const yOf   = (row) => TOP_PAD + row * ROW_PITCH
  const mapH  = TOP_PAD + (journey.rowCount - 1) * ROW_PITCH + LABEL_TOP + 2 * LABEL_LINE
  const blockW = Math.min(MAX_BLOCK_W, step - 14)
  const scale  = Math.min(1, blockW / BLOCK_UNIT) * 0.82
  /* Labels are as wide as the track allows, less a gutter, so two labels in
     the same row cannot touch. */
  const labelW = Math.max(52, step - 6)
  const edgeTrim = BLOCK_HALF_U * scale + HEAD_GAP
  const bubbleW = Math.max(150, Math.min(224, mapWidth - 2 * BUBBLE_PAD))

  /* The bubble is placed from its MEASURED height rather than a guess: its
     two relation rows wrap differently per step and per width, and a guess
     that is 10px out is a bubble hanging off the bottom of the map. It
     renders hidden, gets measured, then gets placed — one extra frame.

     Below the block by preference; above when below would overflow the
     map's own height, which is the stable choice: the bubble scrolls WITH
     the map (it lives inside the scrolled content), so a decision made
     against the scroll position would flip under the reader's finger. */
  const bubbleRef = useRef(null)
  const [bubblePos, setBubblePos] = useState(null)
  useLayoutEffect(() => {
    if (!selected || !mapWidth || !bubbleRef.current) {
      setBubblePos(prev => (prev === null ? prev : null))
      return
    }
    const h = bubbleRef.current.offsetHeight
    const x = xOf(selected.trackIndex)
    const y = yOf(selected.row)
    const below = y + LABEL_TOP + 2 * LABEL_LINE + BUBBLE_GAP
    const flip  = below + h > mapH
    const top   = flip ? y - SEL_TOP - BUBBLE_GAP - h : below
    const left  = Math.max(
      BUBBLE_PAD,
      Math.min(mapWidth - bubbleW - BUBBLE_PAD, x - bubbleW / 2),
    )
    /* Same values → same object, so React bails out instead of looping. */
    setBubblePos(prev =>
      prev && prev.left === left && prev.top === top ? prev : { left, top })
  }, [selectedId, mapWidth, bubbleW, mapH, selected])

  if (loading) {
    return (
      <div className="cp-page cpj-page">
        <div className="cp-container cpj">
          <div className="cp-loading"><p>טוען...</p></div>
        </div>
      </div>
    )
  }

  const isEmpty  = Object.keys(state).length === 0
  const counts   = countStatuses(journey.points, state)
  const relations = selected
    ? relationsFor(journey, selected.pointId)
    : { dependsOn: [], enables: [] }

  /* ALL cross-track arrows, always. The dependencies between tracks are the
     one thing the map says that a list cannot, so hiding them until a
     related block happens to be selected hid the point of the drawing.
     Sorted so the arrows touching the selection paint LAST, i.e. on top of
     the quiet ones; the class does the rest. */
  const edges = journey.crossEdges
    .map(e => ({
      ...e,
      active: !!selected && (e.from === selected.pointId || e.to === selected.pointId),
    }))
    .sort((a, b) => Number(a.active) - Number(b.active))

  /* Tapping the selected step again closes it. */
  const toggle = (pointId) =>
    setSelectedId(prev => (prev === pointId ? null : pointId))

  const relationRow = (label, list) => list.length === 0 ? null : (
    <p className="cpj-bubble-row">
      <span className="cpj-bubble-key">{label}</span>{' '}
      {list.map((p, i) => (
        <span key={p.pointId}>
          {i > 0 && ', '}
          <button type="button" className="cpj-bubble-link"
            onClick={() => setSelectedId(p.pointId)}>{p.label}</button>
        </span>
      ))}
    </p>
  )

  return (
    <div className="cp-page cpj-page">
      <div className="cp-container cpj">

        <p className="cpj-summary">
          {counts.done} משימות הושלמו · {counts.remaining} עוד לפנינו
        </p>

        {isEmpty && (
          <p className="cpj-pending-note">לוח ההתקדמות יתעדכן בקרוב</p>
        )}

        <div className="cpj-legend">
          <span><MiniBlock status="done" />הושלם</span>
          <span><MiniBlock status="current" />בעבודה</span>
          <span><MiniBlock status="future" />בהמשך</span>
        </div>

        {/* Track headings double as jumps into each track. */}
        <div className="cpj-headings" role="group" aria-label="בחירת מסלול">
          {journey.tracks.map(track => {
            const tCounts = countStatuses(track.points, state)
            return (
              <span key={track.key} className="cpj-phase">
                {track.label}
                <small>{tCounts.done} / {tCounts.total}</small>
              </span>
            )
          })}
        </div>

        {/* The one scroll container on this screen. */}
        <div ref={mapRef} className="cpj-scroll">
          <div className="cpj-map-inner" style={{ height: mapH }}>
            {mapWidth > 0 && (
              <svg
                className="cpj-map"
                viewBox={`0 0 ${mapWidth} ${mapH}`}
                height={mapH}
                role="img"
                aria-label={`${journey.points.length} שלבי הפרויקט בארבעה מסלולים`}
              >
                <defs>
                  {/* A marker is painted from its OWN subtree, not from the
                      line that references it, so a highlighted arrow needs a
                      second marker rather than a second class on the line.
                      refX sits on the TIP (viewBox x = 7), so the head's
                      point lands exactly on the trimmed end of the line.
                      userSpaceOnUse keeps the head the same size whatever
                      the stroke-width, and sized in user units it shrinks
                      with the map inside the desktop overlay's scale(0.83)
                      — 9 → ~7.5px, 11 → ~9px. */}
                  <marker id="cpj-arrow" viewBox="0 0 7 6" refX={7} refY={3}
                    markerWidth={9} markerHeight={9} markerUnits="userSpaceOnUse" orient="auto">
                    <path className="cpj-arrow-head" d="M0 0 L7 3 L0 6 Z" />
                  </marker>
                  <marker id="cpj-arrow-on" viewBox="0 0 7 6" refX={7} refY={3}
                    markerWidth={11} markerHeight={11} markerUnits="userSpaceOnUse" orient="auto">
                    <path className="cpj-arrow-head cpj-arrow-head--on" d="M0 0 L7 3 L0 6 Z" />
                  </marker>
                </defs>

                {/* FIRST, so every rail, arrow, block and — being SVG under
                    HTML — every label paints on top of it. One rect covering
                    block and label together, which is what makes the wash
                    read as a single shape rather than two. */}
                {selected && (
                  <rect className="cpj-sel" rx={9}
                    x={xOf(selected.trackIndex) - labelW / 2}
                    y={yOf(selected.row) - SEL_TOP}
                    width={labelW} height={SEL_H} />
                )}

                {journey.tracks.map(track => (
                  <line key={track.key} className="cpj-rail"
                    x1={xOf(track.index)} x2={xOf(track.index)} y1={3} y2={mapH - 8} />
                ))}

                {edges.map(edge => {
                  const a = journey.byId[edge.from]
                  const b = journey.byId[edge.to]
                  if (!a || !b) return null
                  /* Pull both ends back off the blocks. Written as a unit
                     vector rather than "subtract from x", because nothing
                     guarantees a future grid keeps every arrow horizontal. */
                  const ax = xOf(a.trackIndex), ay = yOf(a.row)
                  const bx = xOf(b.trackIndex), by = yOf(b.row)
                  const len = Math.hypot(bx - ax, by - ay) || 1
                  const ux = (bx - ax) / len, uy = (by - ay) / len
                  return (
                    <line key={`${edge.from}->${edge.to}`}
                      className={'cpj-edge' + (edge.active ? ' cpj-edge--on' : '')}
                      x1={ax + ux * edgeTrim} y1={ay + uy * edgeTrim}
                      x2={bx - ux * edgeTrim} y2={by - uy * edgeTrim}
                      markerEnd={edge.active ? 'url(#cpj-arrow-on)' : 'url(#cpj-arrow)'} />
                  )
                })}

                {journey.points.map(point => (
                  <JourneyBlock
                    key={point.pointId}
                    point={point}
                    status={statusOf(state, point.pointId)}
                    selected={point.pointId === selectedId}
                    onSelect={toggle}
                    x={xOf(point.trackIndex)}
                    y={yOf(point.row)}
                    scale={scale}
                  />
                ))}
              </svg>
            )}

            {/* Step names as HTML, positioned over the map, NOT as SVG
                <text>. Three reasons: SVG text cannot wrap, so a name like
                "פיקוח עליון + ליווי פרויקט" would run across its
                neighbours; WebKit mis-orders spaced RTL runs in SVG text,
                which is the same trap the logo fell into; and a real button
                is a real tap target. The SVG is drawn 1:1 (viewBox width ===
                measured width), so a user unit is a CSS pixel and these
                coordinates line up exactly.

                aria-hidden + tabIndex -1: the block already carries the
                accessible name and the keyboard focus for this step, and
                two controls per step would double every announcement. */}
            {mapWidth > 0 && journey.points.map(point => {
              const st = statusOf(state, point.pointId)
              return (
                <button
                  key={point.pointId}
                  type="button"
                  data-cpj-hold=""
                  aria-hidden="true"
                  tabIndex={-1}
                  className={
                    'cpj-label' +
                    ` cpj-label--${st}` +
                    (point.pointId === selectedId ? ' cpj-label--selected' : '')
                  }
                  style={{
                    /* physical `left`, deliberately: the x above is measured
                       from the SVG's left edge in both directions. */
                    left: xOf(point.trackIndex) - labelW / 2,
                    top: yOf(point.row) + LABEL_TOP,
                    width: labelW,
                  }}
                  onClick={() => toggle(point.pointId)}
                >
                  {point.label}
                </button>
              )
            })}

            {selected && mapWidth > 0 && (
              <div
                ref={bubbleRef}
                data-cpj-hold=""
                className="cpj-bubble"
                role="dialog"
                aria-label={selected.label}
                style={{
                  width: bubbleW,
                  left: bubblePos ? bubblePos.left : 0,
                  top: bubblePos ? bubblePos.top : 0,
                  visibility: bubblePos ? 'visible' : 'hidden',
                }}
              >
                <button type="button" className="cpj-bubble-x"
                  onClick={() => setSelectedId(null)} aria-label="סגירה">×</button>
                <p className="cpj-bubble-title">{selected.label}</p>
                {relationRow('תלוי בהשלמת:', relations.dependsOn)}
                {relationRow('מאפשר את:', relations.enables)}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
