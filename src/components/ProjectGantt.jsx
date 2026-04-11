import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient'

// ── Grid layout — 19 rows × 4 columns ──────────────────────────────────────
const GRID = [
  { col0: { id: 'programma',      label: 'פרוגרמה' },                                      col1: null, col2: null, col3: null },
  { col0: { id: 'tikun_rishoni',  label: 'תכנון ראשוני' },                                  col1: null, col2: null, col3: null },
  { col0: { id: 'bchira_skitsa',  label: 'בחירת סקיצה' },                                   col1: null, col2: null, col3: null },
  { col0: { id: 'tiyuv_skitsa',   label: 'טיוב סקיצה' },                                    col1: null, col2: null, col3: null },
  { col0: { id: 'ishur_rishoni',  label: 'אישור ראשוני',          arrowTo: 'col1' },         col1: { id: 'tik_meida',          label: 'תיק מידע' },                         col2: null, col3: null },
  { col0: { id: 'tlat_meimad',    label: 'תלת מימד' },                                       col1: null, col2: null, col3: null },
  { col0: { id: 'ishur_skitsa',   label: 'אישור סקיצה סופי',      arrowTo: 'col1' },         col1: { id: 'garmushka',          label: 'הכנת גרמושקה' },                     col2: null, col3: null },
  { col0: null, col1: { id: 'ishur_yishuv',    label: 'אישור ישוב' },                        col2: null, col3: null },
  { col0: null, col1: { id: 'ptikha_bakasha',  label: 'פתיחה בקשה להיתר' },                 col2: null, col3: null },
  { col0: null, col1: { id: 'bkira_merchavit', label: 'בקרה מרחבית' },                       col2: null, col3: null },
  { col0: null, col1: { id: 'ishur_risuy',     label: 'אישור רישוי',      arrowTo: 'col2' }, col2: { id: 'hachanat_tochniot', label: 'הכנת תוכניות לביצוע' },             col3: null },
  { col0: null, col1: { id: 'bkarat_techn',    label: 'בקרת תכן' },                          col2: { id: 'pgisha_ishur',       label: 'פגישת אישור' },                      col3: null },
  { col0: null, col1: { id: 'kabalat_heter',   label: 'קבלת היתר' },                         col2: { id: 'hachanat_yoatzim',   label: 'הכנת תוכניות יועצים' },             col3: null },
  { col0: null, col1: null, col2: { id: 'hagasha_makhraz', label: 'הגשת תיק פרויקט למכרז', arrowTo: 'col3' }, col3: { id: 'bchira_mefakech', label: 'בחירת מפקח/קבלן' } },
  { col0: null, col1: null, col2: null,         col3: { id: 'pgisha_biytsuv', label: 'פגישה תכנון-ביצוע' } },
  { col0: null, col1: { id: 'tofes_2', label: 'טופס 2 – אישור בנייה', arrowTo: 'col3' },    col2: null, col3: { id: 'tchilat_bniya',   label: 'תחילת בנייה' } },
  { col0: null, col1: null, col2: null,         col3: { id: 'pikuach',        label: 'פיקוח עליון + ליווי פרויקט' } },
  { col0: null, col1: null, col2: null,         col3: { id: 'pgishat_gmarim', label: 'פגישת גמרים' } },
  { col0: null, col1: { id: 'tofes_4', label: 'טופס 4 – תעודת גמר' },                       col2: null, col3: { id: 'siyum_bniya', label: 'סיום בנייה', arrowTo: 'col1' } },
]

const COL_KEYS   = ['col0', 'col1', 'col2', 'col3']
const COL_LABELS = ['שלב א׳ – תכנון', 'שלב ב׳ – רישוי', 'שלב ג׳ – תוכניות עבודה', 'שלב ד׳ – בניה']
const ROW_H      = 28

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

