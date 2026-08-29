// src/pages/contractor/ContractorDocuments.jsx
//
// ONE FLAT LIST. No stages, no sub-stage headings, no tabs, no other
// sections. Every row is a "תוכניות לביצוע" document Einav has opened to
// him — the RLS SELECT policy enforces the sub-stage and the permission,
// so this screen never re-filters by either and has no 'hidden' branch.
//
// A DOCUMENT WITH NO FILE IS NOT SHOWN, in any of the three states.
// There is nothing to view, nothing to sign, nothing to approve — the
// previous behaviour rendered an upload button next to a sentence
// telling him to download a file that did not exist. See visibleDocs.
//
// Versions: the RLS policy on document_versions exposes only the LATEST
// row per document, so "the versions I can read" IS "the latest file".
// There is no history UI and no code here assumes older files exist.
//
// Visual language is the client portal's, reused rather than reinvented:
// ClientPortal.css's .cp-doc-* classes, ACTION_REQUIRED_RED for the open
// dot + sentence, #1D9E75 for the completed line. The extension chip
// follows the manager table's approach (strip the extension from the
// name, show it once as a tag) because an RTL context otherwise renders
// "1.jpg" as "jpg.1".
//
// RTL: direction is inherited from .cp-page. 'left' in CSS is the RIGHT
// side visually; nothing here sets a physical side.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useContractor } from '../../components/ContractorRoute'
import { ACTION_REQUIRED_RED } from '../../components/ActionRequiredBadge'
import { getFileExtension } from '../../components/documents/filePreview'
import {
  isContractorActionRequired,
  countContractorActionRequired,
} from '../../lib/contractorActionRequired'

const BUCKET = 'project-files'

/* Same green ClientDocuments uses for its "אושר ע״י ... בתאריך ..." line. */
const COMPLETED_GREEN = '#1D9E75'

/* The sentence each asking state shows while it is still open. 'view'
   has no entry and never shows one. Keyed by contractor_access, exactly
   as OPEN_REQUEST_TEXT is on the client side. Both texts now assume a
   file EXISTS, which after the visibleDocs filter is always true. */
const OPEN_REQUEST_TEXT = {
  sign:    'יש להוריד את הקובץ ולהעלותו שוב חתום',
  approve: 'יש לעיין בקובץ ולאשרו ע"י סימון V בתיבת האישור',
}

const COMPLETED_VERB = {
  sign:    'נחתם והועלה',
  approve: 'אושר',
}

/* Extension chip — the manager table's .dt-file-ext values, restated
   here rather than importing DocumentsTab.css (a staff stylesheet whose
   other rules have no business in the contractor portal). Same 10px
   uppercase tag on the same sand background. */
const EXT_CHIP = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  color: '#8a8680',
  background: '#eee9e1',
  borderRadius: 3,
  padding: '0 4px',
  flexShrink: 0,
}

