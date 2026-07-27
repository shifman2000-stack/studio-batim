// src/pages/client/ClientDocuments.jsx
//
// "מסמכים" screen — read access for all visible documents, plus per-doc
// "העלה גרסה חדשה" for documents flagged client_access = 'view_edit'.
//
// Data pipeline:
//   1. project_documents  → filtered to client_access != 'hidden'
//                          (RLS enforces this server-side too)
//   2. document_versions  → for each doc, take the row with the latest
//                          uploaded_at (single grouped query)
//   3. profiles + client_users → resolve uploader display names
//
// Upload flow (view_edit only):
//   1. Storage path  → `{project_id}/{document_id}/{uuid}.{ext}`
//      (matches the manager's per-project folder convention, never any
//       Hebrew characters in the path)
//   2. Upload via supabase.storage.from('project-files').upload(...)
//      — the same bucket the manager's DocumentsTab uses.
//   3. getPublicUrl → public link.
//   4. INSERT document_versions with uploaded_by + uploaded_at.
//   5. UPDATE project_documents.file_url + .file_name so view-only
//      readers see the latest file too.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'
import { computeOpenRequests } from '../../lib/openDocRequests'
import OpenRequestsBadge from '../../components/OpenRequestsBadge'

const BUCKET = 'project-files'

/* Format an ISO timestamp as DD/MM/YY. */
function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year  = String(d.getFullYear()).slice(2)
  return `${day}/${month}/${year}`
}

/* Extract a lowercase extension from a filename; fallback to 'bin'. */
function fileExt(name) {
  if (!name) return 'bin'
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return 'bin'
  return name.slice(dot + 1).toLowerCase()
}

