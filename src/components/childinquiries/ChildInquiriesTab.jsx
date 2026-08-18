// src/components/childinquiries/ChildInquiriesTab.jsx
//
// "פרויקטי בנים" tab on the project detail page — visible only when
// the project is flagged is_parent_project (ProjectDetail.jsx gates
// the tab itself; this component assumes it's already a parent).
//
// Lists that parent's child_project_inquiries submissions (from the
// public /child-inquiry/:token form) and lets staff either convert one
// into a real child project or delete it outright (raw submissions,
// not real projects — hard delete, not archive).
//
// Self-contained like every other project-detail tab (DocumentsTab,
// SharedFilesTab, TasksTab, ...) — takes only projectId as a prop and
// manages its own data/fetching/actions.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { generateUniqueAuthCode } from '../../lib/generateAuthCode'
import { markProjectAsParent, inheritClientInfoFromParent } from '../../lib/parentProjectInheritance'
import './ChildInquiriesTab.css'

const todayISO = () => new Date().toISOString().slice(0, 10)

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()}`
}

/* Splits a single combined name into first/last, matching how
   Inquiries.jsx's handleConvert already splits contact2_name for
   project_contacts — first space is the boundary, everything after is
   the last name. */
function splitName(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return { first: null, last: null }
  const idx = trimmed.indexOf(' ')
  if (idx === -1) return { first: trimmed, last: null }
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1).trim() || null }
}

const IconFile = ({ size = 16 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
)

const IconCheckCircle = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#1D9E75"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
)

const IconPlus = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

const IconTrash = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

export default function ChildInquiriesTab({ projectId }) {
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)

  const [viewRow, setViewRow] = useState(null) // row shown in the read-only detail modal

  const [convertRow, setConvertRow] = useState(null) // row pending conversion confirm
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState('')

  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadRows = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('child_project_inquiries')
      .select('id, parent_project_id, contact1_name, contact1_phone, contact1_email, contact1_id_number, contact1_id_file_url, contact1_id_file_name, contact2_name, contact2_phone, contact2_email, contact2_id_number, contact2_id_file_url, contact2_id_file_name, plot_number, selected_model_id, submitted_at, converted_to_project, converted_project_id, project_models(name)')
      .eq('parent_project_id', projectId)
      .order('submitted_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { loadRows() }, [projectId])

  /* ── Convert → real child project ──────────────────────────────
     Mirrors Inquiries.jsx's handleConvert (same stage lookup, auth
     code generation, project_contacts creation), adapted for this
     table's simpler contact1/contact2 shape. Unlike handleConvert,
     there's no manual client_info insert here — this submission has no
     fields to seed a client_info row with, so inheritClientInfoFromParent
     is the ONLY step that touches client_info (it creates the row if
     missing). That sidesteps the insert-ordering race that had to be
     fixed in handleConvert entirely, rather than needing the same fix
     applied again. ── */
  const handleConvert = async () => {
    const row = convertRow
    setConverting(true)
    setConvertError('')
    try {
      const { data: stagesData, error: stagesErr } = await supabase
        .from('stages')
        .select('id, name')
        .order('order_index')
      if (stagesErr) throw stagesErr
      const stages = stagesData || []
      const firstStageId =
        stages.find(s => s.name === 'קליטת פרויקט')?.id
        ?? stages[0]?.id
        ?? null
      if (firstStageId == null) throw new Error('first stage lookup returned no rows')

      let authCode = null
      try {
        authCode = await generateUniqueAuthCode(supabase)
      } catch (e) {
        console.warn('handleConvert (child inquiry) — auth code generation failed:', e)
      }

      const { data: { session } } = await supabase.auth.getSession()

      const { data: newProject, error: projErr } = await supabase
        .from('projects')
        .insert([{
          name:               row.contact1_name || 'פרויקט בן',
          current_stage:      'קליטת פרויקט',
          stage_id:           firstStageId,
          stage_entered_at:   todayISO(),
          responsible_id:     session?.user?.id || null,
          urgency:            'רגיל',
          intake_date:        todayISO(),
          archived:           false,
          auth_code:          authCode,
          parent_project_id:  row.parent_project_id,
          selected_model_id:  row.selected_model_id,
        }])
        .select('id')
        .single()
      if (projErr) throw projErr
      if (!newProject) throw new Error('project insert returned no row')

      const contactRows = []
      if (row.contact1_name || row.contact1_phone || row.contact1_email) {
        const { first, last } = splitName(row.contact1_name)
        contactRows.push({
          project_id: newProject.id,
          first_name: first,
          last_name:  last,
          phone:      row.contact1_phone || null,
          email:      row.contact1_email || null,
          id_number:  row.contact1_id_number || null,
        })
      }
      if (row.contact2_name || row.contact2_phone || row.contact2_email) {
        const { first, last } = splitName(row.contact2_name)
        contactRows.push({
          project_id: newProject.id,
          first_name: first,
          last_name:  last,
          phone:      row.contact2_phone || null,
          email:      row.contact2_email || null,
          id_number:  row.contact2_id_number || null,
        })
      }
      if (contactRows.length > 0) {
        const { error: contactsErr } = await supabase.from('project_contacts').insert(contactRows)
        if (contactsErr) throw contactsErr
      }

      /* Shared logic — never duplicated. */
      await markProjectAsParent(row.parent_project_id)
      await inheritClientInfoFromParent(row.parent_project_id, newProject.id)

      /* מספר מגרש → client_info.migrash.
         Runs AFTER inheritClientInfoFromParent on purpose: `migrash` is
         one of the inheritable fields, and the value the applicant gave
         for THIS plot must win over anything copied down from the
         parent. The inherit step creates the client_info row only when
         it actually had something to copy, so the row may or may not
         exist yet — hence the select-then-update-or-insert. */
      if (row.plot_number) {
        try {
          const { data: ci } = await supabase
            .from('client_info')
            .select('id')
            .eq('project_id', newProject.id)
            .maybeSingle()
          if (ci?.id) {
            await supabase.from('client_info').update({ migrash: row.plot_number }).eq('id', ci.id)
          } else {
            await supabase.from('client_info').insert({ project_id: newProject.id, migrash: row.plot_number })
          }
        } catch (e) {
          console.warn('handleConvert (child inquiry) — migrash write failed:', e)
        }
      }

      /* Attach the uploaded ת.ז scans to the new project's matching
         document rows.

         The rows already exist: a trigger on projects
         (trg_seed_project_documents) seeds project_documents from every
         document_templates row on INSERT, so "ת.ז מבקש 1" / "ת.ז מבקש 2"
         (stage קליטת פרויקט) are present by name the moment the project
         is created.

         Attachment mirrors DocumentsTab.uploadFile exactly — a
         document_versions row plus the parent's denormalized
         file_url/file_name/status='התקבל'/date — EXCEPT that nothing is
         re-uploaded: the file is already in the same `project-files`
         bucket (under child-inquiries/), so pointing at its existing URL
         keeps preview/download/delete working identically with no copy.

         Best-effort: a failure here logs and moves on rather than
         aborting a conversion whose project + contacts already landed. */
      const idAttachments = [
        { docName: 'ת.ז מבקש 1', url: row.contact1_id_file_url, name: row.contact1_id_file_name },
        { docName: 'ת.ז מבקש 2', url: row.contact2_id_file_url, name: row.contact2_id_file_name },
      ].filter(a => a.url)

      if (idAttachments.length > 0) {
        try {
          const { data: docRows } = await supabase
            .from('project_documents')
            .select('id, name')
            .eq('project_id', newProject.id)
            .in('name', idAttachments.map(a => a.docName))

          const today = todayISO()
          for (const att of idAttachments) {
            const doc = (docRows || []).find(d => d.name === att.docName)
            if (!doc) {
              console.warn(`handleConvert (child inquiry) — no document row named "${att.docName}" on the new project; skipping its ת.ז file.`)
              continue
            }
            const fileName = att.name || decodeURIComponent(att.url.split('/').pop())
            const { error: verErr } = await supabase.from('document_versions').insert({
              document_id: doc.id,
              file_url:    att.url,
              file_name:   fileName,
              uploaded_by: session?.user?.id || null,
            })
            if (verErr) throw verErr
            const { error: docErr } = await supabase.from('project_documents').update({
              file_url:  att.url,
              file_name: fileName,
              status:    'התקבל',
              date:      today,
            }).eq('id', doc.id)
            if (docErr) throw docErr
          }
        } catch (e) {
          console.warn('handleConvert (child inquiry) — ת.ז document attach failed:', e)
        }
      }

      const { error: updErr } = await supabase
        .from('child_project_inquiries')
        .update({ converted_to_project: true, converted_project_id: newProject.id })
        .eq('id', row.id)
      if (updErr) throw updErr

      setConverting(false)
      setConvertRow(null)
      await loadRows()
    } catch (err) {
      console.error('handleConvert (child inquiry) error:', err)
      setConverting(false)
      setConvertError('לא הצלחנו להפוך את הפנייה לפרויקט. נסה שוב או פנה לתמיכה.')
    }
  }

  /* ── Delete — hard delete, raw submissions aren't real projects. ── */
  const handleDelete = async (row) => {
    setDeleting(true)
    try {
      const { error } = await supabase.from('child_project_inquiries').delete().eq('id', row.id)
      if (error) throw error
      setConfirmDeleteId(null)
      await loadRows()
    } catch (e) {
      console.error('child_project_inquiries delete error:', e)
      alert('שגיאה במחיקת הפנייה. נסה שוב.')
    }
    setDeleting(false)
  }

  if (loading) return <p className="cit-loading">טוען...</p>
  if (rows.length === 0) return <p className="cit-empty">אין עדיין פניות דרך טופס הפנייה לפרויקט בן.</p>

  return (
    <div dir="rtl">
      <table className="cit-table">
        <thead>
          <tr>
            <th className="cit-col-name">שם</th>
            <th className="cit-col-phone">טלפון</th>
            <th className="cit-col-date">תאריך קבלה</th>
            <th className="cit-col-action">טופס הפנייה</th>
            <th className="cit-col-convert">הפוך לפרויקט</th>
            <th className="cit-col-delete">×</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.id}
              className={'cit-row' + (row.converted_to_project ? ' cit-row--converted' : '')}
              onDoubleClick={row.converted_to_project ? () => navigate(`/projects/${row.converted_project_id}`) : undefined}
              title={row.converted_to_project ? 'לחיצה כפולה לפתיחת הפרויקט' : undefined}
            >
              <td className="cit-col-name">{row.contact1_name || '—'}</td>
              <td className="cit-col-phone" dir="ltr">{row.contact1_phone || '—'}</td>
              <td className="cit-col-date">{formatDate(row.submitted_at)}</td>

              <td className="cit-col-action" onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
                <button type="button" className="cit-view-btn" title="צפייה בפרטי הפנייה" onClick={() => setViewRow(row)}>
                  <IconFile />
                </button>
              </td>

              <td className="cit-col-convert" onClick={e => e.stopPropagation()}>
                {row.converted_to_project ? (
                  <span className="cit-converted-icon" title="הפך לפרויקט">
                    <IconCheckCircle />
                  </span>
                ) : (
                  <button type="button" className="cit-convert-btn" title="הפוך לפרויקט" onClick={() => setConvertRow(row)}>
                    <IconPlus />
                  </button>
                )}
              </td>

              <td className="cit-col-delete">
                {row.converted_to_project ? null : confirmDeleteId === row.id ? (
                  <div className="cit-delete-confirm">
                    <span className="cit-delete-confirm-text">למחוק?</span>
                    <button type="button" className="cit-delete-confirm-yes" onClick={() => handleDelete(row)} disabled={deleting}>מחק</button>
                    <button type="button" className="cit-delete-confirm-no" onClick={() => setConfirmDeleteId(null)} disabled={deleting}>ביטול</button>
                  </div>
                ) : (
                  <button type="button" className="cit-delete-btn" title="מחק פנייה" onClick={() => setConfirmDeleteId(row.id)}>
                    <IconTrash />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── Detail view modal ── */}
      {viewRow && (
        <div className="cit-modal-overlay" onClick={() => setViewRow(null)}>
          <div className="cit-modal" onClick={e => e.stopPropagation()}>
            <div className="cit-modal-header">
              <span className="cit-modal-title">פרטי הפנייה</span>
              <button className="cit-modal-close" onClick={() => setViewRow(null)}>×</button>
            </div>
            <div className="cit-modal-body">
              <div className="cit-detail-row">
                <span className="cit-detail-label">תאריך קבלה</span>
                <span className="cit-detail-value">{formatDate(viewRow.submitted_at)}</span>
              </div>

              <div className="cit-detail-divider" />

              <div className="cit-detail-row">
                <span className="cit-detail-label">שם — איש קשר 1</span>
                <span className="cit-detail-value">{viewRow.contact1_name || '—'}</span>
              </div>
              <div className="cit-detail-row">
                <span className="cit-detail-label">טלפון</span>
                <span className="cit-detail-value" dir="ltr">{viewRow.contact1_phone || '—'}</span>
              </div>
              <div className="cit-detail-row">
                <span className="cit-detail-label">אימייל</span>
                <span className="cit-detail-value" dir="ltr">{viewRow.contact1_email || '—'}</span>
              </div>

              {(viewRow.contact2_name || viewRow.contact2_phone || viewRow.contact2_email) && (
                <>
                  <div className="cit-detail-divider" />
                  <div className="cit-detail-row">
                    <span className="cit-detail-label">שם — איש קשר 2</span>
                    <span className="cit-detail-value">{viewRow.contact2_name || '—'}</span>
                  </div>
                  <div className="cit-detail-row">
                    <span className="cit-detail-label">טלפון</span>
                    <span className="cit-detail-value" dir="ltr">{viewRow.contact2_phone || '—'}</span>
                  </div>
                  <div className="cit-detail-row">
                    <span className="cit-detail-label">אימייל</span>
                    <span className="cit-detail-value" dir="ltr">{viewRow.contact2_email || '—'}</span>
                  </div>
                </>
              )}

              <div className="cit-detail-divider" />

              <div className="cit-detail-row">
                <span className="cit-detail-label">דגם מבוקש</span>
                <span className="cit-detail-value">{viewRow.project_models?.name || 'לא נבחר דגם'}</span>
              </div>

              {viewRow.converted_to_project && (
                <>
                  <div className="cit-detail-divider" />
                  <div className="cit-detail-row">
                    <span className="cit-detail-label">סטטוס</span>
                    <span className="cit-detail-value" style={{ color: '#1D9E75', fontWeight: 600 }}>הומר לפרויקט ✓</span>
                  </div>
                </>
              )}
            </div>
            <div className="cit-modal-footer">
              <button type="button" className="cit-modal-cancel" onClick={() => setViewRow(null)}>סגור</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Convert confirm modal ── */}
      {convertRow && (
        <div className="cit-modal-overlay" onClick={() => { if (!converting) { setConvertRow(null); setConvertError('') } }}>
          <div className="cit-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="cit-modal-header">
              <span className="cit-modal-title">הפיכת פנייה לפרויקט</span>
              <button className="cit-modal-close" onClick={() => { setConvertRow(null); setConvertError('') }} disabled={converting}>×</button>
            </div>
            <div className="cit-modal-body">
              <p style={{ margin: 0, fontSize: 15, color: '#374151', lineHeight: 1.6 }}>
                האם להפוך את הפנייה של <strong>{convertRow.contact1_name || '—'}</strong> לפרויקט בן חדש?
              </p>
              {convertError && <p className="cit-modal-error" role="alert">{convertError}</p>}
            </div>
            <div className="cit-modal-footer">
              <button className="cit-modal-cancel" onClick={() => { setConvertRow(null); setConvertError('') }} disabled={converting}>ביטול</button>
              <button className="cit-modal-save" onClick={handleConvert} disabled={converting}>
                {converting ? 'יוצר...' : 'צור פרויקט'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
