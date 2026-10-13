// src/pages/intro/IntroStages.jsx
//
// Area 03 — the whole process on ONE screen, no scrolling, on a TV and
// on a 1366 laptop alike.
//
// ── WHY NOT ProjectGantt ─────────────────────────────────────────────
// The staff sheet scrolls by design: it is a working tool with a legend,
// a click-to-advance affordance and room to read. This is a wall chart.
// It shares the vocabulary — the same grid definition, the same brick
// from gantt/blockArt.jsx, the same .cpj-* colours — and nothing else.
// Extending ProjectGantt with a "wall chart" mode would have put two
// unrelated jobs in one component and risked the staff screen.
//
// ── HOW IT ALWAYS FITS ───────────────────────────────────────────────
// The row pitch is derived from the MEASURED height divided by the row
// count, not from a font size. So the map cannot outgrow its box: on a
// shorter window every row, brick and label shrinks together. That is
// the whole trick, and it is why there is no scroll container here.

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { GANTT_GRID as GRID, GANTT_COL_KEYS as COLS } from '../../components/gantt/gridDefinition'
import { BlockDrawing } from '../../components/gantt/blockArt'

const COL_LABELS = ['שלב א׳ – תכנון', 'שלב ב׳ – רישוי', 'שלב ג׳ – תוכניות עבודה', 'שלב ד׳ – בניה']

/* The two stages that lead somewhere today. Everything else is hover
   only — deliberately: a door that opens onto nothing is worse than a
   stage that is plainly just a stage. */
const OPENS = { programma: 'programma', tlat_meimad: 'vr' }

export default function IntroStages({ onOpen }) {
  const boxRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState(null)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      setBox({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    const rows = GRID.length
    const rowH = box.h / rows
    const colW = box.w / COLS.length
    /* The brick sits a fixed share in from the column's right edge, and
       the arrows are drawn from that same number — see ProjectGantt for
       why the two must not drift. */
    const BLOCK_F = 0.17
    /* ⚠️ הגובה הוא החסם האמיתי. הציור משתרע על 28 יחידות אנכית
       (y −9…19), ולכן המכנה הוא 28 ולא 36 — עם 36 הלבנה יצאה
       קטנה בשליש ממה שהשורה הרשתה. */
    const scale = Math.min(rowH * 0.92 / 28, colW * 0.13 / 36)
    return { rows, rowH, colW, BLOCK_F, scale,
      xOf: (i) => box.w - i * colW - colW * BLOCK_F,
      colLeft: (i) => box.w - (i + 1) * colW,
      yOf: (r) => r * rowH + rowH / 2 }
  }, [box])

  const ready = box.w > 0 && box.h > 0

  return (
    <div className="is-root">
      {/* ⚠️ מחוץ לתיבה הנמדדת: אם הכותרות היו בתוכה הן היו נגרעות
          מהגובה שממנו נגזר צעד השורה, והמפה הייתה גולשת בדיוק בגובהן. */}
      <div className="is-heads" aria-hidden="true">
        {COLS.map((col, i) => (
          <span key={col} className="is-head">{COL_LABELS[i]}</span>
        ))}
      </div>

      <div className="is-wrap" ref={boxRef}>
      {ready && (
        <>
          <svg className="is-svg" viewBox={`0 0 ${box.w} ${box.h}`} width={box.w} height={box.h}>
            <defs>
              <marker id="is-arrow" viewBox="0 0 7 6" refX={7} refY={3}
                markerWidth={7} markerHeight={7} markerUnits="userSpaceOnUse" orient="auto">
                <path className="is-arrow-head" d="M0 0 L7 3 L0 6 Z" />
              </marker>
            </defs>

            {/* מסילות העמודות */}
            {COLS.map((col, i) => {
              const idxs = GRID.map((r, n) => (r[col] ? n : -1)).filter(n => n >= 0)
              if (!idxs.length) return null
              return (
                <line key={col} className="is-rail" x1={geo.xOf(i)} x2={geo.xOf(i)}
                  y1={geo.yOf(idxs[0])} y2={geo.yOf(idxs[idxs.length - 1])} />
              )
            })}

            {/* חיצים בין עמודות — אותה צורה של המפה והגיליון */}
            {GRID.map((row, r) => COLS.map((col, i) => {
              const cell = row[col]
              if (!cell?.arrowTo) return null
              const to = COLS.indexOf(cell.arrowTo)
              const trim = 18 * geo.scale + 3
              const back = cell.id === 'siyum_bniya'
              const y = geo.yOf(r)
              /* ⚠️ החץ לא יוצא מהלבנה אלא מקצה העמודה: בין הלבנה
                 לקצה יושב השם, וחץ שהתחיל מהלבנה חצה אותו. בכיוון
                 ההפוך (siyum_bniya) השם נמצא בצד השני, ולכן שם החץ
                 כן יוצא מהלבנה ונעצר בקצה עמודת היעד. */
              const x1 = back ? geo.xOf(i) + trim : geo.colLeft(i)
              const x2 = back ? geo.colLeft(to) : geo.xOf(to) + trim
              return <line key={cell.id} className="is-edge" x1={x1} y1={y} x2={x2} y2={y}
                markerEnd="url(#is-arrow)" />
            }))}

            {/* הלבנים */}
            {GRID.map((row, r) => COLS.map((col, i) => {
              const cell = row[col]
              if (!cell) return null
              const on = hover === cell.id
              return (
                <g key={cell.id}
                  className={'is-brick' + (on ? ' on' : '')}
                  transform={`translate(${geo.xOf(i)} ${geo.yOf(r)}) scale(${geo.scale})`}>
                  <BlockDrawing />
                </g>
              )
            }))}
          </svg>

          {/* השמות והטווח הלחיץ — HTML מעל ה-SVG, כמו במפת המסע:
              טקסט SVG לא נשבר לשורות, והכיוון של רצף עברי עם ספרות
              יוצא שם הפוך. */}
          {GRID.map((row, r) => COLS.map((col, i) => {
            const cell = row[col]
            if (!cell) return null
            const opens = OPENS[cell.id]
            const cx = geo.xOf(i)
            return (
              <button
                key={cell.id}
                type="button"
                className={
                  'is-cell'
                  + (hover === cell.id ? ' on' : '')
                  + (opens ? ' opens' : '')
                }
                style={{
                  top: geo.yOf(r) - geo.rowH / 2,
                  height: geo.rowH,
                  /* הכפתור תופס את העמודה כולה; הריפוד דוחף את השם אל
                     משמאל ללבנה, שיושבת BLOCK_F מקצה העמודה הימני. */
                  left: box.w - (i + 1) * geo.colW,
                  width: geo.colW,
                  paddingInlineStart: geo.colW * geo.BLOCK_F + 18 * geo.scale + 6,
                  fontSize: Math.max(10.5, Math.min(17, geo.rowH * 0.46)),
                }}
                onMouseEnter={() => setHover(cell.id)}
                onMouseLeave={() => setHover(h => (h === cell.id ? null : h))}
                onFocus={() => setHover(cell.id)}
                onBlur={() => setHover(h => (h === cell.id ? null : h))}
                onClick={() => opens && onOpen(opens)}
              >
                <span>{cell.label}</span>
              </button>
            )
          }))}
        </>
      )}
      </div>
    </div>
  )
}
