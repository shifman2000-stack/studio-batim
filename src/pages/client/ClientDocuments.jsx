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

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'

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

export default function ClientDocuments() {
  const { id: userId, project_id } = useClient()
  const isMounted = useRef(true)

  /* ── State ───────────────────────────────────────────────────────── */
  const [documents, setDocuments]       = useState([])
  const [latestByDoc, setLatestByDoc]   = useState({})  // { docId: version }
  const [nameByUserId, setNameByUserId] = useState({})  // uploader uuid → display name
  const [loading, setLoading]           = useState(true)
  const [uploadingDocId, setUploadingDocId] = useState(null)
  const [uploadErrors, setUploadErrors] = useState({})  // { docId: true }
  const [savedFlash, setSavedFlash]     = useState(false)

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

    /* Stage 2 — latest version row per document.
       Strategy: pull ALL versions for the visible doc ids ordered desc by
       uploaded_at and keep the first seen per document_id. Cheap because
       version counts per project are small. */
    const docIds = visibleDocs.map(d => d.id)
    let latest = {}
    let uploaderIds = []

    if (docIds.length > 0) {
      const { data: versions } = await supabase
        .from('document_versions')
        .select('document_id, file_url, file_name, uploaded_by, uploaded_at')
        .in('document_id', docIds)
        .order('uploaded_at', { ascending: false })

      if (!isMounted.current) return
      for (const v of versions || []) {
        if (!(v.document_id in latest)) latest[v.document_id] = v
      }
      uploaderIds = Array.from(
        new Set(Object.values(latest).map(v => v.uploaded_by).filter(Boolean))
      )
    }
    setLatestByDoc(latest)

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

      /* 4. Keep the latest on the project_documents row so view-only readers
            see the same file as the latest version. */
      const { error: updateError } = await supabase.from('project_documents')
        .update({ file_url: publicUrl, file_name: file.name })
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

  /* ── Render a single document row ── */
  const renderDocRow = (doc) => {
    const version     = latestByDoc[doc.id]
    const fileUrl     = version?.file_url || doc.file_url
    const hasFile     = !!fileUrl
    const isUploading = uploadingDocId === doc.id
    const rowError    = !!uploadErrors[doc.id]
    const editable    = doc.client_access === 'view_edit'

    /* Build the meta line. file_name is intentionally NOT shown here —
       it's still tracked in DB and used as the file when the link is
       tapped, but the meta is reserved for upload metadata.

       A doc with no document_versions row (including legacy docs that
       only have project_documents.file_url) reads "טרם הועלה קובץ".
       The legacy file_url is still wired to the link target so those
       older docs remain openable on tap. */
    let metaText
    if (version) {
      const uploader = clean(nameByUserId[version.uploaded_by]) || '—'
      const dateStr  = formatDate(version.uploaded_at)
      metaText = dateStr
        ? `העלאה אחרונה ב-${dateStr} ע״י ${uploader}`
        : `העלאה אחרונה ע״י ${uploader}`
    } else {
      metaText = 'טרם הועלה קובץ'
    }

    const docName = clean(doc.name) || '—'

    return (
      <div key={doc.id} className="cp-doc-row">
        <div className="cp-doc-row-main">
          {hasFile ? (
            <a
              className="cp-doc-link"
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="cp-doc-name">{docName}</div>
              <div className="cp-doc-meta">{metaText}</div>
            </a>
          ) : (
            <div className="cp-doc-link cp-doc-link--inert">
              <div className="cp-doc-name cp-doc-name--unfilled">{docName}</div>
              <div className="cp-doc-meta">{metaText}</div>
            </div>
          )}

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
                  העלה גרסה חדשה
                </button>
              )}
            </div>
          )}
        </div>

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
          groupedDocs.map(group => (
            <section key={group.key} className="cp-card">
              <h2 className="cp-card-title">{group.key}</h2>
              {group.docs.map(renderDocRow)}
            </section>
          ))
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
