import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'
// Grid layout (19 rows × 4 columns) lives in the shared module so the
// client-portal "שלבי התקדמות" screen reads the same source. Aliased to
// the original local name to keep this file's rendering logic identical.
import { GANTT_GRID as GRID } from './gantt/gridDefinition'
// The isometric block, and the colours that paint it, come from the client
// journey map — same art file, same .cpj-block--<status> rules. This screen
// contributes the LAYOUT (four columns, a row per stage, the name beside the
// block) and nothing else; it never redefines how a block looks.
import { BlockDrawing, MiniBlock } from './gantt/blockArt'
import '../pages/client/ClientProgressJourney.css'
import './ProjectGantt.css'

const COL_KEYS   = ['col0', 'col1', 'col2', 'col3']
const COL_LABELS = ['שלב א׳ – תכנון', 'שלב ב׳ – רישוי', 'שלב ג׳ – תוכניות עבודה', 'שלב ד׳ – בניה']

/* ── Size ──────────────────────────────────────────────────────────────
   One factor, --pg-k, measured from the real width and multiplied into
   every dimension — row height, block, label, legend, arrowheads, stroke
   widths. Same device as --cpj-k on the client map, for the same reason:
   the screen has to grow as a drawing, not as a font size.

   K_BASE is the width at which the numbers below are taken literally.
   Below it the screen simply stops shrinking; the tab is a desktop tab. */
const ROW_H  = 42      // at k = 1
const K_BASE = 900
const K_MAX  = 1.3

/* The block is drawn at BLOCK_SCALE in its own units — its faces span
   x ∓18, so this is a 36×26px block at k = 1, against the 29×21 the phone
   map draws. */
const BLOCK_SCALE = 1

/* ⚠️ The share of a column taken by the block band, and therefore where the
   block's centre sits, measured from the column's right edge. It MUST match
   .pg-art's inline-size in ProjectGantt.css: the cross-column arrows are
   drawn from this number, and a band that drifted from it left every
   arrowhead stopping short of the block it points at. */
const ART_FRACTION = 0.46
const BLOCK_F      = ART_FRACTION / 2

// Column active row ranges (first → last row with a real stage)
const COL_RANGE = {}
COL_KEYS.forEach(col => {
  const idxs = GRID.map((row, i) => (row[col] !== null ? i : -1)).filter(i => i >= 0)
  COL_RANGE[col] = idxs.length ? { first: idxs[0], last: idxs[idxs.length - 1] } : null
})

// Per-column stage ID lists + stage→col map (for per-column 'current' enforcement)
const COL_STAGE_IDS = {}
const STAGE_COL     = {}
COL_KEYS.forEach(col => {
  COL_STAGE_IDS[col] = []
  GRID.forEach(row => {
    if (row[col]) { COL_STAGE_IDS[col].push(row[col].id); STAGE_COL[row[col].id] = col }
  })
})

const STATUS_LABEL = { done: 'הסתיים', current: 'שלב נוכחי', future: 'שלב עתידי' }

