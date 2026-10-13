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

  /* ── איפה באמת נגמר השם ────────────────────────────────────────────
     החצים רצים מהאות האחרונה של שם המקור ועד ממש לפני הלבנה של
     היעד. הקצה הזה נמדד ולא מחושב: רוחב של שם תלוי בפונט, במקדם
     הגודל ובשאלה אם הוא נחתך — ומקצה העמודה (שהוא מה שהיה כאן
     קודם) החץ התחיל באמצע רצועה ריקה.

     נמדד מחדש כשהתיבה משתנה — וזה גם מה שקורה כשמקדם הגודל זז,
     כי הוא נגזר מרוחב החלון — וגם כשהפונטים מסיימים להיטען, כי עד
     אז העברית נמדדת בגופן חלופי ברוחב אחר. */
  const textRefs = useRef(new Map())
  const [textLeft, setTextLeft] = useState({})
  useLayoutEffect(() => {
    const wrap = boxRef.current
    if (!wrap || !box.w) return undefined
    let cancelled = false
    const measure = () => {
      if (cancelled) return
      const base = wrap.getBoundingClientRect().left
      const next = {}
      for (const [id, el] of textRefs.current) {
        if (el?.isConnected) next[id] = el.getBoundingClientRect().left - base
      }
      setTextLeft(prev => {
        const keys = Object.keys(next)
        const same = keys.length === Object.keys(prev).length
          && keys.every(k => Math.abs((prev[k] ?? NaN) - next[k]) < 0.5)
        return same ? prev : next
      })
    }
    measure()
    document.fonts?.ready?.then(measure)
    return () => { cancelled = true }
  }, [box.w, box.h])

  /* איפה בדיוק יושב השלב שמרחפים עליו — שורה ועמודה, בשביל
     הטבעת שמצוירת מתחת לכול. */
  const hoverCell = useMemo(() => {
    if (!hover) return null
    for (let r = 0; r < GRID.length; r++) {
      for (let i = 0; i < COLS.length; i++) {
        if (GRID[r][COLS[i]]?.id === hover) return { r, i }
      }
    }
    return null
  }, [hover])

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
          {/* ⚠️ הטבעת היא שכבה נפרדת מתחת ל-SVG, ולא רקע של הכפתור.
              כרקע היא נצבעה מעל הלבנה והעלימה אותה בדיוק בשלב
              שעליו מרחפים. כאן: טבעת → לבנות וחצים → שמות. */}
          {hoverCell && (
            <div className="is-ring" style={{
              top: geo.yOf(hoverCell.r) - geo.rowH / 2,
              height: geo.rowH,
              left: box.w - (hoverCell.i + 1) * geo.colW,
              width: geo.colW,
            }} />
          )}

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
              const y = geo.yOf(r)
              /* כל החיצים אופקיים: היעד תמיד באותה שורה בהגדרת
                 הרשת, ולכן אין כאן ניתוב אנכי לטפל בו. */
              const GAP = 6
              const brickRight = (c) => geo.xOf(c) + 18 * geo.scale
              const target = GRID[r][cell.arrowTo]
              /* מספר עמודה גדול יותר = שמאלה יותר, כי העמודה הראשונה
                 היא הימנית. */
              const left = to > i
              const srcText = textLeft[cell.id]
              const tgtText = target ? textLeft[target.id] : undefined
              /* נפילה חזרה לקצה העמודה עד שהמדידה הראשונה נוחתת —
                 בדיוק מה שהיה כאן קודם, פריים אחד. */
              const x1 = left
                ? (srcText === undefined ? geo.colLeft(i) : srcText - GAP)
                : brickRight(i) + GAP
              const x2 = left
                ? brickRight(to) + GAP
                : (tgtText === undefined ? geo.colLeft(to) : tgtText - GAP)
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
                <span ref={el => { if (el) textRefs.current.set(cell.id, el) }}>
                  {cell.label}
                </span>
              </button>
            )
          }))}
        </>
      )}
      </div>
    </div>
  )
}
