// src/pages/client/ClientSharedFiles.jsx
//
// "מרחב משותף" — client portal screen mirroring the manager's
// SharedFilesTab but in a mobile-first card layout.
//
// Content: BOTH file uploads (`shared_files`) AND free-text
// notes/requests (`project_notes`) are pulled and merged into ONE
// chronologically-sorted list, newest first. Each row carries a
// `kind: 'file' | 'note'` discriminator so the render can branch on
// shape — files render as a clickable filename card, notes render as
// a wrapped body of text — while the chrome (cp-card / cp-shared-card)
// and the meta line / trash flow are shared.
//
// Permissions mirror exactly: both staff and the client can add files
// AND notes; the client deletes only their OWN rows (RLS
// client_can_delete_own_uploads on shared_files, and the matching
// uploader-only DELETE policy on project_notes). The trash button is
// hidden in the UI on rows the client doesn't own; RLS would block the
// attempt regardless.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { resolveUserNames } from '../../lib/resolveUserNames'
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

  /* `items` is the MERGED list (files + notes), uniform shape, sorted by
     date desc. Each entry has a `kind` discriminator so the render can
     pick the right card body. */
  const [items,           setItems]           = useState([])
  const [namesByUserId,   setNamesByUserId]   = useState({})
  const [loading,         setLoading]         = useState(true)
  const [uploading,       setUploading]       = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [savedFlash,      setSavedFlash]      = useState(false)
  const [pageError,       setPageError]       = useState('')

  /* Note-add form state — a small inline textarea that the
     "+ הוסף הערה/בקשה" button toggles open. Saving an empty / whitespace-
     only note is blocked at the button level. */
  const [noteFormOpen,    setNoteFormOpen]    = useState(false)
  const [noteText,        setNoteText]        = useState('')
  const [savingNote,      setSavingNote]      = useState(false)

  /* Per-note expand/collapse state — a Set of note ids that are
     currently expanded. Collapsed (default): the body shows on one
     line with an ellipsis if it overflows. Expanded: the body wraps to
     however many lines it needs. Clicking the body toggles. */
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

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  /* ── Load files + notes + uploader names ──────────────────────────
     Two SELECTs in parallel, then merge into the uniform `items` shape
     and sort by date. Name resolution runs ONCE over the union of
     uploader ids so files and notes share the same three-query dance
     (profiles → client_users → project_contacts). ── */
  const loadItems = useCallback(async () => {
    if (!project_id) return
    setLoading(true)

    const [filesRes, notesRes] = await Promise.all([
      supabase
        .from('shared_files')
        .select('id, file_url, file_name, uploaded_by, uploaded_at')
        .eq('project_id', project_id)
        .order('uploaded_at', { ascending: false }),
      supabase
        .from('project_notes')
        .select('id, body, uploaded_by, uploaded_at')
        .eq('project_id', project_id)
        .order('uploaded_at', { ascending: false }),
    ])

    if (!isMounted.current) return
    if (filesRes.error) console.error('shared_files load error:', filesRes.error)
    if (notesRes.error) console.error('project_notes load error:', notesRes.error)

    const fileRows = Array.isArray(filesRes.data) ? filesRes.data : []
    const noteRows = Array.isArray(notesRes.data) ? notesRes.data : []

    /* Uniform shape with a `kind` discriminator. localeCompare on ISO
       8601 strings sorts chronologically without a Date roundtrip. */
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
       The input id set spans BOTH files and notes, so the resolver runs
       exactly once regardless of how many rows of each kind there are.
       The profiles → client_users → project_contacts dance itself lives
       in lib/resolveUserNames, shared with the manager screen. */
    const uploaderIds = Array.from(new Set(merged.map(r => r.uploaded_by).filter(Boolean)))
    const nameMap = await resolveUserNames(uploaderIds)
    if (!isMounted.current) return
    setNamesByUserId(nameMap)
    setLoading(false)
  }, [project_id])

  useEffect(() => { loadItems() }, [loadItems])

  /* ── Upload flow (files) ────────────────────────────────────────── */
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

      await loadItems()
      if (!isMounted.current) return
      setSavedFlash(true)
      setTimeout(() => isMounted.current && setSavedFlash(false), 2000)
    } catch (err) {
      console.error('shared_files upload error:', err)
      if (isMounted.current) setPageError('שגיאה בהעלאה, נסה שוב')
    }
    if (isMounted.current) setUploading(false)
  }

  /* ── Save note ──────────────────────────────────────────────────── */
  const handleSaveNote = async () => {
    const body = noteText.trim()
    if (!body || savingNote) return
    setSavingNote(true)
    setPageError('')
    try {
      if (!userId)     throw new Error('no client session')
      if (!project_id) throw new Error('no project_id')

      const { error } = await supabase
        .from('project_notes')
        .insert({
          project_id:  project_id,
          body:        body,
          uploaded_by: userId,
        })
      if (error) throw error

      setNoteText('')
      setNoteFormOpen(false)
      await loadItems()
      if (!isMounted.current) return
      setSavedFlash(true)
      setTimeout(() => isMounted.current && setSavedFlash(false), 2000)
    } catch (err) {
      console.error('project_notes insert error:', err)
      if (isMounted.current) setPageError('שגיאה בשמירה, נסה שוב')
    }
    if (isMounted.current) setSavingNote(false)
  }

  /* ── Delete (files: storage + db; notes: db only) ───────────────── */
  const handleDelete = async (item) => {
    if (item.uploaded_by !== userId) return  /* defensive — UI already hides the icon */
    try {
      if (item.kind === 'file') {
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
        <p style={{
          margin: '4px 0 16px',
          fontSize: 13,
          color: '#8a8680',
          textAlign: 'right',
          direction: 'rtl',
          lineHeight: 1.5,
        }}>
          כאן נוכל לשתף בינינו קבצים, תמונות, או לרשום הערות
        </p>

        {pageError && (
          <div className="cp-save-error" role="alert">{pageError}</div>
        )}

        {/* Two siblings sit in the same row — gap:10 keeps them
            comfortably apart in the RTL flex container. */}
        <div className="cp-shared-upload-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="cp-shared-upload-btn"
            onClick={handlePickFile}
            disabled={uploading}
          >
            {uploading ? 'מעלה...' : '+ הוסף תמונה/מסמך'}
          </button>
          <button
            type="button"
            className="cp-shared-upload-btn"
            onClick={() => { setNoteFormOpen(o => !o); setPageError('') }}
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

        {/* Inline note-add form. Save is disabled while the textarea is
            empty or while saving is in flight. ביטול discards the draft. */}
        {noteFormOpen && (
          <div style={{ background: '#fff', border: '1px solid #e5e3dd', borderRadius: 10, padding: 12, marginBottom: 14 }}>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="הערה או בקשה..."
              dir="rtl"
              style={{
                width: '100%', minHeight: 80, padding: 8, fontFamily: 'inherit',
                fontSize: 14, border: '1px solid #d9d6cd', borderRadius: 8,
                resize: 'vertical', boxSizing: 'border-box', textAlign: 'right',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-start' }}>
              <button
                type="button"
                className="cp-shared-upload-btn"
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
                  background: 'none', border: '1px solid #d9d6cd', borderRadius: 8,
                  padding: '7px 18px', cursor: savingNote ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', fontSize: 13.5, color: '#4a4a48',
                  fontWeight: 500,
                }}
              >
                ביטול
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="cp-loading"><p>טוען...</p></div>
        ) : items.length === 0 ? (
          <section className="cp-card">
            <p className="cp-empty-card">אין עדיין קבצים או הערות במרחב המשותף</p>
          </section>
        ) : (
          items.map(item => {
            const uploaderName = item.uploaded_by ? (namesByUserId[item.uploaded_by] || '') : ''
            const isOwn        = item.uploaded_by === userId
            const dateStr      = formatDate(item.date)

            if (item.kind === 'file') {
              return (
                <section key={`file-${item.id}`} className="cp-card cp-shared-card">
                  <a
                    className="cp-shared-card-tap"
                    href={item.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <div className="cp-shared-card-name">{item.file_name}</div>
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
                    confirmDeleteId === item.id ? (
                      <div className="cp-shared-card-confirm">
                        <span className="cp-shared-card-confirm-text">למחוק את הקובץ?</span>
                        <button
                          type="button"
                          className="cp-shared-card-confirm-yes"
                          onClick={() => handleDelete(item)}
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
                        onClick={() => setConfirmDeleteId(item.id)}
                        aria-label="מחק"
                        title="מחק"
                      >
                        <IconTrash />
                      </button>
                    )
                  )}
                </section>
              )
            }

            /* kind === 'note' */
            const isExpanded = expandedNotes.has(item.id)
            return (
              <section key={`note-${item.id}`} className="cp-card cp-shared-card">
                {/* Same wrapper as the file card so the layout (flex row
                    with trash on the visual left) is preserved. Only
                    the note BODY is tappable (toggles expand); the meta
                    line below is non-interactive. */}
                <div className="cp-shared-card-tap" style={{ cursor: 'default' }}>
                  <div
                    className="cp-shared-card-name"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={() => toggleNoteExpanded(item.id)}
                    onKeyDown={(e) => handleNoteBodyKeyDown(e, item.id)}
                    /* Collapsed = one line + ellipsis. Expanded = full
                       multi-line body. cursor:pointer on both so the
                       affordance reads as tappable in either state. */
                    style={isExpanded
                      ? { whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', fontWeight: 400, cursor: 'pointer' }
                      : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 400, cursor: 'pointer' }
                    }
                  >
                    {item.body}
                  </div>
                  <div className="cp-shared-card-meta">
                    {uploaderName && (
                      <>
                        <span>הוסף על ידי: {uploaderName}</span>
                        <span className="cp-shared-card-meta-sep"> · </span>
                      </>
                    )}
                    <span>תאריך: {dateStr}</span>
                  </div>
                </div>

                {isOwn && (
                  confirmDeleteId === item.id ? (
                    <div className="cp-shared-card-confirm">
                      <span className="cp-shared-card-confirm-text">למחוק את ההערה?</span>
                      <button
                        type="button"
                        className="cp-shared-card-confirm-yes"
                        onClick={() => handleDelete(item)}
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
                      onClick={() => setConfirmDeleteId(item.id)}
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
        <div className="cp-save-success" role="status">✓ נשמר בהצלחה</div>
      )}
    </div>
  )
}
