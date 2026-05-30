// src/components/ContractorSpecReport.jsx
// Pure-render report used by ContractorSpecPrintView. No data fetching here.
// Mirrors FinishingReport.jsx structure exactly.

import './ContractorSpecReport.css'

function fmtDate(d) {
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year  = d.getFullYear()
  return `${day}/${month}/${year}`
}

/* keep rows where at least one of the three customer-facing fields is filled */
function isFilled(item) {
  const fields = [item.quantity, item.unit, item.notes]
  return fields.some(v => v !== null && v !== undefined && String(v).trim() !== '')
}

export default function ContractorSpecReport({ data }) {
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

  const contractorSpecNotes = (project.contractor_spec_notes ?? '').trim()

  return (
    <div className="csr-page">

      {/* ── Header ── */}
      <div className="csr-header">
        <div className="csr-brand">סטודיו בָּתִים</div>
        <h1 className="csr-title">מפרט לקבלן{project.name ? ` — ${project.name}` : ''}</h1>
        <div className="csr-meta">
          <span className="csr-meta-label">שם לקוח</span>
          <span className="csr-meta-value">{clientName}</span>
          <span className="csr-meta-label">תאריך</span>
          <span className="csr-meta-value" dir="ltr" style={{ textAlign: 'right' }}>{today}</span>

          <span className="csr-meta-label">טלפון</span>
          <span className="csr-meta-value" dir="ltr" style={{ textAlign: 'right' }}>{clientPhone}</span>
          <span className="csr-meta-label">כתובת</span>
          <span className="csr-meta-value">{clientCity}</span>
        </div>
      </div>

      {/* ── Body: grouped table ── */}
      {groups.length === 0 ? (
        <div style={{ marginTop: '14mm', color: '#8a8680', fontSize: '12px' }}>
          טרם נבחרו פריטים במפרט לקבלן.
        </div>
      ) : (
        groups.map(({ category, items: catItems }) => (
          <div key={category}>
            <div className="csr-category">{category}</div>
            <table className="csr-table">
              <thead>
                <tr>
                  <th className="csr-col-item">תאור</th>
                  <th className="csr-col-quantity">כמות</th>
                  <th className="csr-col-unit">יחידה</th>
                  <th className="csr-col-notes">הערות</th>
                </tr>
              </thead>
              <tbody>
                {catItems.map(item => (
                  <tr key={item.id}>
                    <td className="csr-col-item">{item.item         || '—'}</td>
                    <td className="csr-col-quantity">{item.quantity || '—'}</td>
                    <td className="csr-col-unit">{item.unit         || '—'}</td>
                    <td className="csr-col-notes">{item.notes       || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {/* ── Footer: general notes (if any) + signature ── */}
      {contractorSpecNotes && (
        <div className="csr-notes-block">
          <div className="csr-notes-heading">הערות כלליות</div>
          <div className="csr-notes-body">{contractorSpecNotes}</div>
        </div>
      )}

      <div className="csr-signature">
        <div className="csr-signature-brand">סטודיו בָּתִים</div>
        <div>einav.studiob@gmail.com</div>
        <div>עינב שיפמן</div>
        <div className="csr-signature-line--ltr">052-9593927</div>
      </div>

    </div>
  )
}