// ── Component ──────────────────────────────────────────────────────────────
export default function ProjectGantt({ project, isAdmin, onStateChange }) {
  const [ganttState, setGanttState] = useState(project?.gantt_state || {})
  const containerRef = useRef(null)
  const legendRef    = useRef(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [legendH, setLegendH] = useState(40)

  useEffect(() => {
    setGanttState(project?.gantt_state || {})
  }, [project?.gantt_state])

  useEffect(() => {
    const update = () => {
      if (containerRef.current) setContainerWidth(containerRef.current.offsetWidth)
      if (legendRef.current)    setLegendH(legendRef.current.offsetHeight + 14) // +14 = marginBottom
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const getStatus = id => ganttState[id] || 'future'

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

  // Physical x of dot center for a column (RTL: col0 is rightmost)
  // Each column = containerWidth/4. Dot = center of right 30% of column.
  const getDotX = col => {
    const idx  = parseInt(col.slice(3))
    const colW = containerWidth / 4
    return containerWidth - idx * colW - colW * 0.15
  }

  // Physical x of the LEFT edge of a column's text area (= the column's left boundary)
  const getColLeftEdgeX = col => {
    const idx = parseInt(col.slice(3))
    return containerWidth * (3 - idx) / 4
  }

  return (
    <div style={{ fontFamily: "'Heebo', sans-serif", direction: 'rtl', maxWidth: '65%', marginRight: 0, paddingLeft: 16 }}>

      {/* ── Legend ── */}
      <div ref={legendRef} style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 14, paddingRight: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#52c27a', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#555' }}>הסתיים</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#1a1a18', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#555' }}>שלב נוכחי</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', border: '1.5px solid #bbb', background: 'none', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: '#555' }}>שלב עתידי</span>
        </div>
      </div>

      {/* ── Column headers ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 20px', direction: 'rtl' }}>
        {COL_KEYS.map((col, i) => (
          <div key={col} style={{ textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#1a1a18', padding: '5px 0 6px', borderBottom: '1px solid #e8e3dc' }}>
            {COL_LABELS[i]}
          </div>
        ))}
        <div />
      </div>

      {/* ── Scrollable data area ── */}
      <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 350px)', paddingLeft: 20, boxSizing: 'border-box' }}>
      <div ref={containerRef} style={{ position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) 20px', direction: 'rtl', gap: 0 }}>
          {GRID.map((row, i) => [
            ...COL_KEYS.map(col => {
              const cell     = row[col]
              const status   = cell ? getStatus(cell.id) : null
              const isDone   = status === 'done'
              const isCurr   = status === 'current'
              const range    = COL_RANGE[col]
              const inRange  = range && i >= range.first && i <= range.last
              const isFirst  = range && i === range.first
              const isLast   = range && i === range.last

              return (
                <div
                  key={`${i}-${col}`}
                  style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: ROW_H, padding: '0 2px', background: isCurr ? '#f5f5f5' : 'transparent', borderRadius: isCurr ? 4 : 0 }}
                >
                  {/* RIGHT 30% — dot + vertical line */}
                  <div style={{ width: '30%', display: 'flex', justifyContent: 'center', alignItems: 'center', position: 'relative', height: '100%' }}>
                    {inRange && (
                      <div style={{
                        position: 'absolute',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        top:    isFirst ? '50%' : 0,
                        bottom: isLast  ? '50%' : 0,
                        width: 1,
                        background: '#e0e0e0',
                        zIndex: 0,
                      }} />
                    )}
                    {cell ? (
                      <div
                        onClick={() => handleDotClick(cell.id)}
                        style={{
                          position: 'relative',
                          zIndex: 1,
                          width:  isDone || isCurr ? 18 : 16,
                          height: isDone || isCurr ? 18 : 16,
                          borderRadius: '50%',
                          flexShrink: 0,
                          background: isDone ? '#52c27a' : isCurr ? '#1a1a18' : 'none',
                          border: (!isDone && !isCurr) ? '1.5px solid #bbb' : 'none',
                          cursor: isAdmin ? 'pointer' : 'default',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {isDone ? '✓' : null}
                      </div>
                    ) : (
                      <div style={{ position: 'relative', zIndex: 1, width: 0, height: 0 }} />
                    )}
                  </div>

                  {/* LEFT 70% — label */}
                  <div style={{
                    width: '70%',
                    fontSize: 11,
                    color:      isCurr ? '#1a1a18' : '#555',
                    fontWeight: isCurr ? 600 : 400,
                    textAlign: 'left',
                    paddingRight: 4,
                    background:   'transparent',
                    borderRadius: 0,
                    height: 22,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}>
                    {cell ? cell.label : ''}
                  </div>
                </div>
              )
            }),
            <div key={`spacer-${i}`} />,
          ])}
        </div>

        {/* ── Arrow SVG overlay ── */}
        {containerWidth > 0 && (
          <svg
            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
            width={containerWidth}
            height={ROW_H * GRID.length}
            viewBox={`0 0 ${containerWidth} ${ROW_H * GRID.length}`}
          >
            <defs>
              <marker id="gantt-ah" markerWidth="6" markerHeight="5" refX="6" refY="2.5" orient="auto">
                <polygon points="0 0, 6 2.5, 0 5" fill="#aaa" />
              </marker>
            </defs>
            {GRID.map((row, i) => {
              const y = i * ROW_H + ROW_H / 2
              return COL_KEYS.map(col => {
                const cell = row[col]
                if (!cell?.arrowTo) return null
                const isReverse = cell.id === 'siyum_bniya'  // col3→col1, goes rightward
                const x1 = isReverse
                  ? getDotX(col) + 9                   // start just right of source dot
                  : getColLeftEdgeX(col)               // start at left edge of source text area
                const x2 = isReverse
                  ? getColLeftEdgeX(cell.arrowTo)      // end at left edge of target text area
                  : getDotX(cell.arrowTo) + 9          // end just right of target dot
                return (
                  <line
                    key={`arr-${cell.id}`}
                    x1={x1}
                    y1={y}
                    x2={x2}
                    y2={y}
                    stroke="#aaa"
                    strokeWidth="1"
                    strokeDasharray="4 3"
                    markerEnd="url(#gantt-ah)"
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
