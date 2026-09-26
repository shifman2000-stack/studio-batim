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
//   * the note under a step → CLIENT_NOTES, keyed by the same pointId
// One read-only SELECT, no writes of any kind.
//
// RTL: this screen is dir="rtl", so the FIRST track is drawn on the visual
// RIGHT — x() below counts inward from the right edge, and the CSS uses
// logical properties throughout.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'
import { CLIENT_NOTES } from '../../components/gantt/gridDefinition'
import {
  buildJourney,
  statusOf,
  pickCurrentPoint,
  pickInitialPoint,
  relationsFor,
  countStatuses,
} from '../../components/gantt/journeyModel'
import './ClientProgressJourney.css'

/* ── Map geometry ──────────────────────────────────────────────────────
   Row pitch and block size are fixed; only the width is measured, so the
   four tracks stay evenly spaced from 360px up to the desktop overlay. */
const ROW_PITCH   = 25
const TOP_PAD     = 15
const BLOCK_UNIT  = 39      // the isometric block is drawn at this nominal size
const MAX_BLOCK_W = 40

const STATUS_LABEL = { done: 'הושלם', current: 'בעבודה', future: 'בהמשך' }

/* One isometric block: three visible faces plus four hollow cells, the same
   construction as the mockup. Colour comes from the CSS classes on <g>, so
   every fill here is a token-backed CSS variable and never a literal. */
function JourneyBlock({ point, status, selected, onSelect, x, y, scale }) {
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
    <g
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
      <rect className="cpj-hit" x={x - 22} y={y - 14} width={44} height={30} />
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
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
      </g>
    </g>
  )
}

