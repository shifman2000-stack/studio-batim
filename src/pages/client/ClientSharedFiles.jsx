// src/pages/client/ClientSharedFiles.jsx
//
// "מרחב משותף" — client portal screen mirroring the manager's
// SharedFilesTab but in a mobile-first card layout.
//
// Both staff and the client can upload here. The client sees every file
// in their project (RLS: client_can_read_own_project_shared_files) and
// can delete only their OWN uploads (RLS: client_can_delete_own_uploads).
// The trash button is hidden in the UI on rows the client doesn't own;
// RLS would block the attempt regardless.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'

const BUCKET = 'project-shared-files'

/* ── Helpers (duplicate of the manager-tab helpers — small and stable) ── */
function fileExt(name) {
  if (!name) return ''
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return 'file'
  return name.slice(dot + 1).toLowerCase()
}

function storagePath(url) {
  const marker = `/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length))
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

/* ── Trash icon (SVG, matches the visual weight of other portal icons) ── */
const IconTrash = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

export default function ClientSharedFiles() {
  const { id: userId, project_id } = useClient()
  const isMounted = useRef(true)

  const [files,           setFiles]           = useState([])
  const [namesByUserId,   setNamesByUserId]   = useState({})
  const [loading,         setLoading]         = useState(true)
  const [uploading,       setUploading]       = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [savedFlash,      setSavedFlash]      = useState(false)
  const [pageError,       setPageError]       = useState('')

  const fileInputRef = useRef(null)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  /* ── Load files + uploader names ────────────────────────────────── */
  const loadFiles = useCallback(async () => {
    if (!project_id) return
    setLoading(true)

    const { data, error } = await supabase
      .from('shared_files')
      .select('id, file_url, file_name, uploaded_by, uploaded_at')
      .eq('project_id', project_id)
      .order('uploaded_at', { ascending: false })

    if (!isMounted.current) return
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
       Same logic as SharedFilesTab — three queries max:
         1) profiles      — staff uploaders.
         2) client_users  — leftover uuids; gets project_id + email
                            + the snapshot first_name.
         3) project_contacts — LIVE name source for clients, fetched
                            by project_id so we can match case-
                            insensitively in JS.
       Clients only see their OWN project's contacts (RLS), so
       liveContacts here is at most a handful of rows. */
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

        /* 3. project_contacts for the involved project_ids — LIVE source. */
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

        /* Pair each client_user with its live contact by
           (project_id + normalized email). Fall back to the
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
    if (!isMounted.current) return
    setNamesByUserId(nameMap)
    setLoading(false)
  }, [project_id])

  useEffect(() => { loadFiles() }, [loadFiles])

  /* ── Upload flow ────────────────────────────────────────────────── */
  const handlePickFile = () => {
    if (uploading) return
    setPageError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (uploading) return

    setUploading(true)
    setPageError('')
    try {
      if (!userId)     throw new Error('no client session')
      if (!project_id) throw new Error('no project_id')

      const ext  = fileExt(file.name)
      const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const path = `${project_id}/${uuid}.${ext}`

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file)
      if (upErr) throw upErr

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

      const { error: insErr } = await supabase
        .from('shared_files')
        .insert({
          project_id:  project_id,
          file_url:    publicUrl,
          file_name:   file.name,
          uploaded_by: userId,
        })
      if (insErr) throw insErr

      await loadFiles()
      if (!isMounted.current) return
      setSavedFlash(true)
      setTimeout(() => isMounted.current && setSavedFlash(false), 2000)
    } catch (err) {
      console.error('shared_files upload error:', err)
      if (isMounted.current) setPageError('שגיאה בהעלאה, נסה שוב')
    }
    if (isMounted.current) setUploading(false)
  }

  /* ── Delete flow (own uploads only) ─────────────────────────────── */
  const handleDelete = async (row) => {
    if (row.uploaded_by !== userId) return  /* defensive — UI already hides the icon */
    try {
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

      setConfirmDeleteId(null)
      await loadFiles()
    } catch (err) {
      console.error('shared_files delete error:', err)
      if (isMounted.current) {
        setPageError('שגיאה במחיקה, נסה שוב')
        setTimeout(() => isMounted.current && setPageError(''), 3000)
      }
    }
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="cp-page">
      <div className="cp-container">

        <h1 className="cp-screen-title">מרחב משותף</h1>

        {pageError && (
          <div className="cp-save-error" role="alert">{pageError}</div>
        )}

        <div className="cp-shared-upload-row">
          <button
            type="button"
            className="cp-shared-upload-btn"
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
          <div className="cp-loading"><p>טוען...</p></div>
        ) : files.length === 0 ? (
          <section className="cp-card">
            <p className="cp-empty-card">אין עדיין קבצים במרחב המשותף</p>
          </section>
        ) : (
          files.map(row => {
            const uploaderName = row.uploaded_by ? (namesByUserId[row.uploaded_by] || '') : ''
            const isOwn        = row.uploaded_by === userId
            const dateStr      = formatDate(row.uploaded_at)
            return (
              <section key={row.id} className="cp-card cp-shared-card">
                <a
                  className="cp-shared-card-tap"
                  href={row.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="cp-shared-card-name">{row.file_name}</div>
                  <div className="cp-shared-card-meta">
                    {uploaderName && (
                      <>
                        <span>הועלה על ידי: {uploaderName}</span>
                        <span className="cp-shared-card-meta-sep"> · </span>
                      </>
                    )}
                    <span>תאריך העלאה: {dateStr}</span>
                  </div>
                </a>

                {isOwn && (
                  confirmDeleteId === row.id ? (
                    <div className="cp-shared-card-confirm">
                      <span className="cp-shared-card-confirm-text">למחוק את הקובץ?</span>
                      <button
                        type="button"
                        className="cp-shared-card-confirm-yes"
                        onClick={() => handleDelete(row)}
                      >כן</button>
                      <button
                        type="button"
                        className="cp-shared-card-confirm-no"
                        onClick={() => setConfirmDeleteId(null)}
                      >לא</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cp-shared-card-trash"
                      onClick={() => setConfirmDeleteId(row.id)}
                      aria-label="מחק"
                      title="מחק"
                    >
                      <IconTrash />
                    </button>
                  )
                )}
              </section>
            )
          })
        )}

      </div>

      {savedFlash && (
        <div className="cp-save-success" role="status">✓ הועלה בהצלחה</div>
      )}
    </div>
  )
}
