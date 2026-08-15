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
import { computeDocumentActionRequired, isDocumentActionRequired } from '../../lib/actionRequired'
import ActionRequiredBadge, { ACTION_REQUIRED_RED } from '../../components/ActionRequiredBadge'

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

/* Public URL → storage path, for the BUCKET delete call. Mirrors the
   identical helper in DocumentsTab.jsx (manager) and
   ClientSharedFiles.jsx (client), parameterised by this screen's own
   bucket. An external URL (no /object/public/<bucket>/ marker) returns
   null — nothing to remove from Storage. */
function storagePath(url) {
  if (!url) return null
  const marker = `/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  return idx === -1 ? null : decodeURIComponent(url.slice(idx + marker.length))
}

/* Feather-style chevron — matches the icon used in ClientFile and
   ClientProgress so all three accordion screens look identical. */
const IconChevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

/* Trash icon — copied verbatim from ClientSharedFiles.jsx so the two
   delete affordances in the client portal are visually identical. */
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

  /* Delete flow (own uploads only) — mirrors ClientSharedFiles' single
     confirmDeleteId: version ids are globally unique (uuid PK), so one
     id is enough to track "which file is mid-confirm" across every row
     on the screen. deleteErrors is keyed by version id the same way
     uploadErrors is keyed by doc id, so a failure on one file's delete
     never blocks another. */
  const [confirmDeleteVersionId, setConfirmDeleteVersionId] = useState(null)
  const [deleteErrors, setDeleteErrors] = useState({})  // { versionId: true }

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

  /* A 'view' row (view-only — nothing is asked of the client) is shown
     only when it actually has a file. With none, it's a name and
     "טרם הועלה קובץ" with nothing for the client to do — clutter, not
     a request. 'view_edit' is UNAFFECTED: an empty view_edit row IS the
     request for the client to upload, so it must stay visible; that
     case is exactly what isDocumentActionRequired (below) flags.
     'hidden' rows never reach this component at all (filtered by the
     Stage-1 query's .neq('client_access','hidden') plus RLS).

     This filter runs BEFORE both the count and the grouping below, so
     neither needs a second rule to "stay consistent with what's
     displayed" — they simply never see the hidden rows. */
  const visibleDocuments = useMemo(() => {
    return documents.filter(d => {
      if (d.client_access !== 'view') return true
      const versions = versionsByDoc[d.id]
      return Array.isArray(versions) && versions.length > 0
    })
  }, [documents, versionsByDoc])

  /* Open-request counts derived from the same in-memory dataset that
     the tab already loads. Refreshes automatically after every upload
     (which calls loadData → resets documents + versionsByDoc), so the
     stage badge decreases the instant the CLIENT'S first upload lands
     on a view_edit row (staff uploads don't close a request — see
     actionRequired.js). `byStage` is keyed by the same stage string
     used below for grouping ('כללי' fallback), so lookup is
     `openByStage[group.key]`.
     Computed from visibleDocuments (the SAME shared module,
     actionRequired.js, just fed the already-filtered list) — a hidden
     'view' row was never eligible for this count anyway (only
     'view_edit' rows are, per isDocumentActionRequired), but scoping
     the input here keeps this call and the render below provably in
     sync rather than relying on that being true by coincidence. */
  const { byStage: openByStage } = useMemo(
    () => computeDocumentActionRequired(visibleDocuments, versionsByDoc, userId),
    [visibleDocuments, versionsByDoc, userId]
  )

  /* ── Group documents by stage (preserves first-appearance order) ── */
  const groupedDocs = []
  {
    const indexByKey = new Map()
    for (const d of visibleDocuments) {
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

  /* ── Delete a file the CLIENT uploaded themselves ──────────────────
     Mirrors the staff-side deleteVersion in DocumentsTab.jsx exactly:
     same order (storage, then the row), same "was this doc's CURRENT
     file" branch, and the SAME reset shape when nothing is left —
     file_url/file_name null, status back to 'חסר', date null — which
     is exactly the state DocumentsTab's own delete already puts a row
     into, i.e. exactly how a row looks before its first upload.

     RLS (client_can_delete_own_document_versions on document_versions,
     client_can_delete_own_project_files on storage.objects) is the
     real boundary — both require uploaded_by = auth.uid(). The
     `version.uploaded_by !== userId` check here is defensive, matching
     the identical guard in ClientSharedFiles.handleDelete; the UI also
     never renders the trash icon on a file that isn't the client's own
     (see renderDocRow below).

     Re-fetches via loadData() on success rather than hand-patching
     local state — the same pattern this screen already uses after
     upload, and the one ClientSharedFiles' own delete handler uses. */
  const handleDeleteVersion = async (doc, version) => {
    if (version.uploaded_by !== userId) return
    try {
      const path = storagePath(version.file_url)
      if (path) {
        const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path])
        if (rmErr) console.warn('storage remove warning:', rmErr) /* non-fatal, matches ClientSharedFiles */
      }

      const { error: delErr } = await supabase
        .from('document_versions')
        .delete()
        .eq('id', version.id)
      if (delErr) throw delErr

      /* versionsByDoc[doc.id] is already sorted uploaded_at DESC (the
         Stage-2 query's own order), so remaining[0] — if any — is the
         next-most-recent version without a second sort here. */
      const remaining = (versionsByDoc[doc.id] || []).filter(v => v.id !== version.id)
      const wasCurrent = doc.file_url && doc.file_url === version.file_url

      if (wasCurrent) {
        if (remaining.length > 0) {
          const next = remaining[0]
          const { error: updErr } = await supabase
            .from('project_documents')
            .update({ file_url: next.file_url, file_name: next.file_name })
            .eq('id', doc.id)
          if (updErr) throw updErr
        } else {
          const { error: updErr } = await supabase
            .from('project_documents')
            .update({ file_url: null, file_name: null, status: 'חסר', date: null })
            .eq('id', doc.id)
          if (updErr) throw updErr
        }
      }

      if (!isMounted.current) return
      setConfirmDeleteVersionId(null)
      await loadData()
    } catch (err) {
      console.error('client document version delete error:', err)
      if (isMounted.current) {
        setDeleteErrors(prev => ({ ...prev, [version.id]: true }))
        setTimeout(() => {
          if (!isMounted.current) return
          setDeleteErrors(prev => {
            if (!(version.id in prev)) return prev
            const next = { ...prev }
            delete next[version.id]
            return next
          })
        }, 3000)
      }
    }
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
  /* Dot + sentence marking a row the client still owes a file on.
     RTL: the dot is the FIRST child so it paints to the visual RIGHT
     of the text, i.e. it reads as coming BEFORE the sentence. */
  const renderOpenRequestNote = (style) => (
    <div
      className="cp-doc-meta"
      style={{
        display:    'flex',
        alignItems: 'center',
        gap:        6,
        direction:  'rtl',
        /* Whole line in the same red as the dot — `color` is inherited
           by the text span below, so this is the ONLY place the red is
           declared. Overrides .cp-doc-meta's muted grey. */
        color:      ACTION_REQUIRED_RED,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink:   0,
          width:        8,
          height:       8,
          borderRadius: 999,
          background:   ACTION_REQUIRED_RED,
          display:      'inline-block',
        }}
      />
      <span style={{ fontWeight: 700 }}>התקבלה בקשה להעלאת קובץ</span>
    </div>
  )

  const renderDocRow = (doc) => {
    const versions    = versionsByDoc[doc.id] || []
    const hasFiles    = versions.length > 0
    /* Same defensive posture as the badge path: a failure here yields
       NO indicator rather than a broken screen. */
    let openRequest = false
    try {
      openRequest = isDocumentActionRequired(doc, versions, userId)
    } catch (e) {
      console.warn('isDocumentActionRequired failed for doc', doc && doc.id, e)
      openRequest = false
    }
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
            {/* Empty row: when it's an open request the dot+sentence
                REPLACES "טרם הועלה קובץ" — never both. */}
            {!hasFiles && (
              openRequest
                ? renderOpenRequestNote()
                : <div className="cp-doc-meta">טרם הועלה קובץ</div>
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
              /* Trash shows ONLY on a file this client uploaded
                 themselves — never on a staff-uploaded file in the
                 same row. A legacy pseudo-version has no uploaded_by
                 on record, so it can never match and is never
                 deletable here (RLS would refuse it regardless — this
                 is the UI half of the hide+guard double-check, same
                 pattern as ClientSharedFiles). */
              const isOwnFile   = !v.isLegacy && v.uploaded_by === userId
              const isConfirming = confirmDeleteVersionId === v.id
              return (
                <li key={v.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  flexWrap: 'wrap', direction: 'rtl',
                }}>
                  <a
                    className="cp-doc-link"
                    href={v.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ flex: '1 1 auto', minWidth: 0 }}
                  >
                    {/* Own class, NOT cp-doc-name — the sage colour
                        belongs to the document TITLE only. Same size,
                        weight and family, near-black text. */}
                    <div className="cp-doc-file-name">{displayName}</div>
                    {meta && (
                      <div className="cp-doc-meta">{meta}</div>
                    )}
                  </a>

                  {isOwnFile && (
                    isConfirming ? (
                      <div className="cp-shared-card-confirm">
                        <span className="cp-shared-card-confirm-text">האם למחוק את הקובץ?</span>
                        <button
                          type="button"
                          className="cp-shared-card-confirm-yes"
                          onClick={() => handleDeleteVersion(doc, v)}
                        >כן</button>
                        <button
                          type="button"
                          className="cp-shared-card-confirm-no"
                          onClick={() => setConfirmDeleteVersionId(null)}
                        >לא</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="cp-shared-card-trash"
                        onClick={() => setConfirmDeleteVersionId(v.id)}
                        aria-label="מחק קובץ"
                        title="מחק קובץ"
                      >
                        <IconTrash />
                      </button>
                    )
                  )}

                  {deleteErrors[v.id] && (
                    <div className="cp-doc-error" role="alert" style={{ flexBasis: '100%' }}>
                      שגיאה במחיקה, נסה שוב
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {/* Row already has a file (uploaded by the team) but the
            client hasn't uploaded: keep the existing per-file
            "date · uploader" lines untouched and add the dot+sentence
            directly beneath them as an ADDITIONAL line. */}
        {hasFiles && openRequest && renderOpenRequestNote({ marginTop: 6 })}

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
                    <span className="cp-progress-header-caption">
                      {group.docs.length} מסמכים
                    </span>
                    {/* Badge + chevron travel together at the visual
                        LEFT end of the row, well away from the grey
                        "N מסמכים" count so two numbers never sit side
                        by side. `marginInlineStart: auto` on the GROUP
                        is what pushes it left in RTL; the chevron's own
                        auto margin (from .cp-progress-chevron) is
                        zeroed inside the group so the badge-to-chevron
                        gap stays a fixed 6px instead of splitting the
                        row's free space between them. The chevron is
                        last, so it stays exactly where it was — at the
                        far left edge — with the badge immediately to
                        its visual right. */}
                    <span style={{
                      marginInlineStart: 'auto',
                      display:           'inline-flex',
                      alignItems:        'center',
                      gap:               6,
                      flexShrink:        0,
                    }}>
                      <ActionRequiredBadge count={openByStage[group.key] || 0} />
                      <span
                        className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}
                        style={{ marginInlineStart: 0 }}
                      >
                        <IconChevron size={16} />
                      </span>
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
