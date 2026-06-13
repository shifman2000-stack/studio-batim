// src/components/sharedfiles/SharedFilesTab.jsx
//
// "מרחב משותף" tab on the manager's client file (תיק לקוח).
//
// Flat list of files in `shared_files` for the current project — both
// staff and the project's client (linked via client_users) upload here.
// Two-panel split: 50% table on the right, 50% preview panel on the left.
//
// Columns: שם קובץ (clickable link) | מי העלה | תאריך העלאה | פעולות
//   actions column = 3 icons (eye / download / trash), trash inline-confirms.
//
// RLS is already in place on the DB. The staff_full_access policy lets
// the manager SELECT / INSERT / DELETE everything; we don't need any
// special auth handling beyond the standard supabase client.

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
  const [files,           setFiles]           = useState([])
  const [namesByUserId,   setNamesByUserId]   = useState({})
  const [loading,         setLoading]         = useState(true)
  const [uploading,       setUploading]       = useState(false)
  const [previewFile,     setPreviewFile]     = useState(null) // { url, name } | null
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const fileInputRef = useRef(null)

  /* ── Load files + uploader names ────────────────────────────────── */
  const loadFiles = async () => {
    if (!projectId) return
    setLoading(true)

    const { data, error } = await supabase
      .from('shared_files')
      .select('id, file_url, file_name, uploaded_by, uploaded_at')
      .eq('project_id', projectId)
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('shared_files load error:', error)
      setFiles([])
      setNamesByUserId({})
      setLoading(false)
      return
    }

    const rows = Array.isArray(data) ? data : []
    setFiles(rows)

    /* ── Names lookup ────────────────────────────────────────────
       Up to THREE queries (regardless of row count):
         1) profiles      — staff uploaders.
         2) client_users  — leftover uuids; pulls project_id + email
                            + the (stale!) first_name snapshot.
         3) project_contacts — the LIVE name source for clients,
                            fetched by the project_ids gathered in (2)
                            so we can match case-insensitively in JS.
       client_users.first_name is a one-time snapshot from
       link_client_on_login; project_contacts is the source of truth
       after any rename. We only fall back to the snapshot when no live
       contact row matches (e.g. the contact's email was edited and no
       longer matches client_users.email). */
    const uploaderIds = Array.from(new Set(rows.map(r => r.uploaded_by).filter(Boolean)))
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

        /* 3. project_contacts for the involved project_ids — pulls
              the LIVE name. Fetching by project_id (one .in()) avoids
              the case-sensitivity trap of `.in('email', ...)` and lets
              us match in JS with lower(trim()) on both sides. */
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

        /* Pair each client_user with its matching project_contacts row
           by (project_id + normalized email). Fall back to the
           client_users snapshot when no live row matches. */
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

  useEffect(() => { loadFiles() }, [projectId])

  /* ── Upload flow ────────────────────────────────────────────────── */
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

      await loadFiles()
    } catch (err) {
      console.error('shared_files upload error:', err)
      alert('שגיאה בהעלאת הקובץ. נסה שוב.')
    }
    setUploading(false)
  }

  /* ── Delete flow ────────────────────────────────────────────────── */
  const handleDelete = async (row) => {
    try {
      /* Storage first — if it fails the DB row stays and we can retry.
         If storage succeeds but DB delete fails, the row is orphaned
         but harmless (links to a missing object that returns 404). */
      const path = storagePath(row.file_url)
      if (path) {
        const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
        if (rmErr) console.warn('storage remove warning:', rmErr) /* non-fatal */
      }
      const { error: delErr } = await supabase
        .from('shared_files')
        .delete()
        .eq('id', row.id)
      if (delErr) throw delErr

      /* Clear preview if it was showing the deleted file. */
      if (previewFile && previewFile.url === row.file_url) setPreviewFile(null)
      setConfirmDeleteId(null)
      await loadFiles()
    } catch (err) {
      console.error('shared_files delete error:', err)
      alert('שגיאה במחיקת הקובץ. נסה שוב.')
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

        <div className="sf-toolbar">
          <button
            type="button"
            className="sf-upload-btn"
            onClick={handlePickFile}
            disabled={uploading}
          >
            {uploading ? 'מעלה...' : '+ הוסף מסמך'}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />

        {loading ? (
          <div className="sf-loading">טוען קבצים...</div>
        ) : files.length === 0 ? (
          <div className="sf-empty">אין עדיין קבצים במרחב המשותף</div>
        ) : (
          <div className="sf-table">

            {/* Table header */}
            <div className="sf-table-header">
              <div className="sf-col-name">שם קובץ</div>
              <div className="sf-col-uploader">הועלה על ידי</div>
              <div className="sf-col-date">תאריך העלאה</div>
              <div className="sf-col-actions">פעולות</div>
            </div>

            {/* Rows */}
            {files.map((row, idx) => {
              const uploaderName = row.uploaded_by ? (namesByUserId[row.uploaded_by] || '') : ''
              return (
                <div
                  key={row.id}
                  className={'sf-row' + (idx % 2 === 1 ? ' sf-row--even' : '')}
                >
                  {/* שם קובץ — clickable link that opens the file in a new tab */}
                  <a
                    className="sf-col-name sf-file-link"
                    href={openableUrl(row.file_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={row.file_name}
                  >
                    {row.file_name}
                  </a>

                  <div className="sf-col-uploader" title={uploaderName}>{uploaderName}</div>
                  <div className="sf-col-date">{formatDate(row.uploaded_at)}</div>

                  {/* פעולות — eye / download / trash (RTL: first child = visual right) */}
                  <div className="sf-col-actions">
                    <button
                      type="button"
                      className="sf-file-icon-btn"
                      onClick={() => setPreviewFile({ url: row.file_url, name: row.file_name })}
                      title="תצוגה מקדימה"
                    >
                      <IconEye />
                    </button>
                    <button
                      type="button"
                      className="sf-file-icon-btn"
                      onClick={() => handleDownload(row)}
                      title="הורד"
                    >
                      <IconDownload />
                    </button>
                    {confirmDeleteId === row.id ? (
                      <div className="sf-delete-confirm">
                        <span className="sf-delete-confirm-text">למחוק את הקובץ?</span>
                        <button
                          type="button"
                          className="sf-delete-confirm-yes"
                          onClick={() => handleDelete(row)}
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
                        onClick={() => setConfirmDeleteId(row.id)}
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

      {/* Left panel — preview (50% of available width, sticky) */}
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