function formatDateFull(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()}`
}

function clean(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function fileExt(name) {
  if (!name) return 'bin'
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === name.length - 1) return 'bin'
  return name.slice(dot + 1).toLowerCase()
}

/* Display-only: drop a trailing extension, because the chip beside the
   name already says it. Semantics copied deliberately from
   DocumentsTab's stripExtension (which is module-local there, so it
   cannot be imported) — same conservative rules:
     · no dot at all          → unchanged  ("plan")
     · dot only at position 0 → unchanged  (".gitignore")
     · dot at the very end    → unchanged  ("plan.")
     · dots inside the name   → only the LAST segment goes
   Never touches file_name in the DB; the full name stays in the title. */
function stripExtension(name) {
  if (!name) return name
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return name
  return name.slice(0, dot)
}

function newUuid() {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/* Download affordance — the file line is a control, so it carries a
   control's icon instead of a sentence explaining that it is clickable. */
const IconDownload = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
)

function OpenRequestNote({ text, style }) {
  return (
    <div
      className="cp-doc-meta"
      style={{
        display: 'flex', alignItems: 'center', gap: 6, direction: 'rtl',
        color: ACTION_REQUIRED_RED, ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0, width: 8, height: 8, borderRadius: 999,
          background: ACTION_REQUIRED_RED,
        }}
      />
      <span>{text}</span>
    </div>
  )
}

export default function ContractorDocuments({ projectId }) {
  const { id: contractorUid, displayName } = useContractor()

  const [status, setStatus]         = useState('loading') // loading | ready | error
  const [docs, setDocs]             = useState([])
  const [versionByDoc, setVerByDoc] = useState({})

  const [busyDocId, setBusyDocId] = useState(null)
  const [rowErrors, setRowErrors] = useState({})

  const isMounted    = useRef(true)
  const fileInputRef = useRef(null)
  const pickerDocRef = useRef(null)

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  const setRowError = (docId, msg) =>
    setRowErrors(prev => ({ ...prev, [docId]: msg }))

  const clearRowError = (docId) =>
    setRowErrors(prev => {
      if (!(docId in prev)) return prev
      const next = { ...prev }
      delete next[docId]
      return next
    })

  const loadData = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('project_documents')
      .select('id, name, contractor_access, contractor_completed_at, contractor_completed_by, sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })

    if (!isMounted.current) return

    if (error) {
      console.error('contractor documents load failed:', error)
      setStatus('error')
      return
    }

    const list = rows || []
    setDocs(list)

    const ids = list.map(d => d.id)
    const byDoc = {}
    if (ids.length > 0) {
      const { data: vers, error: vErr } = await supabase
        .from('document_versions')
        .select('id, document_id, file_url, file_name, uploaded_at')
        .in('document_id', ids)
      if (vErr) console.warn('contractor versions load failed:', vErr)
      else for (const v of vers || []) byDoc[v.document_id] = v
    }

    if (!isMounted.current) return
    setVerByDoc(byDoc)
    setStatus('ready')
  }, [projectId])

  useEffect(() => { setStatus('loading'); loadData() }, [loadData])

  /* ── THE filtered set — computed in exactly ONE place ──────────────
     A document with no file is not shown, in any state. Both the
     rendered rows and the pending count below read this same array, so
     a badge can never count a row the contractor cannot see.

     THIS IS A UI FILTER, NOT A SECURITY BOUNDARY. What he may reach is
     already decided by RLS (contractor_can_read_execution_plan_documents
     and contractor_can_read_latest_version); this only avoids showing a
     row that has nothing to act on. */
  const visibleDocs = useMemo(
    () => docs.filter(d => !!versionByDoc[d.id]?.file_url),
    [docs, versionByDoc]
  )

  const pendingCount = useMemo(
    () => countContractorActionRequired(visibleDocs),
    [visibleDocs]
  )

  /* ── approve — exactly the two permitted columns ─────────────────── */
  const approveDoc = async (docId) => {
    if (busyDocId) return
    clearRowError(docId)
    setBusyDocId(docId)
    try {
      const { data, error } = await supabase
        .from('project_documents')
        .update({
          contractor_completed_at: new Date().toISOString(),
          contractor_completed_by: contractorUid,
        })
        .eq('id', docId)
        .select('id')

      if (error) {
        console.error('contractor approve error:', error)
        setRowError(docId, error.code === 'PT002'
          ? 'לא ניתן לעדכן את השורה הזו. נא לפנות לסטודיו.'
          : 'שגיאה באישור, נסו שוב')
        return
      }
      /* Zero rows with NO error is what an RLS refusal looks like. */
      if (!Array.isArray(data) || data.length === 0) {
        console.error('contractor approve affected 0 rows', { docId })
        setRowError(docId, 'האישור לא נשמר, נסו שוב')
        return
      }
      await loadData()
    } catch (e) {
      console.error('contractor approve threw:', e)
      if (isMounted.current) setRowError(docId, 'שגיאה באישור, נסו שוב')
    } finally {
      if (isMounted.current) setBusyDocId(null)
    }
  }

  /* ── sign upload ──────────────────────────────────────────────────── */
  const handlePickFile = (docId) => {
    if (busyDocId) return
    pickerDocRef.current = docId
    clearRowError(docId)
    if (fileInputRef.current) fileInputRef.current.value = ''
    fileInputRef.current?.click()
  }

  const handleFileChosen = async (e) => {
    const file  = e.target.files?.[0]
    const docId = pickerDocRef.current
    e.target.value = ''
    if (!file || !docId) return

    setBusyDocId(docId)
    clearRowError(docId)
    try {
      /* Path MUST be <project_id>/<document_id>/<uuid>.<ext> — the
         storage policy resolves the document from segment 2 and
         cross-checks its project against segment 1. */
      const path = `${projectId}/${docId}/${newUuid()}.${fileExt(file.name)}`

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file)
      if (upErr) {
        console.error('contractor upload error:', upErr)
        setRowError(docId, 'העלאת הקובץ נכשלה, נסו שוב')
        return
      }

      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)

      const { data: verRows, error: verErr } = await supabase
        .from('document_versions')
        .insert({
          document_id: docId,
          file_url:    publicUrl,
          file_name:   file.name,
          uploaded_by: contractorUid,
          uploaded_at: new Date().toISOString(),
        })
        .select('id')

      if (verErr || !Array.isArray(verRows) || verRows.length === 0) {
        console.error('contractor version insert failed', { docId, verErr, rows: verRows?.length })
        setRowError(docId, 'הקובץ הועלה אך לא נרשם. נא לפנות לסטודיו.')
        return
      }

      /* Completion — again EXACTLY the two permitted columns. Notably
         NOT client_completed_at / client_completed_by. */
      const { data: docRows, error: docErr } = await supabase
        .from('project_documents')
        .update({
          contractor_completed_at: new Date().toISOString(),
          contractor_completed_by: contractorUid,
        })
        .eq('id', docId)
        .select('id')

      if (docErr || !Array.isArray(docRows) || docRows.length === 0) {
        console.error('contractor completion failed', { docId, docErr, rows: docRows?.length })
        setRowError(docId, 'הקובץ נשמר אך הסימון לא נרשם, נסו שוב')
        return
      }

      await loadData()
    } catch (err) {
      console.error('contractor upload threw:', err)
      if (isMounted.current) setRowError(docId, 'שגיאה בהעלאה, נסו שוב')
    } finally {
      if (isMounted.current) setBusyDocId(null)
    }
  }

  /* ── row ──────────────────────────────────────────────────────────
     Only ever called with a doc from visibleDocs, so a file always
     exists and there is no "no file yet" branch. */
  const renderRow = (doc) => {
    const access      = doc.contractor_access
    const openRequest = isContractorActionRequired(doc)
    const version     = versionByDoc[doc.id]
    const busy        = busyDocId === doc.id
    const rowError    = rowErrors[doc.id] || ''
    const docName     = clean(doc.name) || '—'

    const rawFileName = clean(version.file_name)
      || decodeURIComponent(version.file_url.split('/').pop())
    const ext = getFileExtension({ file_name: version.file_name, file_url: version.file_url })

    const completedBySelf = doc.contractor_completed_by === contractorUid
    const completedName   = completedBySelf ? (clean(displayName) || 'עצמך') : 'הסטודיו'

    return (
      <div key={doc.id} className="cp-doc-row">
        <div className="cp-doc-row-main">
          <div className="cp-doc-link cp-doc-link--inert" style={{ flex: 1, minWidth: 0 }}>
            {/* Document name — always sage. See the colour rule in the
                report: hue encodes WHAT a line is, never its state. */}
            <div className="cp-doc-name">{docName}</div>
          </div>

          {/* Upload only on 'sign'. No upload on 'view' or 'approve', and
              no delete control anywhere — the contractor has neither
              delete nor update on storage. */}
          {access === 'sign' && (
            <div className="cp-doc-actions">
              {busy ? (
                <span className="cp-doc-uploading">מעלה…</span>
              ) : (
                <button
                  type="button"
                  className="cp-doc-upload-btn"
                  onClick={() => handlePickFile(doc.id)}
                  disabled={!!busyDocId}
                >
                  {doc.contractor_completed_at ? 'העלה קובץ חדש' : 'העלה קובץ חתום'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* The latest file — one entry, never a history. The whole line
            is the control: extension chip, name without extension, and a
            download glyph. */}
        <a
          className="cp-doc-link"
          href={version.file_url}
          target="_blank"
          rel="noopener noreferrer"
          title={rawFileName}
          style={{
            marginTop: 6, direction: 'rtl',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={EXT_CHIP}>{ext}</span>
          <span className="cp-doc-file-name" style={{
            margin: 0, flex: '1 1 auto', minWidth: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            textDecoration: 'underline', textUnderlineOffset: 2,
          }}>
            {stripExtension(rawFileName)}
          </span>
          <span style={{ flexShrink: 0, color: '#7a9478', display: 'inline-flex' }}>
            <IconDownload />
          </span>
        </a>

        {openRequest && (
          <OpenRequestNote text={OPEN_REQUEST_TEXT[access]} style={{ marginTop: 6 }} />
        )}

        {access === 'approve' && !doc.contractor_completed_at && (
          <div style={{ marginTop: 8, direction: 'rtl' }}>
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              cursor: busyDocId ? 'default' : 'pointer',
            }}>
              <input
                type="checkbox"
                checked={false}
                disabled={!!busyDocId}
                onChange={() => approveDoc(doc.id)}
              />
              <span className="cp-doc-meta" style={{ fontWeight: 700 }}>
                {busy ? 'מאשר…' : 'אני מאשר/ת את הקובץ'}
              </span>
            </label>
          </div>
        )}

        {doc.contractor_completed_at && COMPLETED_VERB[access] && (
          <div
            className="cp-doc-meta"
            style={{ marginTop: 8, fontWeight: 700, color: COMPLETED_GREEN, direction: 'rtl' }}
          >
            {`${COMPLETED_VERB[access]} ע״י ${completedName} בתאריך ${formatDateFull(doc.contractor_completed_at)}`}
          </div>
        )}

        {rowError && <div className="cp-doc-error" role="alert">{rowError}</div>}
      </div>
    )
  }

  /* ── render ───────────────────────────────────────────────────────── */
  if (status === 'loading') {
    return <p className="cp-doc-meta" style={{ margin: 0 }}>טוען מסמכים...</p>
  }

  if (status === 'error') {
    return (
      <div className="cp-doc-error" role="alert">
        לא ניתן לטעון את המסמכים כרגע. נא לנסות שוב מאוחר יותר.
      </div>
    )
  }

  /* Two DIFFERENT normal empty states, deliberately worded apart so the
     contractor can tell which situation he is in. Neither is an error. */
  if (visibleDocs.length === 0) {
    const nothingOpened = docs.length === 0
    return (
      <div style={{
        background: '#ffffff',
        border: '0.5px solid rgba(26,26,24,0.1)',
        borderRadius: 10,
        padding: '18px 16px',
        direction: 'rtl',
      }}>
        <p style={{ margin: 0, color: '#1a1a18', fontSize: 15, fontWeight: 400 }}>
          {nothingOpened
            ? 'אין כרגע תוכניות לביצוע עבורך בפרויקט זה'
            : 'אין כרגע קבצים להצגה בפרויקט זה'}
        </p>
        <p style={{ margin: '6px 0 0', color: '#8a8680', fontSize: 14, fontWeight: 300, lineHeight: 1.5 }}>
          {nothingOpened
            ? 'כשהסטודיו יפתח עבורך מסמך, הוא יופיע כאן.'
            : 'המסמכים עבורך כבר הוגדרו, אך טרם צורפו אליהם קבצים. הם יופיעו כאן ברגע שיצורפו.'}
        </p>
      </div>
    )
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={handleFileChosen}
      />

      {/* Pending count — driven by visibleDocs, the same array the rows
          below are rendered from, so it can never count a hidden row. */}
      {pendingCount > 0 && (
        <div
          className="cp-doc-meta"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            direction: 'rtl', color: ACTION_REQUIRED_RED, margin: '0 0 10px',
          }}
        >
          <span aria-hidden="true" style={{
            flexShrink: 0, width: 8, height: 8, borderRadius: 999,
            background: ACTION_REQUIRED_RED,
          }} />
          <span>
            {pendingCount === 1 ? 'פריט אחד ממתין לך' : `${pendingCount} פריטים ממתינים לך`}
          </span>
        </div>
      )}

      <div>{visibleDocs.map(renderRow)}</div>
    </>
  )
}
