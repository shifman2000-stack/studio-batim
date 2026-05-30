// src/components/QuantitiesReport.jsx
// Pure-render report used by QuantitiesPrintView. No data fetching here.
// Mirrors FinishingReport.jsx structure exactly.

import { Fragment } from 'react'
import './QuantitiesReport.css'

function fmtDate(d) {
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year  = d.getFullYear()
  return `${day}/${month}/${year}`
}

/* keep rows where at least one of the four customer-facing fields is filled */
function isFilled(item) {
  const fields = [item.qty_sqm, item.units, item.dimensions, item.description]
  return fields.some(v => v !== null && v !== undefined && String(v).trim() !== '')
}

export default function QuantitiesReport({ data }) {
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

  const quantitiesNotes = (project.quantities_notes ?? '').trim()

  return (
    <div className="qr-page">

      {/* ── Header ── */}
      <div className="qr-header">
        <div className="qr-brand">סטודיו בָּתִים</div>
        <h1 className="qr-title">כתב כמויות{project.name ? ` — ${project.name}` : ''}</h1>
        <div className="qr-meta-line">
          <span className="qr-meta-label">שם לקוח: </span>{clientName}
          {'  |  '}
          <span className="qr-meta-label">טלפון: </span><span dir="ltr">{clientPhone}</span>
          {'  |  '}
          <span className="qr-meta-label">כתובת: </span>{clientCity}
          {'  |  '}
          <span className="qr-meta-label">תאריך: </span>{today}
        </div>
      </div>

      {/* ── Body: one <table> for all groups (column header repeats via thead). ── */}
      {groups.length === 0 ? (
        <div style={{ marginTop: '14mm', color: '#8a8680', fontSize: '12px' }}>
          טרם נבחרו פריטים בכתב הכמויות.
        </div>
      ) : (
        <table className="qr-table">
          <thead>
            <tr>
              <th className="qr-col-item">פריט</th>
              <th className="qr-col-qty-sqm">כמות במ"ר</th>
              <th className="qr-col-units">מספר יחידות</th>
              <th className="qr-col-dimensions">מידות בס"מ</th>
              <th className="qr-col-description">תיאור</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ category, items: catItems }) => (
              <Fragment key={category}>
                <tr className="qr-category-row">
                  <td colSpan={5} className="qr-category">{category}</td>
                </tr>
                {catItems.map(item => (
                  <tr key={item.id}>
                    <td className="qr-col-item">{item.item               || '—'}</td>
                    <td className="qr-col-qty-sqm">{item.qty_sqm         || '—'}</td>
                    <td className="qr-col-units">{item.units             || '—'}</td>
                    <td className="qr-col-dimensions">{item.dimensions   || '—'}</td>
                    <td className="qr-col-description">{item.description || '—'}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Footer: general notes (if any) + signature ── */}
      {quantitiesNotes && (
        <div className="qr-notes-block">
          <div className="qr-notes-heading">הערות כלליות</div>
          <div className="qr-notes-body">{quantitiesNotes}</div>
        </div>
      )}

      <div className="qr-signature">
        <span className="qr-signature-brand">סטודיו בתים</span>
        {' - עינב שיפמן | '}
        <span dir="ltr">052-9593927</span>
        {' | Einav.StudioB@gmail.com'}
      </div>

    </div>
  )
}
