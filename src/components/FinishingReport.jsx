// src/components/FinishingReport.jsx
// Pure-render report used by FinishingPrintView. No data fetching here.

import { Fragment } from 'react'
import './FinishingReport.css'

function fmtDate(d) {
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year  = d.getFullYear()
  return `${day}/${month}/${year}`
}

/* keep rows where at least one of the five customer-facing fields is filled */
function isFilled(item) {
  const fields = [item.client_choice, item.quantity, item.dimension, item.supplier, item.notes]
  return fields.some(v => v !== null && v !== undefined && String(v).trim() !== '')
}

export default function FinishingReport({ data }) {
  const project       = data.project       || {}
  const firstContact  = data.first_contact || {}
  const clientInfo    = data.client_info   || {}
  const allItems      = Array.isArray(data.items) ? data.items : []

  /* keep only filled rows; preserve sort_order */
  const items = allItems
    .filter(isFilled)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const clientName  =
    [firstContact.first_name, firstContact.last_name].filter(Boolean).join(' ').trim() || '—'
  const clientPhone = firstContact.phone || '—'
  const clientCity  = clientInfo.city    || '—'
  const today       = fmtDate(new Date())

  /* group by category preserving first-appearance order */
  const groupedMap = new Map()
  items.forEach(item => {
    if (!groupedMap.has(item.category)) groupedMap.set(item.category, [])
    groupedMap.get(item.category).push(item)
  })
  const groups = [...groupedMap.entries()].map(([category, list]) => ({ category, items: list }))

  const finishingNotes = (project.finishing_notes ?? '').trim()

  return (
    <div className="fr-page">

      {/* ── Header ── */}
      <div className="fr-header">
        <div className="fr-brand">סטודיו בָּתִים</div>
        <h1 className="fr-title">חומרי גמר{project.name ? ` — ${project.name}` : ''}</h1>
        <div className="fr-meta-line">
          <span className="fr-meta-label">שם לקוח: </span>{clientName}
          {'  |  '}
          <span className="fr-meta-label">טלפון: </span><span dir="ltr">{clientPhone}</span>
          {'  |  '}
          <span className="fr-meta-label">כתובת: </span>{clientCity}
          {'  |  '}
          <span className="fr-meta-label">תאריך: </span>{today}
        </div>
      </div>

      {/* ── Body: one <table> for all groups. Column header in <thead> is
            shown ONCE at the top and re-printed by the browser on each new page
            (default `table-header-group` behavior). Category headers are <tr>s
            with a colSpan-7 <td> styled as the group divider. ── */}
      {groups.length === 0 ? (
        <div style={{ marginTop: '14mm', color: '#8a8680', fontSize: '12px' }}>
          טרם נבחרו פריטים בחומרי הגמר.
        </div>
      ) : (
        <table className="fr-table">
          <thead>
            <tr>
              <th className="fr-col-element">אלמנט</th>
              <th className="fr-col-guidance">הנחיות לבחירה</th>
              <th className="fr-col-client-choice">בחירת הלקוח</th>
              <th className="fr-col-quantity">כמות</th>
              <th className="fr-col-dimension">מידה</th>
              <th className="fr-col-supplier">ספק</th>
              <th className="fr-col-notes">הערות</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ category, items: catItems }) => (
              <Fragment key={category}>
                <tr className="fr-category-row">
                  <td colSpan={7} className="fr-category">{category}</td>
                </tr>
                {catItems.map(item => (
                  <tr key={item.id}>
                    <td className="fr-col-element">{item.element             || '—'}</td>
                    <td className="fr-col-guidance">{item.guidance           || '—'}</td>
                    <td className="fr-col-client-choice">{item.client_choice || '—'}</td>
                    <td className="fr-col-quantity">{item.quantity           || '—'}</td>
                    <td className="fr-col-dimension">{item.dimension         || '—'}</td>
                    <td className="fr-col-supplier">{item.supplier           || '—'}</td>
                    <td className="fr-col-notes">{item.notes                 || '—'}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Footer: general notes (if any) + disclaimer + signature ── */}
      {finishingNotes && (
        <div className="fr-notes-block">
          <div className="fr-notes-heading">הערות כלליות</div>
          <div className="fr-notes-body">{finishingNotes}</div>
        </div>
      )}

      <div className="fr-signature">
        <span className="fr-signature-brand">סטודיו בתים</span>
        {' - עינב שיפמן | '}
        <span dir="ltr">052-9593927</span>
        {' | Einav.StudioB@gmail.com'}
      </div>

    </div>
  )
}