/* Trim → null if empty/whitespace, otherwise the trimmed string. */
function clean(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/* Feather-style chevron — matches the icon used in ClientFile and
   ClientProgress so all three accordion screens look identical. */
const IconChevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

export default function ClientDocuments() {
  const { id: userId, project_id } = useClient()
  const isMounted = useRef(true)

  /* ── State ───────────────────────────────────────────────────────── */
  const [documents, setDocuments]         = useState([])
  /* Multi-file model: for each document_id, an ARRAY of versions
     sorted by uploaded_at DESC (newest first). A legacy row that
     has only project_documents.file_url and no matching
     document_versions rows appears as a single synthetic entry
     tagged `isLegacy: true` so nothing disappears. */
  const [versionsByDoc, setVersionsByDoc] = useState({})  // { docId: version[] }
  const [nameByUserId, setNameByUserId]   = useState({})  // uploader uuid → display name
  const [loading, setLoading]           = useState(true)
  const [uploadingDocId, setUploadingDocId] = useState(null)
  const [uploadErrors, setUploadErrors] = useState({})  // { docId: true }
  const [savedFlash, setSavedFlash]     = useState(false)

  /* Accordion state — Set of currently-open group keys. Default: all
     blocks collapsed; the user opens whatever they want. */
  const [openSet, setOpenSet] = useState(new Set())

  const fileInputRef     = useRef(null)
  const pickerForDocRef  = useRef(null)  /* which doc the next file pick is for */

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  /* ── Load: documents + their latest versions + uploader names ────── */
  const loadData = useCallback(async () => {
    if (!project_id) return
    setLoading(true)

    /* Stage 1 — visible documents for this project. */
    const { data: docs } = await supabase
      .from('project_documents')
      .select('id, name, stage, stage_id, file_url, file_name, client_access, sort_order')
      .eq('project_id', project_id)
      .neq('client_access', 'hidden')
      .order('stage_id',   { ascending: true, nullsFirst: true })
      .order('sort_order', { ascending: true, nullsFirst: true })

    if (!isMounted.current) return
    const visibleDocs = Array.isArray(docs) ? docs : []
    setDocuments(visibleDocs)

    /* Stage 2 — ALL version rows per document (newest first).
       We keep every attachment now, not just the latest, so the row
       can render a stacked list. RLS on document_versions gates
       these to versions of documents whose parent client_access is
       'view' or 'view_edit' AND whose project is the caller's — same
       guard as the manager's server-side. Client-side filter here is
       just an optimisation, not a security boundary. */
    const docIds = visibleDocs.map(d => d.id)
    let versionsMap = {}
    let uploaderIds = []

    if (docIds.length > 0) {
      const { data: versions } = await supabase
        .from('document_versions')
        .select('id, document_id, file_url, file_name, uploaded_by, uploaded_at')
        .in('document_id', docIds)
        .order('uploaded_at', { ascending: false })

      if (!isMounted.current) return
      for (const v of versions || []) {
        if (!versionsMap[v.document_id]) versionsMap[v.document_id] = []
        versionsMap[v.document_id].push(v)
      }
      /* Legacy fallback — a doc that has parent file_url but no
         matching version rows was uploaded by the OLD admin path
         (before multi-file support wrote versions). Surface it as
         one synthetic entry so it still shows for the client.
         `isLegacy: true` is diagnostic-only here — nothing writes
         through this codepath on the client side. */
      for (const d of visibleDocs) {
        if ((!versionsMap[d.id] || versionsMap[d.id].length === 0) && d.file_url) {
          versionsMap[d.id] = [{
            id:          `__legacy__${d.id}`,
            document_id: d.id,
            file_url:    d.file_url,
            file_name:   d.file_name || null,
            uploaded_by: null,
            uploaded_at: null,
            isLegacy:    true,
          }]
        }
      }
      uploaderIds = Array.from(new Set(
        Object.values(versionsMap)
          .flat()
          .map(v => v.uploaded_by)
          .filter(Boolean)
      ))
    }
    setVersionsByDoc(versionsMap)

    /* Stage 3 — resolve uploader names. profiles first (staff), then
       client_users (client). RLS may restrict client_users to the
       caller's own row, which is fine: the caller-as-uploader still
       resolves. Unknown uploaders fall back to '—'. */
    const nameMap = {}
    if (uploaderIds.length > 0) {
      const { data: staffRows } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', uploaderIds)

      const staffIds = new Set((staffRows || []).map(s => s.id))
      for (const s of staffRows || []) {
        const name = [s.first_name, s.last_name].filter(Boolean).join(' ').trim()
        nameMap[s.id] = name || 'סטודיו'
      }

      const remaining = uploaderIds.filter(id => !staffIds.has(id))
      if (remaining.length > 0) {
        const { data: clientRows } = await supabase
          .from('client_users')
          .select('id, first_name')
          .in('id', remaining)

        for (const c of clientRows || []) {
          const name = clean(c.first_name)
          nameMap[c.id] = name || 'לקוח'
        }
      }
    }
    if (!isMounted.current) return
    setNameByUserId(nameMap)

    setLoading(false)
  }, [project_id])

  useEffect(() => { loadData() }, [loadData])

  /* Open-request counts derived from the same in-memory dataset that
     the tab already loads. Refreshes automatically after every upload
     (which calls loadData → resets documents + versionsByDoc), so the
     stage badge decreases the instant the CLIENT'S first upload lands
     on a view_edit row (staff uploads don't close a request — see
     openDocRequests.js). `byStage` is keyed by the same stage string
     used below for grouping ('כללי' fallback), so lookup is
     `openByStage[group.key]`. */
  const { byStage: openByStage } = useMemo(
    () => computeOpenRequests(documents, versionsByDoc, userId),
    [documents, versionsByDoc, userId]
  )

  /* ── Group documents by stage (preserves first-appearance order) ── */
  const groupedDocs = []
  {
    const indexByKey = new Map()
    for (const d of documents) {
      const key = clean(d.stage) || 'כללי'
      let g = indexByKey.get(key)
      if (!g) {
        g = { key, docs: [] }
        indexByKey.set(key, g)
        groupedDocs.push(g)
      }
      g.docs.push(d)
    }
  }

  /* ── Accordion toggle (one block at a time, independent) ── */
  const toggleOpen = (key) => {
    setOpenSet(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const handleHeaderKeyDown = (e, key) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleOpen(key)
    }
  }

  /* ── File picker ── */
  const handlePickFile = (docId) => {
    pickerForDocRef.current = docId
    /* Clear previous error for this doc on a fresh attempt. */
    setUploadErrors(prev => {
      if (!(docId in prev)) return prev
      const next = { ...prev }
      delete next[docId]
      return next
    })
    /* Reset the input value so re-picking the same file still triggers onChange. */
    if (fileInputRef.current) fileInputRef.current.value = ''
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e) => {
    const file  = e.target.files?.[0]
    const docId = pickerForDocRef.current
    pickerForDocRef.current = null
    if (!file || !docId) return
    await uploadDocVersion(docId, file)
  }

  /* ── Upload pipeline ── */
  const uploadDocVersion = async (docId, file) => {
    if (uploadingDocId) return  /* one upload at a time per screen */
    setUploadingDocId(docId)
    setUploadErrors(prev => {
      if (!(docId in prev)) return prev
      const next = { ...prev }
      delete next[docId]
      return next
    })

    try {
      if (!userId)      throw new Error('no client session')
      if (!project_id)  throw new Error('no project_id')

      /* Path: project/doc/uuid.ext — never Hebrew, matches the manager's
         per-project folder convention so files coexist cleanly. */
      const ext  = fileExt(file.name)
      const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const path = `${project_id}/${docId}/${uuid}.${ext}`

      /* 1. Upload to Storage (same bucket as the manager's DocumentsTab). */
      const { error: uploadError } = await supabase.storage
        .from(BUCKET).upload(path, file)
      if (uploadError) throw uploadError

      /* 2. Public URL — matches the manager's getPublicUrl pattern. */
      const { data: { publicUrl } } = supabase.storage
        .from(BUCKET).getPublicUrl(path)

      const uploadedAt = new Date().toISOString()

      /* 3. INSERT a new document_versions row. */
      const { error: insertError } = await supabase.from('document_versions').insert({
        document_id: docId,
        file_url:    publicUrl,
        file_name:   file.name,
        uploaded_by: userId,
        uploaded_at: uploadedAt,
      })
      if (insertError) throw insertError

      /* 4. Keep the parent row in sync — same denormalization the admin
            side does on upload so the manager view reflects a client
            upload identically:
              file_url + file_name → newest attachment
              status               → 'התקבל'  (green ✓ in DocumentsTab,
                                                progresses the row-based
                                                "X מתוך Y מסמכים התקבלו"
                                                counter)
              date                 → today (YYYY-MM-DD, same format the
                                            admin uploadFile writes)
            Same policy client_can_update_editable_documents already
            gates this UPDATE — RLS is row-level, not column-level. */
      const today = new Date().toISOString().slice(0, 10)
      const { error: updateError } = await supabase.from('project_documents')
        .update({
          file_url:  publicUrl,
          file_name: file.name,
          status:    'התקבל',
          date:      today,
        })
        .eq('id', docId)
      if (updateError) throw updateError

      /* 5. Refetch + show success flash. */
      await loadData()
      if (!isMounted.current) return
      setSavedFlash(true)
      setTimeout(() => { if (isMounted.current) setSavedFlash(false) }, 2000)
    } catch (e) {
      console.error('client doc upload error:', e)
      if (isMounted.current) setUploadErrors(prev => ({ ...prev, [docId]: true }))
    }
    if (isMounted.current) setUploadingDocId(null)
  }

  /* Build the meta line for a single version. Legacy synthesised
     versions have no uploaded_at + no uploaded_by → reads "קובץ" as
     a neutral fallback so old files stay openable but don't lie
     about metadata. */
  const buildVersionMeta = (v) => {
    if (v.isLegacy) return 'קובץ'
    const uploader = clean(nameByUserId[v.uploaded_by]) || '—'
    const dateStr  = formatDate(v.uploaded_at)
    return dateStr
      ? `${dateStr} · ${uploader}`
      : `${uploader}`
  }

  /* ── Render a single document row — LIST of attached files ──
     Row-level: document name + meta (or "טרם הועלה קובץ" if empty).
     File-level: each attachment is one line inside the row with its
     own file name + open link + per-file meta (date · uploader).
     Row-level upload button ("צרף עוד קובץ" / "העלה קובץ") stays,
     appends a new version via uploadDocVersion. No per-file delete
     on the client side — client_access controls VISIBILITY not
     MUTATION beyond upload; deletions stay admin-only, matching the
     pre-change behavior. */
  const renderDocRow = (doc) => {
    const versions    = versionsByDoc[doc.id] || []
    const hasFiles    = versions.length > 0
    const isUploading = uploadingDocId === doc.id
    const rowError    = !!uploadErrors[doc.id]
    const editable    = doc.client_access === 'view_edit'
    const docName     = clean(doc.name) || '—'
    const uploadLabel = hasFiles ? 'צרף עוד קובץ' : 'העלה קובץ'

    return (
      <div key={doc.id} className="cp-doc-row">
        <div className="cp-doc-row-main">
          {/* Row title — inert (not a link), because the row now has
              multiple files listed below. Grays out when the row is
              empty, mirroring the previous cp-doc-name--unfilled state. */}
          <div className="cp-doc-link cp-doc-link--inert" style={{ flex: 1, minWidth: 0 }}>
            <div className={'cp-doc-name' + (hasFiles ? '' : ' cp-doc-name--unfilled')}>
              {docName}
            </div>
            {!hasFiles && (
              <div className="cp-doc-meta">טרם הועלה קובץ</div>
            )}
          </div>

          {editable && (
            <div className="cp-doc-actions">
              {isUploading ? (
                <span className="cp-doc-uploading">מעלה…</span>
              ) : (
                <button
                  type="button"
                  className="cp-doc-upload-btn"
                  onClick={() => handlePickFile(doc.id)}
                  disabled={!!uploadingDocId}
                >
                  {uploadLabel}
                </button>
              )}
            </div>
          )}
        </div>

        {hasFiles && (
          /* Stacked list of files — newest first. Each entry links
             directly to its own file_url (opens in a new tab, same
             pattern as before). Kept as a plain <ul> with reset
             list-style so we don't need a new CSS class; direction
             is inherited from the cp-page shell (RTL). */
          <ul
            style={{
              listStyle: 'none',
              margin:    '6px 0 0',
              padding:   0,
              display:   'flex',
              flexDirection: 'column',
              gap:       4,
            }}
          >
            {versions.map(v => {
              const displayName = clean(v.file_name)
                || (v.file_url ? decodeURIComponent(v.file_url.split('/').pop()) : 'קובץ')
              const meta = buildVersionMeta(v)
              return (
                <li key={v.id} style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  flexWrap: 'wrap', direction: 'rtl',
                }}>
                  <a
                    className="cp-doc-link"
                    href={v.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: '1 1 auto', minWidth: 0 }}
                  >
                    <div className="cp-doc-name" style={{ fontSize: 14 }}>{displayName}</div>
                    {meta && (
                      <div className="cp-doc-meta">{meta}</div>
                    )}
                  </a>
                </li>
              )
            })}
          </ul>
        )}

        {rowError && (
          <div className="cp-doc-error" role="alert">שגיאה בהעלאה, נסה שוב</div>
        )}
      </div>
    )
  }

  /* ── Render ───────────────────────────────────────────────────────── */
  return (
    <div className="cp-page">
      <div className="cp-container">

        <h1 className="cp-screen-title">מסמכים</h1>

        {loading ? (
          <div className="cp-loading"><p>טוען...</p></div>
        ) : groupedDocs.length === 0 ? (
          <section className="cp-card">
            <p className="cp-empty-card">אין מסמכים זמינים</p>
          </section>
        ) : (
          <div className="cp-progress-accordion">
            {groupedDocs.map(group => {
              const isOpen = openSet.has(group.key)
              return (
                <section key={group.key} className="cp-progress-block">
                  <div
                    className="cp-progress-header"
                    role="button"
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleOpen(group.key)}
                    onKeyDown={(e) => handleHeaderKeyDown(e, group.key)}
                  >
                    <span className="cp-progress-header-name">{group.key}</span>
                    <OpenRequestsBadge
                      count={openByStage[group.key] || 0}
                      /* Inline next to the caption — small enough to
                         sit visually inside the header row without
                         breaking its RTL flow. */
                      style={{ marginInlineStart: 6 }}
                    />
                    <span className="cp-progress-header-caption">
                      {group.docs.length} מסמכים
                    </span>
                    <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                      <IconChevron size={16} />
                    </span>
                  </div>
                  {isOpen && (
                    <div className="cp-acc-body">
                      {group.docs.map(renderDocRow)}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}

      </div>

      {/* Hidden file picker, shared across all editable rows. */}
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* Subtle success indicator — fades after 2s. */}
      {savedFlash && (
        <div className="cp-save-success" role="status">✓ הועלה בהצלחה</div>
      )}
    </div>
  )
}
