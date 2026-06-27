// src/components/sharedfiles/SharedFilesTab.jsx
//
// "מרחב משותף" tab on the manager's client file (תיק לקוח).
//
// Flat list of BOTH file uploads (`shared_files`) AND free-text notes /
// requests (`project_notes`) for the current project — merged into ONE
// chronologically-sorted list, newest first. Each row carries a
// `kind: 'file' | 'note'` discriminator. Files render with the
// existing eye / download / trash action set; notes render with their
// body inline and only the trash action (no preview, no download).
//
// Two-panel split: 50% table on the right, 50% preview panel on the
// left. The left preview pane is FILES-only — clicking a note row
// doesn't touch the preview.
//
// Columns: שם קובץ / הערה | מי העלה / הוסף | תאריך | פעולות
//   actions column for files = eye / download / trash (inline confirm)
//   actions column for notes = trash (inline confirm) only.
//
// RLS is already in place on the DB. staff_full_access lets the manager
// SELECT / INSERT / DELETE everything on both shared_files and
// project_notes; no special auth handling beyond the standard supabase
// client.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import './SharedFilesTab.css'

const BUCKET = 'project-shared-files'

/* ── Helpers ──────────────────────────────────────────────────────── */
function fileExt(name) {
  if (!name) return ''
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return 'file'
  return name.slice(dot + 1).toLowerCase()
}