// ── Component ──────────────────────────────────────────────────────────────
export default function ProjectGantt({ project, isAdmin, onStateChange }) {
  const [ganttState, setGanttState] = useState(project?.gantt_state || {})
  const containerRef = useRef(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    setGanttState(project?.gantt_state || {})
  }, [project?.gantt_state])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    const update = () => setContainerWidth(el.offsetWidth)
    update()
    /* The tab's width changes with the window AND with the app's own
       sidebar, which no resize event reports. */
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  }, [])

  const getStatus = id => ganttState[id] || 'future'

  /* ⚠️ Unchanged from the dot version: admin only, future → current → done
     → future, one 'current' per column, written straight to the row and
     reported upward. The drawing changed; this did not. */
  const handleDotClick = async id => {
    if (!isAdmin || !project) return
    const cur  = getStatus(id)
    const next = cur === 'future' ? 'current' : cur === 'current' ? 'done' : 'future'
    const newState = { ...ganttState }
    if (next === 'current') {
      COL_STAGE_IDS[STAGE_COL[id]].forEach(sid => {
        if ((newState[sid] || 'future') === 'current') newState[sid] = 'future'
      })
    }
    newState[id] = next
    await supabase.from('projects').update({ gantt_state: newState }).eq('id', project.id)
    setGanttState(newState)
    if (onStateChange) onStateChange(id, next)
  }

  const k     = Math.min(K_MAX, Math.max(1, containerWidth / K_BASE))
  const rowH  = ROW_H * k
  const scale = BLOCK_SCALE * k
  const gridH = rowH * GRID.length

  // Physical x of block centre for a column (RTL: col0 is rightmost)
  // Each column = containerWidth/4; the block is centred in the band.
  const getDotX = col => {
    const idx  = parseInt(col.slice(3))
    const colW = containerWidth / 4
    return containerWidth - idx * colW - colW * BLOCK_F
  }

  // Physical x of the LEFT edge of a column's text area (= the column's left boundary)
  const getColLeftEdgeX = col => {
    const idx = parseInt(col.slice(3))
    return containerWidth * (3 - idx) / 4
  }

  /* An arrow must not be drawn under the block it points at: both ends are
     pulled back by the block's painted half-width plus a little air, so the
     head's tip lands in clear space. 18 is the block's own half-width in
     its drawing units. */
  const trim = 18 * scale + 3 * k

  return (
    <div className="pg" style={{ '--pg-k': k, '--pg-row': `${rowH}px` }}>

      {/* ── Legend — the map's own band and swatches, with this screen's
             wording. The swatch IS the block, seen smaller. ── */}
      <div className="pg-legend">
        <span><MiniBlock status="done" />הסתיים</span>
        <span><MiniBlock status="current" />שלב נוכחי</span>
        <span><MiniBlock status="future" />שלב עתידי</span>
      </div>

      {isAdmin && (
        <p className="pg-hint">לחיצה על לבנה מחליפה את מצב השלב: עתידי → נוכחי → הסתיים.</p>
      )}

      {/* ── Column headers ── */}
      <div className="pg-heads">
        {COL_KEYS.map((col, i) => (
          <div key={col} className="pg-head">{COL_LABELS[i]}</div>
        ))}
      </div>

      {/* ── Scrollable data area ── */}
      <div className="pg-scroll">
        <div ref={containerRef} className="pg-grid-wrap">
          <div className="pg-grid">
            {GRID.map((row, i) => COL_KEYS.map(col => {
              const cell    = row[col]
              const status  = cell ? getStatus(cell.id) : null
              const range   = COL_RANGE[col]
              const inRange = range && i >= range.first && i <= range.last
              const isFirst = range && i === range.first
              const isLast  = range && i === range.last

              return (
                <div
                  key={`${i}-${col}`}
                  className={'pg-cell' + (status === 'current' ? ' pg-cell--current' : '')}
                >
                  <div className="pg-art">
                    {inRange && (
                      <div className="pg-rail" style={{
                        top:    isFirst ? '50%' : 0,
                        bottom: isLast  ? '50%' : 0,
                      }} />
                    )}
                    {cell && (
                      <svg
                        className={
                          'pg-block' +
                          ` cpj-block--${status}` +
                          (isAdmin ? ' pg-block--click' : '')
                        }
                        width={44 * scale}
                        height={34 * scale}
                        viewBox="-20 -11 44 34"
                        role={isAdmin ? 'button' : 'img'}
                        tabIndex={isAdmin ? 0 : -1}
                        aria-label={`${cell.label} — ${STATUS_LABEL[status]}`}
                        onClick={() => handleDotClick(cell.id)}
                        onKeyDown={(e) => {
                          if (!isAdmin) return
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault(); handleDotClick(cell.id)
                          }
                        }}
                      >
                        <title>{`${cell.label} — ${STATUS_LABEL[status]}`}</title>
                        <rect className="pg-hit" x={-20} y={-11} width={44} height={34} rx={8} />
                        <BlockDrawing />
                      </svg>
                    )}
                  </div>

                  <div className={'pg-label' + (cell ? ` pg-label--${status}` : '')}>
                    {cell ? cell.label : ''}
                  </div>
                </div>
              )
            }))}
          </div>

          {/* ── Arrow SVG overlay ── */}
          {containerWidth > 0 && (
            <svg
              className="pg-arrows"
              width={containerWidth}
              height={gridH}
              viewBox={`0 0 ${containerWidth} ${gridH}`}
              aria-hidden="true"
            >
              <defs>
                {/* refX on the TIP, so the head's point lands exactly on the
                    trimmed end of the line. userSpaceOnUse keeps the head the
                    same size whatever the stroke width. */}
                <marker id="pg-arrow" viewBox="0 0 7 6" refX={7} refY={3}
                  markerWidth={9 * k} markerHeight={9 * k}
                  markerUnits="userSpaceOnUse" orient="auto">
                  <path className="pg-arrow-head" d="M0 0 L7 3 L0 6 Z" />
                </marker>
              </defs>
              {GRID.map((row, i) => {
                const y = i * rowH + rowH / 2
                return COL_KEYS.map(col => {
                  const cell = row[col]
                  if (!cell?.arrowTo) return null
                  const isReverse = cell.id === 'siyum_bniya'  // col3→col1, goes rightward
                  const x1 = isReverse
                    ? getDotX(col) + trim                 // start just clear of the source block
                    : getColLeftEdgeX(col)                // start at left edge of source text area
                  const x2 = isReverse
                    ? getColLeftEdgeX(cell.arrowTo)       // end at left edge of target text area
                    : getDotX(cell.arrowTo) + trim        // end just clear of the target block
                  return (
                    <line
                      key={`arr-${cell.id}`}
                      className="pg-edge"
                      x1={x1} y1={y} x2={x2} y2={y}
                      markerEnd="url(#pg-arrow)"
                    />
                  )
                })
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
