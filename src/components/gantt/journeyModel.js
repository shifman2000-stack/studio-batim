// src/components/gantt/journeyModel.js
//
// Derives the client "journey" view from the SAME grid the manager Gantt
// draws — src/components/gantt/gridDefinition.js. Nothing about the journey
// is written down twice: the point names, their order, which track they
// belong to, their vertical row and the cross-track arrows are all read off
// GANTT_GRID here. Change the grid and both screens follow.
//
// Pure functions only — no React, no Supabase. Status always arrives from
// the caller as projects.gantt_state.

import { GANTT_GRID, GANTT_COL_KEYS, MEGA_STAGE_LABELS } from './gridDefinition'

/* One point's status. A key missing from gantt_state means the step has not
   been reached — the same default the accordion and the manager Gantt use. */
export const statusOf = (ganttState, pointId) => ganttState?.[pointId] || 'future'

/**
 * Flattens the grid into the journey's own shape.
 *
 *   points   — chronological: all of track 0 top-to-bottom, then track 1, …
 *              { pointId, label, track, trackIndex, trackLabel, row, indexInTrack }
 *   tracks   — the four mega-stages, each with its own points
 *   crossEdges    — arrows BETWEEN tracks, from `arrowTo`
 *   sequenceEdges — the implicit "next step in this track" links
 */
export function buildJourney() {
  const points = []
  const byId = {}

  GANTT_COL_KEYS.forEach((track, trackIndex) => {
    let indexInTrack = 0
    GANTT_GRID.forEach((row, rowIndex) => {
      const cell = row[track]
      if (!cell) return
      const point = {
        pointId: cell.id,
        label: cell.label,
        track,
        trackIndex,
        trackLabel: MEGA_STAGE_LABELS[track],
        row: rowIndex,
        indexInTrack: indexInTrack++,
      }
      points.push(point)
      byId[point.pointId] = point
    })
  })

  const tracks = GANTT_COL_KEYS.map((key, index) => ({
    key,
    index,
    label: MEGA_STAGE_LABELS[key],
    points: points.filter(p => p.track === key),
  }))

  /* Cross-track arrows, resolved exactly as ProjectGantt.jsx resolves them:
     `arrowTo` names a COLUMN, and the target is that column's cell in the
     SAME ROW — which is why the manager's arrow is a horizontal line across
     one row. Reproducing the rule here rather than the six resulting pairs
     keeps the two screens honest about the same source. */
  const crossEdges = []
  GANTT_GRID.forEach(row => {
    for (const track of GANTT_COL_KEYS) {
      const cell = row[track]
      if (!cell?.arrowTo) continue
      const target = row[cell.arrowTo]
      if (target) crossEdges.push({ from: cell.id, to: target.id })
    }
  })

  const sequenceEdges = []
  for (const t of tracks) {
    for (let i = 1; i < t.points.length; i++) {
      sequenceEdges.push({ from: t.points[i - 1].pointId, to: t.points[i].pointId })
    }
  }

  return { points, byId, tracks, crossEdges, sequenceEdges, rowCount: GANTT_GRID.length }
}

/**
 * TEMPORARY RULE — TO BE REPLACED.
 *
 * gantt_state can legitimately mark SEVERAL points 'current' at once, and on
 * Dev at least one project does. The journey header, the initial selection
 * and the "חזרה למשימה הנוכחית" button each need exactly one, so until the
 * product decides what several active steps should mean, we take the
 * chronologically first: lowest grid row, and on a tie the earlier track.
 *
 * Everything that needs "the current task" calls THIS function, so replacing
 * the rule later is a one-place change.
 */
export function pickCurrentPoint(points, ganttState) {
  const active = points.filter(p => statusOf(ganttState, p.pointId) === 'current')
  if (active.length === 0) return null
  return active
    .slice()
    .sort((a, b) => a.row - b.row || a.trackIndex - b.trackIndex)[0]
}

/* What the screen opens on. The current task when there is one; otherwise the
   first step still ahead; and on a finished project, the very last step. */
export function pickInitialPoint(points, ganttState) {
  const current = pickCurrentPoint(points, ganttState)
  if (current) return current
  return points.find(p => statusOf(ganttState, p.pointId) !== 'done')
      || points[points.length - 1]
      || null
}

/* The panel's two relation rows. Both directions come from the same edge
   set the map draws, so a link can never point at something the map does
   not show. */
export function relationsFor(journey, pointId) {
  const all = [...journey.crossEdges, ...journey.sequenceEdges]
  const dependsOn = all.filter(e => e.to === pointId).map(e => journey.byId[e.from]).filter(Boolean)
  const enables   = all.filter(e => e.from === pointId).map(e => journey.byId[e.to]).filter(Boolean)
  return { dependsOn, enables }
}

/* Counts for the summary line and the per-track headings. */
export function countStatuses(points, ganttState) {
  let done = 0, current = 0
  for (const p of points) {
    const s = statusOf(ganttState, p.pointId)
    if (s === 'done') done++
    else if (s === 'current') current++
  }
  return { done, current, total: points.length, remaining: points.length - done }
}