function previewType(name) {
  const ext = fileExt(name)
  if (['jpg','jpeg','png','gif','webp','bmp','svg','tiff','tif'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  return 'unsupported'
}

/* Storage path from public URL — used to remove the file from the
   bucket on row delete. */
function storagePath(url) {
  const marker = `/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length))
}

/* Convert Google Drive `/preview` URL to its `/view` variant for clean
   opening in a new tab. Supabase Storage URLs pass through unchanged. */
function openableUrl(url) {
  if (!url) return url
  if (url.startsWith('https://drive.google.com/') && url.includes('/preview')) {
    return url.replace('/preview', '/view')
  }
  return url
}

/* True for URLs not hosted on the project-shared-files bucket
   (e.g. external Google Drive links). Used to decide download
   vs window.open. */
function isExternalUrl(url) {
  if (!url) return false
  return !url.includes(`/object/public/${BUCKET}/`)
}

/* Fetch the file as a blob and trigger a download with the original
   (Hebrew) filename. The <a download> attribute alone is unreliable
   across origins; this works for Supabase Storage URLs. */
async function downloadBlob(url, fileName) {
  const res  = await fetch(url)
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = href
  a.download = fileName || 'file'
  a.click()
  URL.revokeObjectURL(href)
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year  = String(d.getFullYear()).slice(2)
  return `${day}/${month}/${year}`
}

/* ── Icons (match DocumentsTab visual style: 13×13 for line icons,
        14×14 for the trash bin) ──────────────────────────────────── */
const IconEye = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

const IconDownload = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

const IconTrash2 = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
)

/* ── Main component ──────────────────────────────────────────────── */
export default function SharedFilesTab({ projectId }) {
  /* `items` is the MERGED list (files + notes), uniform shape, sorted
     by date desc. Each entry has a `kind` discriminator so the row
     render can pick the right cell layout. */
  const [items,           setItems]           = useState([])
  const [namesByUserId,   setNamesByUserId]   = useState({})
  const [loading,         setLoading]         = useState(true)
  const [uploading,       setUploading]       = useState(false)
  const [previewFile,     setPreviewFile]     = useState(null) // { url, name } | null
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  /* Note-add form state — toggled open by the "+ הוסף הערה/בקשה" button
     in the toolbar. Save is blocked for blank / whitespace-only bodies. */
  const [noteFormOpen,    setNoteFormOpen]    = useState(false)
  const [noteText,        setNoteText]        = useState('')
  const [savingNote,      setSavingNote]      = useState(false)

  /* Per-note expand/collapse state — a Set of note ids that are
     currently expanded. Collapsed (default): the note cell clips to
     one line with an ellipsis. Expanded: the cell wraps to however
     many lines the body needs and the row grows to fit. Clicking the
     note text toggles. */
  const [expandedNotes,   setExpandedNotes]   = useState(() => new Set())

  const toggleNoteExpanded = (id) => {
    setExpandedNotes(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleNoteBodyKeyDown = (e, id) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleNoteExpanded(id)
    }
  }

  const fileInputRef = useRef(null)

  /* ── Load files + notes + uploader names ──────────────────────────
     Same parallel-fetch + merged-name-resolution pattern as the client
     screen. Names dance runs once across the union of uploader ids. ── */
  const loadItems = async () => {
    if (!projectId) return
    setLoading(true)

    const [filesRes, notesRes] = await Promise.all([
      supabase
        .from('shared_files')
        .select('id, file_url, file_name, uploaded_by, uploaded_at')
        .eq('project_id', projectId)
        .order('uploaded_at', { ascending: false }),
      supabase
        .from('project_notes')
        .select('id, body, uploaded_by, uploaded_at')
        .eq('project_id', projectId)
        .order('uploaded_at', { ascending: false }),
    ])

    if (filesRes.error) console.error('shared_files load error:', filesRes.error)
    if (notesRes.error) console.error('project_notes load error:', notesRes.error)

    const fileRows = Array.isArray(filesRes.data) ? filesRes.data : []
    const noteRows = Array.isArray(notesRes.data) ? notesRes.data : []

    const merged = [
      ...fileRows.map(f => ({
        kind: 'file', id: f.id, date: f.uploaded_at, uploaded_by: f.uploaded_by,
        file_url: f.file_url, file_name: f.file_name,
      })),
      ...noteRows.map(n => ({
        kind: 'note', id: n.id, date: n.uploaded_at, uploaded_by: n.uploaded_by,
        body: n.body,
      })),
    ].sort((a, b) => (b.date || '').localeCompare(a.date || ''))

    setItems(merged)

    /* ── Names lookup over MERGED uploader ids ──────────────────
       Same up-to-three-query dance as before, but the input id set now
       spans both files and notes — so it runs exactly once regardless
       of how many rows of each kind there are.

       Order:
         1) profiles      — staff uploaders.
         2) client_users  — leftover uuids; pulls project_id + email
                            + the (stale!) first_name snapshot.
         3) project_contacts — the LIVE name source for clients,
                            fetched by the project_ids gathered in (2)
                            so we can match case-insensitively in JS.
       client_users.first_name is a one-time snapshot from
       link_client_on_login; project_contacts is the source of truth
       after any rename. We only fall back to the snapshot when no live
       contact row matches. */
    const uploaderIds = Array.from(new Set(merged.map(r => r.uploaded_by).filter(Boolean)))
    const nameMap = {}
    if (uploaderIds.length > 0) {
      /* 1. Staff via profiles */
      const { data: staffRows } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', uploaderIds)

      const staffIds = new Set((staffRows || []).map(s => s.id))
      for (const s of staffRows || []) {
        const fn = (s.first_name || '').trim()
        const ln = (s.last_name || '').trim()
        const full = [fn, ln].filter(Boolean).join(' ')
        if (full) nameMap[s.id] = full
      }

      /* 2. Clients via client_users — get project_id + email + snapshot */
      const remaining = uploaderIds.filter(id => !staffIds.has(id))
      if (remaining.length > 0) {
        const { data: clientRows } = await supabase
          .from('client_users')
          .select('id, project_id, email, first_name')
          .in('id', remaining)

        const clientList = clientRows || []

        /* 3. project_contacts for the involved project_ids — LIVE name. */
        const projectIds = Array.from(new Set(
          clientList.map(c => c.project_id).filter(Boolean)
        ))
        let liveContacts = []
        if (projectIds.length > 0) {
          const { data: contactRows } = await supabase
            .from('project_contacts')
            .select('project_id, email, first_name')
            .in('project_id', projectIds)
          liveContacts = contactRows || []
        }

        for (const cu of clientList) {
          const cuEmail = (cu.email || '').trim().toLowerCase()
          let liveName = null
          if (cuEmail) {
            const match = liveContacts.find(pc =>
              pc.project_id === cu.project_id &&
              (pc.email || '').trim().toLowerCase() === cuEmail
            )
            if (match) {
              const fn = (match.first_name || '').trim()
              if (fn) liveName = fn
            }
          }
          const display = liveName || ((cu.first_name || '').trim() || null)
          if (display) nameMap[cu.id] = display
        }
      }
    }
    setNamesByUserId(nameMap)
    setLoading(false)
  }

  useEffect(() => { loadItems() }, [projectId])

  /* ── Upload flow (files) ────────────────────────────────────────── */
  const handlePickFile = () => {
    if (uploading) return
    if (fileInputRef.current) fileInputRef.current.value = ''
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (uploading) return

    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('no authenticated user')

      const ext  = fileExt(file.name)
      const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const path = `${projectId}/${uuid}.${ext}`

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file)
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

      const { error: insErr } = await supabase
        .from('shared_files')
        .insert({
          project_id:  projectId,
          file_url:    publicUrl,
          file_name:   file.name,        /* original Hebrew name preserved here */
          uploaded_by: user.id,
        })
      if (insErr) throw insErr

      await loadItems()
    } catch (err) {
      console.error('shared_files upload error:', err)
      alert('שגיאה בהעלאת הקובץ. נסה שוב.')
    }
    setUploading(false)
  }

  /* ── Save note ──────────────────────────────────────────────────── */
  const handleSaveNote = async () => {
    const body = noteText.trim()
    if (!body || savingNote) return
    setSavingNote(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('no authenticated user')

      const { error } = await supabase
        .from('project_notes')
        .insert({
          project_id:  projectId,
          body:        body,
          uploaded_by: user.id,
        })
      if (error) throw error

      setNoteText('')
      setNoteFormOpen(false)
      await loadItems()
    } catch (err) {
      console.error('project_notes insert error:', err)
      alert('שגיאה בשמירת ההערה. נסה שוב.')
    }
    setSavingNote(false)
  }

  /* ── Delete (files: storage + db; notes: db only) ────────────────
     Manager-side has NO isOwn gate — RLS staff_full_access lets the
     manager delete any row regardless of who uploaded it. ── */
  const handleDelete = async (item) => {
    try {
      if (item.kind === 'file') {
        /* Storage first — if it fails the DB row stays and we can retry.
           If storage succeeds but DB delete fails, the row is orphaned
           but harmless (links to a missing object that returns 404). */
        const path = storagePath(item.file_url)
        if (path) {
          const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
          if (rmErr) console.warn('storage remove warning:', rmErr) /* non-fatal */
        }
        const { error: delErr } = await supabase
          .from('shared_files')
          .delete()
          .eq('id', item.id)
        if (delErr) throw delErr

        /* Clear preview if it was showing the deleted file. */
        if (previewFile && previewFile.url === item.file_url) setPreviewFile(null)
      } else {
        const { error: delErr } = await supabase
          .from('project_notes')
          .delete()
          .eq('id', item.id)
        if (delErr) throw delErr
      }

      setConfirmDeleteId(null)
      await loadItems()
    } catch (err) {
      console.error('shared workspace delete error:', err)
      alert(item.kind === 'file' ? 'שגיאה במחיקת הקובץ. נסה שוב.' : 'שגיאה במחיקת ההערה. נסה שוב.')
    }
  }

  /* ── Download trigger — blob-based for Supabase Storage URLs,
        window.open for external (Google Drive) ones. ── */
  const handleDownload = (row) => {
    if (isExternalUrl(row.file_url)) {
      window.open(openableUrl(row.file_url), '_blank', 'noopener,noreferrer')
    } else {
      downloadBlob(row.file_url, row.file_name)
    }
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  const pType = previewFile ? previewType(previewFile.name) : null

  return (
    <div className="sf-root" dir="rtl">

      {/* Right panel — toolbar + table (50% of available width) */}
      <div className="sf-panel-right">

        {/* Two siblings sit in the same toolbar — gap:10 keeps them
            comfortably apart in the RTL flex container. */}
        <div className="sf-toolbar" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="sf-upload-btn"
            onClick={handlePickFile}
            disabled={uploading}
          >
            {uploading ? 'מעלה...' : '+ הוסף מסמך'}
          </button>
          <button
            type="button"
            className="sf-upload-btn"
            onClick={() => setNoteFormOpen(o => !o)}
            disabled={savingNote}
          >
            + הוסף הערה/בקשה
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />

        {/* Inline note-add form, between the toolbar and the table. */}
        {noteFormOpen && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="הערה או בקשה..."
              dir="rtl"
              style={{
                width: '100%', minHeight: 80, padding: 8, fontFamily: 'inherit',
                fontSize: 14, border: '1px solid #d9d6cd', borderRadius: 6,
                resize: 'vertical', boxSizing: 'border-box', textAlign: 'right',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                type="button"
                className="sf-upload-btn"
                onClick={handleSaveNote}
                disabled={savingNote || !noteText.trim()}
              >
                {savingNote ? 'שומר...' : 'שמור'}
              </button>
              <button
                type="button"
                onClick={() => { setNoteFormOpen(false); setNoteText('') }}
                disabled={savingNote}
                style={{
                  background: 'none', border: '1px solid #d9d6cd', borderRadius: 6,
                  padding: '6px 16px', cursor: savingNote ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontSize: 14, color: '#4a4a48',
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="sf-loading">טוען...</div>
        ) : items.length === 0 ? (
          <div className="sf-empty">אין עדיין קבצים או הערות במרחב המשותף</div>
        ) : (
          <div className="sf-table">

            {/* Table header */}
            <div className="sf-table-header">
              <div className="sf-col-name">שם קובץ / הערה</div>
              <div className="sf-col-uploader">הועלה על ידי</div>
              <div className="sf-col-date">תאריך</div>
              <div className="sf-col-actions">פעולות</div>
            </div>

            {/* Rows — branch on item.kind */}
            {items.map((item, idx) => {
              const uploaderName = item.uploaded_by ? (namesByUserId[item.uploaded_by] || '') : ''
              const rowClass     = 'sf-row' + (idx % 2 === 1 ? ' sf-row--even' : '')

              if (item.kind === 'file') {
                return (
                  <div key={`file-${item.id}`} className={rowClass}>
                    {/* שם קובץ — clickable link that opens the file in a new tab */}
                    <a
                      className="sf-col-name sf-file-link"
                      href={openableUrl(item.file_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={item.file_name}
                    >
                      {item.file_name}
                    </a>

                    <div className="sf-col-uploader" title={uploaderName}>{uploaderName}</div>
                    <div className="sf-col-date">{formatDate(item.date)}</div>

                    {/* פעולות — eye / download / trash */}
                    <div className="sf-col-actions">
                      <button
                        type="button"
                        className="sf-file-icon-btn"
                        onClick={() => setPreviewFile({ url: item.file_url, name: item.file_name })}
                        title="תצוגה מקדימה"
                      >
                        <IconEye />
                      </button>
                      <button
                        type="button"
                        className="sf-file-icon-btn"
                        onClick={() => handleDownload(item)}
                        title="הורד"
                      >
                        <IconDownload />
                      </button>
                      {confirmDeleteId === item.id ? (
                        <div className="sf-delete-confirm">
                          <span className="sf-delete-confirm-text">למחוק את הקובץ?</span>
                          <button
                            type="button"
                            className="sf-delete-confirm-yes"
                            onClick={() => handleDelete(item)}
                          >כן</button>
                          <button
                            type="button"
                            className="sf-delete-confirm-no"
                            onClick={() => setConfirmDeleteId(null)}
                          >לא</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="sf-file-icon-btn"
                          onClick={() => setConfirmDeleteId(item.id)}
                          title="מחק"
                        >
                          <IconTrash2 />
                        </button>
                      )}
                    </div>
                  </div>
                )
              }

              /* kind === 'note' — same row chrome, body in the name
                 column, actions column = trash only. The note cell is
                 the only tappable surface in the row (toggles expand
                 in place); the uploader / date / trash cells stay
                 non-interactive aside from their own existing
                 affordances. */
              const isExpanded = expandedNotes.has(item.id)
              return (
                <div key={`note-${item.id}`} className={rowClass}>
                  <div
                    className="sf-col-name"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={() => toggleNoteExpanded(item.id)}
                    onKeyDown={(e) => handleNoteBodyKeyDown(e, item.id)}
                    /* Collapsed = one line + ellipsis. Expanded = full
                       body wraps and the row grows to fit. cursor:pointer
                       on both states so the affordance reads as tappable. */
                    style={isExpanded
                      ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', color: '#1a1a18', cursor: 'pointer' }
                      : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#1a1a18', cursor: 'pointer' }
                    }
                    title={item.body}
                  >
                    <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 600, marginInlineEnd: 6 }}>הערה</span>
                    {item.body}
                  </div>

                  <div className="sf-col-uploader" title={uploaderName}>{uploaderName}</div>
                  <div className="sf-col-date">{formatDate(item.date)}</div>

                  {/* פעולות — trash only (no preview / no download). */}
                  <div className="sf-col-actions">
                    {confirmDeleteId === item.id ? (
                      <div className="sf-delete-confirm">
                        <span className="sf-delete-confirm-text">למחוק את ההערה?</span>
                        <button
                          type="button"
                          className="sf-delete-confirm-yes"
                          onClick={() => handleDelete(item)}
                        >כן</button>
                        <button
                          type="button"
                          className="sf-delete-confirm-no"
                          onClick={() => setConfirmDeleteId(null)}
                        >לא</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="sf-file-icon-btn"
                        onClick={() => setConfirmDeleteId(item.id)}
                        title="מחק"
                      >
                        <IconTrash2 />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Left panel — preview (50% of available width, sticky). FILES
          only — note rows don't have a previewable artefact and they
          don't touch this pane. */}
      <div className="sf-panel-left">
        {previewFile && (
          <>
            <div className="sf-preview-label" title={previewFile.name}>{previewFile.name}</div>
            {pType === 'image' && (
              <img
                src={previewFile.url}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                alt={previewFile.name}
              />
            )}
            {pType === 'pdf' && (
              <iframe
                src={previewFile.url}
                width="100%"
                height="100%"
                style={{ border: 'none', flex: 1 }}
                title={previewFile.name}
              />
            )}
            {pType === 'unsupported' && (
              <p className="sf-preview-unsupported">
                תצוגה מקדימה אינה זמינה לסוג קובץ זה.
                <br />
                ניתן להוריד אותו מעמודת "פעולות".
              </p>
            )}
          </>
        )}
      </div>

    </div>
  )
}