export default function ClientProgressJourney() {
  const { project_id } = useClient()
  const [ganttState, setGanttState] = useState(null)   // null until loaded
  const [projectName, setProjectName] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)

  /* Derived once — the grid is a module constant. */
  const journey = useMemo(() => buildJourney(), [])

  /* One read-only fetch, the same row the accordion read; `name` rides along
     so the heading costs no extra round-trip. */
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!project_id) { setLoading(false); return }
      const { data } = await supabase
        .from('projects')
        .select('name, gantt_state')
        .eq('id', project_id)
        .single()
      if (cancelled) return
      setGanttState(data?.gantt_state || {})
      setProjectName(data?.name || '')
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [project_id])

  /* Open on the current task — or, with nothing current, the first step still
     ahead. Runs once the data lands and never fights the user afterwards. */
  useEffect(() => {
    if (loading || selectedId) return
    const initial = pickInitialPoint(journey.points, ganttState)
    if (initial) setSelectedId(initial.pointId)
  }, [loading, selectedId, journey, ganttState])

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

  if (loading) {
    return (
      <div className="cp-page">
        <div className="cp-container">
          <div className="cp-loading"><p>טוען...</p></div>
        </div>
      </div>
    )
  }

  const state    = ganttState || {}
  const isEmpty  = Object.keys(state).length === 0
  const current  = pickCurrentPoint(journey.points, state)
  const counts   = countStatuses(journey.points, state)
  const selected = journey.byId[selectedId] || null
  const selStatus = selected ? statusOf(state, selected.pointId) : 'future'
  const relations = selected ? relationsFor(journey, selected.pointId) : { dependsOn: [], enables: [] }
  const note      = selected ? CLIENT_NOTES[selected.pointId] : null
  const flatIndex = selected ? journey.points.findIndex(p => p.pointId === selected.pointId) : -1

  /* Track 0 on the visual RIGHT: measure inward from the right edge. */
  const trackCount = journey.tracks.length
  const step  = mapWidth / trackCount
  const xOf   = (trackIndex) => mapWidth - step * (trackIndex + 0.5)
  const yOf   = (row) => TOP_PAD + row * ROW_PITCH
  const mapH  = TOP_PAD + (journey.rowCount - 1) * ROW_PITCH + 21
  const blockW = Math.min(MAX_BLOCK_W, step - 14)
  const scale  = Math.min(1, blockW / BLOCK_UNIT) * 0.91

  const goTo = (delta) => {
    const next = journey.points[flatIndex + delta]
    if (next) setSelectedId(next.pointId)
  }

  /* Only the selected point's cross-track arrows are drawn: all six at once
     is a thicket, and the panel below names them in words anyway. */
  const visibleEdges = selected
    ? journey.crossEdges.filter(e => e.from === selected.pointId || e.to === selected.pointId)
    : []

  return (
    <div className="cp-page">
      <div className="cp-container cpj">

        <div className="cpj-mast">
          <span className="cpj-brand">סטודיו בתים</span>
          <span>המסע לבית שלכם</span>
        </div>

        <h1 className="cpj-title">{projectName || 'הפרויקט שלכם'}</h1>
        <p className="cpj-summary">
          {counts.done} משימות הושלמו · {counts.remaining} עוד לפנינו
        </p>

        {isEmpty && (
          <p className="cpj-pending-note">לוח ההתקדמות יתעדכן בקרוב</p>
        )}

        {current && (
          <div className="cpj-current">
            עכשיו ב{current.trackLabel} · {current.label}
          </div>
        )}

        {/* Track headings double as jumps into each track. */}
        <div className="cpj-headings" role="group" aria-label="בחירת מסלול">
          {journey.tracks.map(track => {
            const tCounts = countStatuses(track.points, state)
            const target =
              track.points.find(p => statusOf(state, p.pointId) === 'current')
              || track.points.find(p => statusOf(state, p.pointId) !== 'done')
              || track.points[0]
            const isSelectedTrack = selected?.track === track.key
            return (
              <button
                key={track.key}
                type="button"
                className="cpj-phase"
                aria-pressed={isSelectedTrack}
                onClick={() => target && setSelectedId(target.pointId)}
              >
                {track.label}
                <small>{tCounts.done} / {tCounts.total}</small>
              </button>
            )
          })}
        </div>

        <div ref={mapRef} className="cpj-map-wrap">
          {mapWidth > 0 && (
            <svg
              className="cpj-map"
              viewBox={`0 0 ${mapWidth} ${mapH}`}
              height={mapH}
              role="img"
              aria-label={`${journey.points.length} שלבי הפרויקט בארבעה מסלולים`}
            >
              <defs>
                <marker id="cpj-arrow" viewBox="0 0 6 6" refX={5} refY={3}
                  markerWidth={7} markerHeight={7} markerUnits="userSpaceOnUse" orient="auto">
                  <path className="cpj-arrow-head" d="M0 0 L6 3 L0 6 Z" />
                </marker>
              </defs>

              {journey.tracks.map(track => (
                <line key={track.key} className="cpj-rail"
                  x1={xOf(track.index)} x2={xOf(track.index)} y1={3} y2={mapH - 8} />
              ))}

              {visibleEdges.map(edge => {
                const a = journey.byId[edge.from]
                const b = journey.byId[edge.to]
                if (!a || !b) return null
                return (
                  <line key={`${edge.from}->${edge.to}`} className="cpj-edge"
                    x1={xOf(a.trackIndex)} y1={yOf(a.row)}
                    x2={xOf(b.trackIndex)} y2={yOf(b.row)}
                    markerEnd="url(#cpj-arrow)" />
                )
              })}

              {journey.points.map(point => (
                <JourneyBlock
                  key={point.pointId}
                  point={point}
                  status={statusOf(state, point.pointId)}
                  selected={point.pointId === selectedId}
                  onSelect={setSelectedId}
                  x={xOf(point.trackIndex)}
                  y={yOf(point.row)}
                  scale={scale}
                />
              ))}
            </svg>
          )}
        </div>

        <div className="cpj-legend">
          <span><i className="cpj-swatch cpj-swatch--done" />הושלם</span>
          <span><i className="cpj-swatch cpj-swatch--current" />בעבודה</span>
          <span><i className="cpj-swatch cpj-swatch--future" />בהמשך</span>
        </div>

        {selected && (
          <section className="cpj-panel" aria-label="פרטי השלב הנבחר">
            <div className="cpj-panel-top">
              <span className="cpj-meta">{selected.trackLabel}</span>
              <span className="cpj-status" data-status={selStatus}>{STATUS_LABEL[selStatus]}</span>
            </div>

            <div className="cpj-browse">
              {/* RTL: the FIRST child lands on the visual right. "הקודם"
                  belongs on the right, so it is written first. */}
              <button type="button" className="cpj-nav" aria-label="השלב הקודם"
                disabled={flatIndex <= 0} onClick={() => goTo(-1)}>→</button>
              <div className="cpj-title-wrap" aria-live="polite">
                <h2 className="cpj-step-title">{selected.label}</h2>
                <span className="cpj-position">
                  {flatIndex + 1} מתוך {journey.points.length}
                </span>
              </div>
              <button type="button" className="cpj-nav" aria-label="השלב הבא"
                disabled={flatIndex >= journey.points.length - 1} onClick={() => goTo(1)}>←</button>
            </div>

            {note && <p className="cpj-note">{note}</p>}

            <div className="cpj-relations">
              <div className="cpj-relation-row">
                <span className="cpj-relation-label">תלוי בהשלמת</span>
                <span className="cpj-relation-links">
                  {relations.dependsOn.length === 0
                    ? <span className="cpj-relation-empty">—</span>
                    : relations.dependsOn.map(p => (
                        <button key={p.pointId} type="button" className="cpj-relation"
                          onClick={() => setSelectedId(p.pointId)}>{p.label}</button>
                      ))}
                </span>
              </div>
              <div className="cpj-relation-row">
                <span className="cpj-relation-label">מאפשר את</span>
                <span className="cpj-relation-links">
                  {relations.enables.length === 0
                    ? <span className="cpj-relation-empty">—</span>
                    : relations.enables.map(p => (
                        <button key={p.pointId} type="button" className="cpj-relation"
                          onClick={() => setSelectedId(p.pointId)}>{p.label}</button>
                      ))}
                </span>
              </div>
            </div>

            {current && (
              <button type="button" className="cpj-return"
                onClick={() => setSelectedId(current.pointId)}>
                חזרה למשימה הנוכחית ↗
              </button>
            )}
          </section>
        )}

        <p className="cpj-foot">כל אובייקט מייצג שלב · החצים מציגים תלויות בין המסלולים</p>
      </div>
    </div>
  )
}
