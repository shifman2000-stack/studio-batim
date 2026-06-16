// src/pages/client/ClientProgress.jsx
//
// Client portal — read-only "שלבי התקדמות".
//
// Same data source as the manager Gantt:
//   * Structure → src/components/gantt/gridDefinition.js (flattened list,
//                 each item carries its mega-stage).
//   * Status    → projects.gantt_state — JSON map of pointId →
//                 'done' | 'current' | 'future' (missing key → 'future').
//
// Rendered as an accordion of the 4 mega-stages
// (תכנון / רישוי / תוכניות עבודה / בנייה). Read-only; no writes.

import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'
import {
  buildFlatGanttList,
  CLIENT_NOTES,
} from '../../components/gantt/gridDefinition'

const IconCheck = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const IconChevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

/* Group the flat list into consecutive mega-stage buckets.
   Order is already chronological (col0 → col1 → col2 → col3). */
function groupByMega(items) {
  const groups = []
  let cur = null
  for (const it of items) {
    if (!cur || cur.megaStage !== it.megaStage) {
      cur = { megaStage: it.megaStage, items: [] }
      groups.push(cur)
    }
    cur.items.push(it)
  }
  return groups
}

/* Per-group rollup: visual status + counts + small caption text.
   - status: 'done' (all done) / 'current' (has current OR mix done+future)
             / 'future' (all future).
   - caption: 'אנחנו כאן' (has current), 'הושלם' (all done), else null —
             the mini progress meter renders {done} מתוך {total} in that
             case, so the "{n} שלבים" wording was dropped to avoid
             duplication. */
function summarizeGroup(group, ganttState) {
  let nCurrent = 0
  let nDone    = 0
  for (const it of group.items) {
    const s = ganttState?.[it.pointId] || 'future'
    if (s === 'current')   nCurrent++
    else if (s === 'done') nDone++
  }
  const total = group.items.length
  let status
  if (nCurrent > 0)         status = 'current'
  else if (nDone === total) status = 'done'
  else if (nDone > 0)       status = 'current'      /* mix done+future without current */
  else                      status = 'future'

  let caption = null
  if (nCurrent > 0)         caption = 'אנחנו כאן'
  else if (nDone === total) caption = 'הושלם'

  const percent = total === 0 ? 0 : Math.round((nDone / total) * 100)
  return { status, caption, done: nDone, total, percent }
}

export default function ClientProgress() {
  const { project_id } = useClient()
  const [ganttState, setGanttState] = useState({})
  const [openSet,    setOpenSet]    = useState(new Set())
  const [loading,    setLoading]    = useState(true)

  /* One read-only fetch. All blocks start COLLAPSED (openSet stays empty);
     the user opens whichever mega-stages they want. */
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

  const toggleOpen = (megaStage) => {
    setOpenSet(prev => {
      const next = new Set(prev)
      if (next.has(megaStage)) next.delete(megaStage)
      else next.add(megaStage)
      return next
    })
  }

  if (loading) {
    return (
      <div className="cp-page">
        <div className="cp-container">
          <h1 className="cp-screen-title">שלבי התקדמות</h1>
          <div className="cp-loading"><p>טוען...</p></div>
        </div>
      </div>
    )
  }

  const groups = groupByMega(buildFlatGanttList())

  return (
    <div className="cp-page">
      <div className="cp-container">
        <h1 className="cp-screen-title">שלבי התקדמות</h1>

        <div className="cp-progress-accordion">
          {groups.map(group => {
            const summary = summarizeGroup(group, ganttState)
            const isOpen  = openSet.has(group.megaStage)
            return (
              <section
                key={group.megaStage}
                className={`cp-progress-block cp-progress-block--${summary.status}`}
              >
                <button
                  type="button"
                  className="cp-progress-header"
                  aria-expanded={isOpen}
                  onClick={() => toggleOpen(group.megaStage)}
                >
                  <span className={`cp-progress-node cp-progress-node--${summary.status}`}>
                    {summary.status === 'done' && <IconCheck size={11} />}
                  </span>
                  <div className="cp-progress-header-text">
                    <div className="cp-progress-header-name-row">
                      <span className="cp-progress-header-name">{group.megaStage}</span>
                      {summary.caption && (
                        <span className="cp-progress-header-caption">{summary.caption}</span>
                      )}
                    </div>
                    <div className="cp-progress-meter">
                      <div className="cp-progress-meter-bar">
                        <div
                          className="cp-progress-meter-fill"
                          style={{ width: `${summary.percent}%` }}
                        />
                      </div>
                      <span className="cp-progress-meter-text">
                        {summary.done} מתוך {summary.total}
                      </span>
                    </div>
                  </div>
                  <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                    <IconChevron size={16} />
                  </span>
                </button>

                {isOpen && (
                  <ol className="cp-progress-points">
                    {group.items.map(item => {
                      const status = ganttState?.[item.pointId] || 'future'
                      const note   = CLIENT_NOTES[item.pointId]
                      return (
                        <li key={item.pointId} className="cp-progress-point">
                          <span className={`cp-progress-node cp-progress-node--${status}`}>
                            {status === 'done' && <IconCheck size={11} />}
                          </span>
                          <div className="cp-progress-body">
                            <div className={`cp-progress-label cp-progress-label--${status}`}>
                              {item.label}
                            </div>
                            {status === 'current' && (
                              <div className="cp-progress-here">אנחנו כאן</div>
                            )}
                            {note && <div className="cp-progress-note">{note}</div>}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
