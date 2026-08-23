import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import PropagateAccessModal from './PropagateAccessModal'
/* Preview pane + file helpers/icons live in ./filePreview so the models
   table (ParentModelsPanel) reuses this exact pane instead of cloning
   it. Everything here behaves as it did when these were inline. */
import FilePreviewPane, {
  IconEye, IconDownload,
  fileExt, storagePathIn, isExternalUrlFor, downloadBlob,
  previewType, getFileExtension,
} from './filePreview'
/* Shared uuid → display-name resolver. client_completed_by can hold a
   CLIENT uuid, which lives in client_users/project_contacts rather than
   profiles, and this is the one helper that already walks all three. */
import { resolveUserNames } from '../../lib/resolveUserNames'
/* The reset rule is shared with PropagateAccessModal — defined once in
   the module that owns client-completion semantics. */
import { CLIENT_COMPLETION_RESET } from '../../lib/actionRequired'
import '../../DocumentsTab.css'

const ACCENT   = '#7bc1b5'
const ACCENT_DARK = '#4a9a8c'
const BUCKET   = 'project-files'

/* ── Stage definitions (order + kanban colors) — mirrors TasksTab.STAGES ── */
const STAGES = [
  { name: 'קליטת פרויקט', bg: '#f0f0f0', text: '#000' },
  { name: 'סקיצות והדמיות', bg: '#e8e197', text: '#000' },
  { name: 'הכנת גרמושקה',  bg: '#73946e', text: '#fff' },
  { name: 'רישוי',         bg: '#7bc1b5', text: '#000' },
  { name: 'תוכניות עבודה', bg: '#676977', text: '#fff' },
  { name: 'בניה',          bg: '#89748b', text: '#fff' },
  { name: 'גמר',           bg: '#87526d', text: '#fff' },
]

const STATUS_OPTIONS = ['חסר', 'התקבל']

/* ── Utilities ──
   The pure file helpers now live in ./filePreview (shared with the
   models table). These thin, bucket-bound wrappers keep this file's
   existing call sites unchanged. */
/* Display-only: drop a trailing extension, because the type chip beside
   the name already says it. Deliberately conservative —
     · no dot at all            → unchanged  ("plan")
     · dot only at position 0   → unchanged  (".gitignore")
     · dot only at the very end → unchanged  ("plan.")
     · dots inside the name     → only the LAST segment goes
                                  ("plan.v2.pdf" → "plan.v2")
   Never touches file_name in the DB; the full name stays in the title. */
function stripExtension(name) {
  if (!name) return name
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return name
  return name.slice(0, dot)
}

const storagePath   = (url) => storagePathIn(BUCKET, url)
const isExternalUrl = (url) => isExternalUrlFor(BUCKET, url)

/* ── Inline SVGs ── */
/* XCircle — חסר */
const IconXCircle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
)

/* ChevronDown — collapsed accordion */
const IconChevronDown = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

/* ChevronUp — expanded accordion */
const IconChevronUp = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
)

/* Trash2 — delete doc */
const IconTrash2 = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

/* ── Client access dropdown ──────────────────────────────────────────
   Per-row dropdown for project_documents.client_access, modelled on the
   StatusPopover used by TasksTab (visit src/components/tasks/TasksTab.jsx
   to compare): a tiny inline trigger that opens a floating list of three
   options on click; outside-click or Esc closes; clicking an option
   updates the row.

   Closed cell shows ONLY the icon for the current state, in that
   state's own colour (CLIENT_ACCESS_COLOR). The open dropdown lists all
   five options with a green highlight on the current selection —
   matching the StatusPopover layout.

   Three of the five ASK the client for something (sign / upload /
   approve); those are the states isDocumentActionRequired treats as an
   open request until client_completed_at is set. */

const CLIENT_ACCESS_OPTIONS = [
  { value: 'hidden',  label: 'ללא שיתוף לקוח'   },
  { value: 'view',    label: 'לצפייה בלבד'      },
  { value: 'sign',    label: 'נדרשת חתימה'      },
  { value: 'upload',  label: 'נדרשת העלאת קובץ' },
  { value: 'approve', label: 'נדרש אישור'       },
]

const CLIENT_ACCESS_COLOR = {
  hidden:  '#b4453a',
  view:    '#7a9478',
  sign:    '#7a9478',
  upload:  '#7a9478',
  approve: '#7a9478',
}

const CLIENT_ACCESS_TRIGGER_TITLE = {
  hidden:  'הלקוח לא רואה את הקובץ',
  view:    'הלקוח יכול לצפות בקובץ',
  sign:    'הלקוח מתבקש להוריד, לחתום ולהעלות מחדש',
  upload:  'הלקוח מתבקש להעלות קובץ',
  approve: 'הלקוח מתבקש לעיין בקובץ ולאשרו',
}

/* The single word the ביצוע לקוח cell shows once the client has acted.
   Keyed by the row's CURRENT client_access — a permission change resets
   client_completed_at, so the two can never disagree. Who did it and
   when lives in the cell's `title` tooltip rather than on screen, so the
   column stays scannable at a glance. */
const CLIENT_DONE_LABEL = {
  sign:    'נחתם',
  upload:  'הועלה',
  approve: 'אושר',
}

/* dd/mm/yyyy HH:mm, 24-hour — the admin table's own format (the client
   portal's formatDate is deliberately 2-digit and is not shared).
   Built from the local Date parts rather than toLocaleString so the
   order and separators can't shift with the browser's locale. */
function formatDoneStamp(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day   = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hh    = String(d.getHours()).padStart(2, '0')
  const mm    = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month}/${d.getFullYear()} ${hh}:${mm}`
}

/* ── One icon per client_access state ──
   All five share the same drawing contract: 24x24 viewBox, stroke-width
   1.7, round caps and joins, no fill, currentColor — so they read as one
   set at any size. Colour comes from CLIENT_ACCESS_COLOR via the
   trigger's inline style, never from the glyph itself. */

/* Eye with a diagonal slash — 'hidden'. */
const IconHiddenAccess = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
    <line x1="4" y1="20" x2="20" y2="4" />
  </svg>
)

/* Plain eye — 'view'. */
const IconEyeAccess = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

/* Document with a pen over it — 'sign'. Approved artwork; the two path
   `d` values are verbatim and must not be redrawn or re-fitted. The
   wrapper keeps the set's shared contract (size prop, 24x24 viewBox,
   stroke-width 1.7, round caps/joins, currentColor). */
const IconSignAccess = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>
    <path d="M20.4 3.6a1.9 1.9 0 0 1 0 2.7L14.5 12l-3 .8.8-3 5.9-5.9a1.9 1.9 0 0 1 2.7 0z"/>
  </svg>
)

/* Upward arrow into a tray — 'upload'. */
const IconUploadAccess = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

/* Check mark inside a circle — 'approve'. */
const IconApproveAccess = ({ size = 18 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <polyline points="8.5 12.5 11 15 15.5 9.5" />
  </svg>
)

/* ── The one sub-stage where an upload means a NEW VERSION ──
   Everywhere else in the system a row holding several files means
   "several parts of one thing" (two photos of an ID, two files of one
   submission). Under this sub-stage each upload supersedes the last, so
   the row shows only the newest and puts the rest behind a history
   toggle.

   Matched BY NAME through the sub_stages LUT, never by id — the rule
   this codebase already follows for stages, because ids are not
   guaranteed equal between Dev and Prod. Detected from the row's
   sub_stage, never from the document name. */
const EXECUTION_PLANS_SUB_STAGE = 'תוכניות לביצוע'

/* History — clock with a back arrow. Same drawing contract as IconEye /
   IconDownload in ./filePreview (13x13, viewBox 24, stroke-width 2,
   round caps and joins) so it sits in the icon strip without standing
   out. Deliberately not a new icon dependency. */
const IconHistory = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v5h5"/>
    <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>
    <path d="M12 7v5l3 2"/>
  </svg>
)

/* Stacked files — two overlapping sheets. Used on every NON-versioned
   row, where extra files are "more parts of the same thing" rather than
   history. Deliberately nothing like the clock: at a glance the two
   icons must not be mistaken for each other. Same 13x13 contract as
   IconEye / IconDownload / IconHistory. */
const IconStackedFiles = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="8" width="14" height="14" rx="2" ry="2"/>
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
  </svg>
)

/* Per-FILE delete. Deliberately 11px against the row-delete trash's
   14px, and muted grey against its red (#E24B4A) — the row trash
   removes the whole document, this one removes a single attachment, and
   the two sit close enough together that they must never read alike. */
const IconTrashFile = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
    <path d="M10 11v6"/>
    <path d="M14 11v6"/>
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

/* Share2 — "propagate this permission to child projects" affordance.
   Only rendered (parent projects, any non-hidden row) next to the
   ClientAccessPopover trigger; opens PropagateAccessModal. */
const IconShare2 = ({ size = 14 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
)

function accessIcon(value, size = 18) {
  if (value === 'view')    return <IconEyeAccess     size={size} />
  if (value === 'sign')    return <IconSignAccess    size={size} />
  if (value === 'upload')  return <IconUploadAccess  size={size} />
  if (value === 'approve') return <IconApproveAccess size={size} />
  return <IconHiddenAccess size={size} />
}

function ClientAccessPopover({ value, docId, onChange }) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, left: 0 })
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)

  /* Normalize to one of the five known values; unknown → 'hidden'. */
  const current = CLIENT_ACCESS_OPTIONS.find(o => o.value === value)?.value || 'hidden'
  const triggerColor = CLIENT_ACCESS_COLOR[current] || CLIENT_ACCESS_COLOR.hidden

  /* Outside-click + Esc close (same behaviour pattern as StatusPopover). */
  useEffect(() => {
    if (!open) return
    const clickHandler = (e) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target) &&
        popoverRef.current && !popoverRef.current.contains(e.target)
      ) setOpen(false)
    }
    const keyHandler = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', clickHandler)
    document.addEventListener('keydown',  keyHandler)
    return () => {
      document.removeEventListener('mousedown', clickHandler)
      document.removeEventListener('keydown',  keyHandler)
    }
  }, [open])

  const handleOpen = () => {
    if (open) { setOpen(false); return }
    const rect          = triggerRef.current.getBoundingClientRect()
    const popoverHeight = 190     /* approximate (5 options); flips upward if it would overflow */
    const below         = rect.bottom + 4
    const above         = rect.top - popoverHeight
    const top           = below + popoverHeight > window.innerHeight ? above : below
    setPos({ top, left: rect.left })
    setOpen(true)
  }

  const select = (val) => {
    setOpen(false)
    if (val !== current) onChange(docId, val)
  }

  return (
    <div className="dt-access-popover-wrap">
      <button
        ref={triggerRef}
        type="button"
        className="dt-access-trigger"
        style={{ color: triggerColor }}
        onClick={handleOpen}
        title={CLIENT_ACCESS_TRIGGER_TITLE[current]}
      >
        {accessIcon(current)}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="dt-access-popover"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
        >
          {CLIENT_ACCESS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              className={'dt-access-option' + (opt.value === current ? ' dt-access-option--active' : '')}
              onClick={() => select(opt.value)}
            >
              <span style={{ display: 'flex', alignItems: 'center' }}>
                {accessIcon(opt.value, 15)}
              </span>
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* CheckCircle — התקבל */
const IconCheckCircle = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  </svg>
)

const STATUS_META = {
  'חסר':   { icon: <IconXCircle />,     color: '#E24B4A', next: 'התקבל' },
  'התקבל': { icon: <IconCheckCircle />, color: '#1D9E75', next: 'חסר'   },
}

function StatusIcon({ status }) {
  const current = STATUS_META[status] ? status : 'חסר'
  const meta    = STATUS_META[current]
  return (
    <span className="dt-status-icon" style={{ color: meta.color }}>
      {meta.icon}
    </span>
  )
}

/* ── Single document row ──
   Now supports MULTIPLE attached files per row (each surfaced from a
   document_versions row; a legacy row with only project_documents
   .file_url is shown as a synthetic pseudo-version — see loadDocs). */
function DocRow({ doc, index, onPatch, onUpload, onVersionDelete, onDocDelete, onPreview, onClientAccessChange, isParentProject, onOpenPropagate, doneByName, isVersioned, nameById }) {
  const fileRef                       = useRef(null)
  const [uploading, setUploading]     = useState(false)
  const [confirming, setConfirming]   = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const versions = doc.versions || []
  const hasFiles = versions.length > 0

  /* versions is uploaded_at DESC, so [0] is the newest. EVERY row now
     shows only that one inline and puts the rest behind an icon — the
     pattern is uniform across the table, and only the wording and the
     glyph differ by what the extra files MEAN:

       תוכניות לביצוע → they are older versions   (clock, "גירסאות קודמות")
       everywhere else → they are more parts of
                         the same submission      (sheets, "קבצים נוספים")

     The panel, its layout and its per-file actions are identical in
     both cases. */
  const shownVersions = hasFiles ? versions.slice(0, 1) : versions
  const olderVersions = versions.slice(1)
  const expandLabel   = isVersioned ? 'גירסאות קודמות' : 'קבצים נוספים'
  /* Four labels: the sub-stage decides the noun (version vs file), and
     whether the row already holds one decides first-vs-next. */
  const attachLabel   = isVersioned
    ? (hasFiles ? 'העלאת גירסה עדכנית' : 'העלאת גירסה ראשונה')
    : (hasFiles ? 'העלאת קובץ נוסף'    : 'העלאת קובץ')

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    await onUpload(doc, file)
    setUploading(false)
    e.target.value = ''
  }

  return (
    <div className={'dt-doc-row' + (index % 2 === 1 ? ' dt-doc-row--even' : '')}>

      {/* שם המסמך */}
      <div className="dt-col-name">
        <span className="dt-doc-name">{doc.name || '—'}</span>
      </div>

      {/* סטטוס */}
      <div className="dt-col-status">
        <StatusIcon status={doc.status} />
      </div>

      {/* תאריך */}
      <div className="dt-col-date">
        <input
          type="date"
          value={doc.date || ''}
          onChange={e => onPatch(doc.id, 'date', e.target.value || null)}
          className="dt-date-input"
        />
      </div>

      {/* קובץ — the row's control line, then the newest attached file.
          Control line: [attach button] [expand toggle, when there are
          more files]. File line: [ext badge] [preview] [download]
          [per-file trash]. Any further files live in the expand panel
          below. Hidden input is shared — always mounted so the picker
          works whether or not files already exist. */}
      <div className="dt-col-file">
        <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={handleFileChange} />
        <div className="dt-file-list" style={{ display: 'flex', flexDirection: 'column', gap: 4, direction: 'rtl' }}>
          {/* The row's own control line: the attach button, and beside
              it the expand toggle. The toggle acts on the ROW (show the
              other files), which is why it lives here rather than in a
              file's icon strip — those icons act on one specific file.
              The button keeps its fixed width and does not move when the
              icon appears or disappears. */}
          <div className="dt-file-controls">
            {uploading ? (
              <span className="dt-file-uploading">מעלה...</span>
            ) : (
              <button
                type="button"
                className="dt-file-pick-btn"
                onClick={() => fileRef.current?.click()}
              >
                {attachLabel}
              </button>
            )}
            {/* Rendered only when there is something behind it — no
                reserved placeholder. A row without extra files lets the
                attach button stretch the full width of the column, so it
                ends slightly further along than a row that has the icon.
                That difference is intentional. */}
            {olderVersions.length > 0 && (
              <button
                type="button"
                className={'dt-file-icon-btn' + (showHistory ? ' dt-file-icon-btn--on' : '')}
                onClick={() => setShowHistory(h => !h)}
                title={expandLabel}
                aria-label={expandLabel}
                aria-expanded={showHistory}
              >
                {isVersioned ? <IconHistory /> : <IconStackedFiles />}
              </button>
            )}
          </div>

          {hasFiles && shownVersions.map((v) => {
            const vExt = getFileExtension(v)
            const vName = v.file_name
              || (v.file_url ? decodeURIComponent(v.file_url.split('/').pop()) : '')
            return (
              <div key={v.id} className="dt-file-existing" style={{ alignItems: 'center', gap: 4 }}>
                <span className="dt-file-ext">{vExt}</span>
                <span className="dt-file-name" title={vName}>{stripExtension(vName)}</span>
                <button type="button" className="dt-file-icon-btn" data-preview-control="1"
                  onClick={() => onPreview({ url: v.file_url, name: vName })} title="תצוגה מקדימה">
                  <IconEye />
                </button>
                <button type="button" className="dt-file-icon-btn"
                  onClick={() => isExternalUrl(v.file_url)
                    ? window.open(v.file_url, '_blank', 'noopener,noreferrer')
                    : downloadBlob(v.file_url, vName)
                  } title="הורד">
                  <IconDownload />
                </button>
                <button type="button" className="dt-file-icon-btn dt-file-delete-btn"
                  onClick={() => onVersionDelete(doc, v)} title="מחק קובץ">
                  <IconTrashFile />
                </button>
              </div>
            )
          })}

          {/* The extra files — inline panel, not a modal. This tab has
              no per-row expand pattern of its own, so it reuses the file
              cell's own dt-file-* vocabulary rather than inventing one.
              Per-file delete here is the SAME onVersionDelete the inline
              list uses, so Storage cleanup is unchanged. */}
          {showHistory && olderVersions.length > 0 && (
            <div className="dt-version-history">
              <div className="dt-version-history-title">{expandLabel}</div>
              {olderVersions.map(v => {
                const vName = v.file_name
                  || (v.file_url ? decodeURIComponent(v.file_url.split('/').pop()) : 'קובץ')
                const who = ((nameById && nameById[v.uploaded_by]) || '').trim() || '—'
                const when = formatDoneStamp(v.uploaded_at)
                return (
                  <div key={v.id} className="dt-version-row">
                    <span className="dt-file-ext">{getFileExtension(v)}</span>
                    <span className="dt-file-name" title={vName}>{stripExtension(vName)}</span>
                    <span className="dt-version-meta">
                      {[when, who].filter(Boolean).join(' · ')}
                    </span>
                    <button type="button" className="dt-file-icon-btn" data-preview-control="1"
                      onClick={() => onPreview({ url: v.file_url, name: vName })} title="תצוגה מקדימה">
                      <IconEye />
                    </button>
                    <button type="button" className="dt-file-icon-btn"
                      onClick={() => isExternalUrl(v.file_url)
                        ? window.open(v.file_url, '_blank', 'noopener,noreferrer')
                        : downloadBlob(v.file_url, vName)
                      } title="הורד">
                      <IconDownload />
                    </button>
                    <button type="button" className="dt-file-icon-btn dt-file-delete-btn"
                      onClick={() => onVersionDelete(doc, v)} title="מחק קובץ">
                      <IconTrashFile />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

        </div>
      </div>

      {/* הערות */}
      <div className="dt-col-notes">
        <input
          type="text"
          defaultValue={doc.notes || ''}
          onBlur={e => { if (e.target.value !== (doc.notes || '')) onPatch(doc.id, 'notes', e.target.value) }}
          className="dt-notes-input"
          placeholder="הערה..."
          dir="rtl"
        />
      </div>

      {/* ביצוע לקוח — what the client has already done on this row.
          RTL: this sits BEFORE הרשאות לקוח in DOM order, which paints it
          to the visual RIGHT of that column. Empty until the client acts;
          a permission change clears it (see patchClientAccess). */}
      <div className="dt-col-client-done">
        {doc.client_completed_at && CLIENT_DONE_LABEL[doc.client_access] && (
          /* Native `title`, the convention this file already uses for
             "short on screen, full detail on hover" (see the truncated
             file name above). An unresolved name drops out so the
             tooltip never opens with a dangling separator. */
          <span
            className="dt-client-done"
            title={[doneByName, formatDoneStamp(doc.client_completed_at)]
              .filter(Boolean)
              .join(' · ')}
          >
            {CLIENT_DONE_LABEL[doc.client_access]}
          </span>
        )}
      </div>

      {/* הרשאות לקוח — closed cell shows the icon for the current state;
          clicking opens a small dropdown with five options. Layout +
          behaviour mirror StatusPopover from TasksTab. */}
      <div className="dt-col-client-access">
        <ClientAccessPopover
          value={doc.client_access}
          docId={doc.id}
          onChange={onClientAccessChange}
        />
        {isParentProject && doc.template_id != null &&
          doc.client_access !== 'hidden' && (
          <button
            type="button"
            className="dt-propagate-btn"
            title="שיתוף ההרשאה הזו גם עם פרויקטי-בן"
            onClick={() => onOpenPropagate(doc)}
          >
            <IconShare2 />
          </button>
        )}
      </div>

      {/* מחק — כל השורות */}
      <div className="dt-col-delete">
        {confirming ? (
          <div className="dt-delete-confirm">
            <span className="dt-delete-confirm-text">למחוק?</span>
            <button type="button" className="dt-delete-confirm-yes" onClick={() => onDocDelete(doc.id)}>כן</button>
            <button type="button" className="dt-delete-confirm-no"  onClick={() => setConfirming(false)}>לא</button>
          </div>
        ) : (
          <button type="button" className="dt-row-delete-btn" onClick={() => setConfirming(true)} title="מחק מסמך זה מהפרויקט">
            <IconTrash2 />
          </button>
        )}
      </div>

    </div>
  )
}

/* ── Add custom doc inline form ── */
function AddDocRow({ stage, stageId, subStageId, onAdd }) {
  const [adding, setAdding]   = useState(false)
  const [name,   setName]     = useState('')
  const inputRef              = useRef(null)

  const confirm = async () => {
    if (!name.trim()) return
    await onAdd(stage, stageId, subStageId, name.trim())
    setName(''); setAdding(false)
  }

  if (!adding) {
    return (
      <button type="button" className="dt-add-row-link" onClick={() => { setAdding(true); setTimeout(() => inputRef.current?.focus(), 0) }}>
        + הוסף מסמך
      </button>
    )
  }

  return (
    <div className="dt-add-row-inline">
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') { setAdding(false); setName('') } }}
        className="dt-add-row-input"
        placeholder="שם המסמך..."
        dir="rtl"
      />
      <button type="button" className="dt-add-row-confirm" onClick={confirm}>אישור</button>
      <button type="button" className="dt-add-row-cancel" onClick={() => { setAdding(false); setName('') }}>ביטול</button>
    </div>
  )
}

/* ── Main component ── */
export default function DocumentsTab({ projectId, isParentProject }) {
  const [docs,        setDocs]        = useState([])
  /* { docId, templateId, docName, accessValue } | null — controls
     PropagateAccessModal. Only ever opened via the dt-propagate-btn,
     which itself only renders for parent projects, so no extra gating
     is needed here beyond what's already in openPropagate's caller. */
  const [propagateTarget, setPropagateTarget] = useState(null)
  const [stagesLut,   setStagesLut]   = useState([])
  const [subStages,   setSubStages]   = useState([])
  const [loading,     setLoading]     = useState(true)
  const [openStages,  setOpenStages]  = useState({})
  const [previewFile,    setPreviewFile]    = useState(null) // { url, name }
  /* The tab's own root and the preview panel. The outside-click listener
     is scoped to the root, so "outside" means elsewhere IN THIS TAB —
     not the whole page. */
  const rootRef        = useRef(null)
  const previewPaneRef = useRef(null)
  /* A ref, not state: it must be current when the click handler reads it
     but must never cause the listener to be torn down and re-attached
     mid-upload. */
  const uploadingRef   = useRef(false)

  /* Eye click. Same file → close (toggle); a different file → switch
     straight to it without an intermediate closed state. Functional
     update so it always compares against the live value. */
  const togglePreview = (file) => {
    setPreviewFile(prev => (prev && prev.url === file.url) ? null : file)
  }

  /* ── Auto-close the preview ──
     Listeners exist ONLY while the pane is open and are removed the
     moment it closes — nothing permanent is attached to document.

     The click listener lives on the tab root rather than on document,
     so it cannot fire for clicks elsewhere in the app. It uses
     mousedown, which matters: the effect is registered after the render
     caused by the opening click, so the click that opened the pane is
     already finished and cannot close it again. The
     [data-preview-control] check is the second guard on the same
     point — an eye button's own onClick owns that decision. */
  useEffect(() => {
    if (!previewFile) return
    const root = rootRef.current
    if (!root) return

    const onMouseDown = (e) => {
      /* Never yank the pane out from under an upload in flight — it
         would read as the upload having failed. */
      if (uploadingRef.current) return
      /* Interactions that belong to the preview itself. */
      if (previewPaneRef.current && previewPaneRef.current.contains(e.target)) return
      /* An eye button — its own handler decides open/close/switch. */
      if (e.target.closest && e.target.closest('[data-preview-control]')) return
      setPreviewFile(null)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !uploadingRef.current) setPreviewFile(null)
    }

    root.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [previewFile])
  const [accessError,    setAccessError]    = useState('')   /* transient toast for client_access save failures */
  /* client_completed_by uuid → display name, for the ביצוע לקוח column.
     Batched once per load via the shared resolver — never per row. */
  const [doneByName,     setDoneByName]     = useState({})

  useEffect(() => { loadDocs() }, [projectId])

  const loadDocs = async () => {
    setLoading(true)

    /* ── Fetch LUTs (stages + sub_stages) ── */
    const [
      { data: stagesLutData },
      { data: subStagesData },
    ] = await Promise.all([
      supabase.from('stages').select('id, name').order('order_index'),
      supabase.from('sub_stages').select('id, name, stage_id, order_index').order('order_index'),
    ])
    setStagesLut(stagesLutData || [])
    setSubStages(subStagesData || [])

    /* ── Step 1: fetch current rows. Seeding from document_templates now
       happens in a DB trigger at project-creation time, not here. ── */
    const { data } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order')

    /* ── Step 2: load version list per doc.
       One query, grouped in memory. Newest first per doc (uploaded_at DESC),
       which matches the parent's denormalized file_url — the latest upload
       always sits at the top of the list. */
    const rows = data || []
    const docIds = rows.map(d => d.id)
    let versionsByDoc = {}
    if (docIds.length > 0) {
      const { data: versionsData } = await supabase
        .from('document_versions')
        .select('id, document_id, file_url, file_name, uploaded_by, uploaded_at')
        .in('document_id', docIds)
        .order('uploaded_at', { ascending: false })
      for (const v of versionsData || []) {
        if (!versionsByDoc[v.document_id]) versionsByDoc[v.document_id] = []
        versionsByDoc[v.document_id].push(v)
      }
    }

    /* Attach the versions array to each doc. If a doc has a parent
       file_url but NO document_versions rows, it's a legacy admin
       upload (before this change wrote versions). Surface it as a
       synthetic pseudo-version so it shows in the UI list without
       auto-writing to the DB on load. Distinguished by `isLegacy:true`
       and an id prefix — every mutation path checks the flag. */
    const merged = rows.map(d => {
      const real = versionsByDoc[d.id] || []
      let versions = real
      if (real.length === 0 && d.file_url) {
        versions = [{
          id:          `__legacy__${d.id}`,
          document_id: d.id,
          file_url:    d.file_url,
          file_name:   d.file_name || null,
          uploaded_by: null,
          uploaded_at: null,
          isLegacy:    true,
        }]
      }
      return { ...d, versions }
    })

    setDocs(merged)

    /* Resolve who completed each row, for the ביצוע לקוח column. One
       batched call over the union of ids; a failure here must not blank
       the table, so it degrades to "no name" and surfaces the reason in
       the same toast the access dropdown uses. */
    /* Both the ביצוע לקוח column and the version-history panel need
       names, so they share one batched resolve over the union of ids. */
    const doneIds = Array.from(new Set([
      ...merged.map(d => d.client_completed_by),
      ...merged.flatMap(d => (d.versions || []).map(v => v.uploaded_by)),
    ].filter(Boolean)))
    if (doneIds.length > 0) {
      try {
        setDoneByName(await resolveUserNames(doneIds))
      } catch (e) {
        console.error('resolveUserNames (client_completed_by) failed:', e)
        setDoneByName({})
        setAccessError('לא הצלחנו לטעון את שמות המבצעים')
        setTimeout(() => setAccessError(''), 3000)
      }
    } else {
      setDoneByName({})
    }

    const state = {}
    STAGES.forEach(s => { state[s.name] = false })
    setOpenStages(state)
    setLoading(false)
  }

  /* ── Patch a field (optimistic) ── */
  const patchDoc = async (docId, field, value) => {
    setDocs(prev => prev.map(d => d.id === docId ? { ...d, [field]: value } : d))
    await supabase.from('project_documents').update({ [field]: value }).eq('id', docId)
  }

  /* ── Patch client_access — optimistic with revert + toast on error ──
     Now driven by the per-row dropdown (ClientAccessPopover) — receives
     the explicit target value instead of cycling. The popover already
     short-circuits same-value selects, but we double-check defensively. */
  const patchClientAccess = async (docId, value) => {
    const doc = docs.find(d => d.id === docId)
    if (!doc) return
    const prev = doc.client_access
    if (value === prev) return

    /* Changing the permission ALWAYS clears the recorded completion.
       Without this the row would keep claiming the client signed or
       approved something, while now asking them for something else —
       a record of consent the client never actually gave. */
    const prevDoneAt = doc.client_completed_at
    const prevDoneBy = doc.client_completed_by

    setDocs(prevDocs => prevDocs.map(d =>
      d.id === docId
        ? { ...d, client_access: value, ...CLIENT_COMPLETION_RESET }
        : d
    ))

    /* .select() + row count: a refused UPDATE answers 204 with no body,
       which is otherwise indistinguishable from a successful one. */
    const { data: updatedRows, error } = await supabase
      .from('project_documents')
      .update({ client_access: value, ...CLIENT_COMPLETION_RESET })
      .eq('id', docId)
      .select('id')

    if (error || !Array.isArray(updatedRows) || updatedRows.length === 0) {
      console.error('client_access update failed:', error || '0 rows affected')
      setDocs(prevDocs => prevDocs.map(d =>
        d.id === docId
          ? { ...d, client_access: prev, client_completed_at: prevDoneAt, client_completed_by: prevDoneBy }
          : d
      ))
      setAccessError('לא הצלחנו לעדכן, נסה שוב')
      setTimeout(() => setAccessError(''), 3000)
    }
  }

  /* ── Open the "share this permission with child projects" modal for
     one row — captures the row's template_id + the access value it
     currently holds (parent's own row is untouched by this flow). ── */
  const openPropagate = (doc) => {
    setPropagateTarget({
      templateId: doc.template_id,
      docName:    doc.name,
      accessValue: doc.client_access,
    })
  }

  /* ── File upload — APPENDS a version, does NOT replace ──
     A row can now hold N files: each upload lands as a new
     document_versions row, and the parent project_documents is kept
     pointing at the LATEST file (denormalized "current" for legacy
     single-file consumers + the client's read path). Status flips
     to 'התקבל' and date to today on every upload (row-level "received"
     signal keeps existing counters correct). */
  const uploadFile = async (doc, file) => {
    uploadingRef.current = true
    try {
      return await doUploadFile(doc, file)
    } finally {
      uploadingRef.current = false
    }
  }

  const doUploadFile = async (doc, file) => {
    const fileExt = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
    const path    = `${projectId}/${doc.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${fileExt}`
    const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file)
    if (uploadErr) { console.error('Upload error:', uploadErr); return }
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const today = new Date().toISOString().slice(0, 10)

    /* Grab the current user id so uploaded_by is recorded. Falls back
       to null if the session probe fails — the column is nullable and
       the RLS staff policy doesn't require it, so INSERT still works. */
    let userId = null
    try {
      const { data: { session } } = await supabase.auth.getSession()
      userId = session?.user?.id || null
    } catch { /* stay null */ }

    /* Insert the new version row. We select back the inserted row so
       we can push it into local state with the same shape the loader
       produces. */
    const { data: inserted, error: insertErr } = await supabase
      .from('document_versions')
      .insert({
        document_id: doc.id,
        file_url:    publicUrl,
        file_name:   file.name,
        uploaded_by: userId,
      })
      .select('id, document_id, file_url, file_name, uploaded_by, uploaded_at')
      .single()
    if (insertErr) { console.error('Version insert error:', insertErr); return }

    /* In the versioned sub-stage a manager upload is a NEW REQUEST: the
       client must sign / upload / approve against the new version, so
       any completion recorded against the PREVIOUS one is cleared. Same
       reset the permission change uses — one shared constant, not a
       second copy of the rule.

       This is always a manager upload (it is the manager's tab), so
       there is no collision with the staff-view rule in ClientDocuments:
       that rule only prevents SETTING completion, and this only clears
       it. Nothing here ever stamps a completion. */
    const subStageName  = subStages.find(ss => ss.id === doc.sub_stage_id)?.name || null
    const isVersionedRow = subStageName === EXECUTION_PLANS_SUB_STAGE

    /* Denormalize the latest onto the parent so single-file consumers
       (client portal, older code) keep working. .select() + row count is
       required: a refused UPDATE answers 204 with no body and is
       otherwise indistinguishable from success. */
    const { data: updatedRows, error: parentErr } = await supabase
      .from('project_documents')
      .update({
        file_url:  publicUrl,
        file_name: file.name,
        status:    'התקבל',
        date:      today,
        ...(isVersionedRow ? CLIENT_COMPLETION_RESET : {}),
      })
      .eq('id', doc.id)
      .select('id')

    if (parentErr || !Array.isArray(updatedRows) || updatedRows.length === 0) {
      console.error('Parent document update failed:', parentErr || '0 rows affected')
      setAccessError('הקובץ הועלה אך עדכון השורה נכשל — רענני ונסי שוב')
      setTimeout(() => setAccessError(''), 4000)
      return
    }

    setDocs(prev => prev.map(d => {
      if (d.id !== doc.id) return d
      /* Drop any legacy pseudo-version once we have a real one — its
         file_url was equal to d.file_url anyway, and it isn't a real
         DB row. Prepend the new version so uploaded_at DESC ordering
         holds. */
      const prevVersions = (d.versions || []).filter(v => !v.isLegacy)
      return {
        ...d,
        file_url:  publicUrl,
        file_name: file.name,
        status:    'התקבל',
        date:      today,
        versions:  [inserted, ...prevVersions],
        ...(isVersionedRow ? CLIENT_COMPLETION_RESET : {}),
      }
    }))
  }

  /* ── Per-file delete — deletes ONE version + keeps parent in sync ──
     If the deleted file was the parent's current denormalized file_url
     (i.e. the latest), the parent moves to the NEW latest of what's
     left (or NULL + status='חסר' + date=null if the last file was
     removed). If the deleted file wasn't the latest, the parent stays.
     Legacy pseudo-versions skip the DB DELETE (no row exists) but
     still clear the parent + remove the storage object. */
  const deleteVersion = async (doc, version) => {
    /* 1. Remove the storage object (fixes the historic leak on
       overwrites). External URLs (e.g. Google Drive) return null from
       storagePath and are skipped — nothing to remove. */
    if (version.file_url) {
      const path = storagePath(version.file_url)
      if (path) await supabase.storage.from(BUCKET).remove([path])
    }

    /* 2. Delete the DB row unless this is the legacy pseudo-version. */
    if (!version.isLegacy) {
      await supabase.from('document_versions').delete().eq('id', version.id)
    }

    /* 3. Recompute the remaining versions list in local state, then
       decide whether the parent's denormalized fields need updating. */
    const remaining = (doc.versions || []).filter(v => v.id !== version.id)

    /* Was the deleted file the one the parent currently points to?
       Compare on file_url — that's the denormalization key. */
    const wasLatest = doc.file_url && doc.file_url === version.file_url

    let parentPatch = null
    if (remaining.length === 0) {
      /* No files left → row reverts to "חסר". */
      parentPatch = { file_url: null, file_name: null, status: 'חסר', date: null }
    } else if (wasLatest) {
      /* Latest deleted → point parent at the new latest (top of the
         remaining list, since we keep it sorted DESC). Status stays
         "התקבל" — there are still files attached. */
      const newLatest = remaining[0]
      parentPatch = { file_url: newLatest.file_url, file_name: newLatest.file_name }
    }
    /* else: not-latest deleted → parent is untouched. */

    if (parentPatch) {
      await supabase.from('project_documents').update(parentPatch).eq('id', doc.id)
    }

    setDocs(prev => prev.map(d => {
      if (d.id !== doc.id) return d
      return { ...d, ...(parentPatch || {}), versions: remaining }
    }))
  }

  /* ── Add custom doc ── */
  const addCustomDoc = async (stage, stageId, subStageId, name) => {
    /* peers = docs already in the same target group (for sort_order) */
    const peers = docs.filter(d => {
      if (subStageId == null) return d.stage_id === stageId && d.sub_stage_id == null
      return d.sub_stage_id === subStageId
    })
    const maxOrder = peers.reduce((m, d) => Math.max(m, d.sort_order ?? 0), 0)
    const { data } = await supabase
      .from('project_documents')
      .insert([{
        project_id:   projectId,
        template_id:  null,
        stage,
        stage_id:     stageId,
        sub_stage_id: subStageId,
        name,
        required:     true,
        status:       'חסר',
        sort_order:   maxOrder + 1,
      }])
      .select()
      .single()
    if (data) setDocs(prev => [...prev, data])
  }

  /* ── Delete custom doc (whole row) ──
     document_versions.document_id ON DELETE CASCADE wipes the DB
     rows automatically, but the Storage objects are separate — we
     iterate every version + fall back to the parent file_url for
     legacy rows so no object is left orphaned. Duplicate paths are
     de-duped before the batch remove. */
  const deleteDoc = async (docId) => {
    const doc = docs.find(d => d.id === docId)
    if (doc) {
      const paths = new Set()
      for (const v of (doc.versions || [])) {
        const p = v.file_url ? storagePath(v.file_url) : null
        if (p) paths.add(p)
      }
      /* Extra safety: if the parent still has a file_url that isn't
         covered by versions (edge case on a partially-loaded row),
         include it too. */
      if (doc.file_url) {
        const p = storagePath(doc.file_url)
        if (p) paths.add(p)
      }
      if (paths.size > 0) {
        await supabase.storage.from(BUCKET).remove([...paths])
      }
    }
    await supabase.from('project_documents').delete().eq('id', docId)
    setDocs(prev => prev.filter(d => d.id !== docId))
  }

  /* ── Progress ── */
  const receivedDocs = docs.filter(d => d.status === 'התקבל')
  const pct = docs.length > 0
    ? Math.round((receivedDocs.length / docs.length) * 100)
    : 0

  /* ── Group by stage ── */
  const byStage = {}
  STAGES.forEach(s => { byStage[s.name] = [] })
  docs.forEach(d => {
    if (byStage[d.stage]) byStage[d.stage].push(d)
    else byStage[d.stage] = [d]
  })

  /* ── Lookups derived from LUTs ── */
  const stageIdByName = {}
  stagesLut.forEach(s => { stageIdByName[s.name] = s.id })

  /* sub_stage_id → name, so a row can be recognised as belonging to the
     versioned sub-stage BY NAME rather than by a hard-coded id. */
  const subStageNameById = {}
  subStages.forEach(ss => { subStageNameById[ss.id] = ss.name })

  const subStagesByStageId = {}
  subStages.forEach(ss => {
    if (!subStagesByStageId[ss.stage_id]) subStagesByStageId[ss.stage_id] = []
    subStagesByStageId[ss.stage_id].push(ss)
  })

  const toggleStage = (stage) =>
    setOpenStages(prev => ({ ...prev, [stage]: !prev[stage] }))

  if (loading) return <p className="dt-loading">טוען מסמכים...</p>

  return (
    <div className="dt-root" dir="rtl" ref={rootRef}>

      {/* ── Right panel: accordion list ── */}
      <div className="dt-panel-right">

        {/* Progress bar */}
        <div className="dt-progress-section">
          <div className="dt-progress-label">
            <strong>{receivedDocs.length} מתוך {docs.length}</strong> מסמכים התקבלו
          </div>
          <div className="dt-progress-track">
            <div className="dt-progress-fill" style={{ width: `${pct}%`, background: ACCENT }} />
          </div>
          <span className="dt-progress-pct">{pct}%</span>
        </div>

        {/* Accordions */}
        <div className="dt-accordions">
          {STAGES.map(({ name: stage, bg, text }) => {
            const stageDocs      = byStage[stage] || []
            const stageReceived  = stageDocs.filter(d => d.status === 'התקבל')
            const isComplete     = stageDocs.length > 0 && stageReceived.length === stageDocs.length
            const isOpen         = openStages[stage]
            const stageId        = stageIdByName[stage] ?? null
            const stageSubStages = stageId != null ? (subStagesByStageId[stageId] || []) : []
            const hasSubStages   = stageSubStages.length > 0

            return (
              <div key={stage} className="dt-accordion">
                <button
                  type="button"
                  className="dt-accordion-header"
                  style={{ background: bg, color: text }}
                  onClick={() => toggleStage(stage)}
                >
                  <span className="dt-accordion-arrow">{isOpen ? <IconChevronUp /> : <IconChevronDown />}</span>
                  <span className="dt-accordion-title">{stage}</span>
                  <span className="dt-accordion-count" style={{
                    background: 'rgba(255,255,255,0.3)',
                    color: text,
                  }}>
                    {stageReceived.length}/{stageDocs.length}
                  </span>
                </button>

                {isOpen && (
                  <div className="dt-accordion-body">
                    {stageDocs.length > 0 && (
                      <div className="dt-table-header">
                        <div className="dt-col-name">שם המסמך</div>
                        <div className="dt-col-status">סטטוס</div>
                        <div className="dt-col-date">תאריך</div>
                        <div className="dt-col-file">קובץ</div>
                        <div className="dt-col-notes">הערות</div>
                        <div className="dt-col-client-done">ביצוע לקוח</div>
                        <div className="dt-col-client-access">הרשאות לקוח</div>
                        <div className="dt-col-delete" />
                      </div>
                    )}

                    {hasSubStages ? (
                      /* Stage HAS sub-stages — render grouped by sub_stage_id */
                      stageSubStages.map(ss => {
                        const ssDocs = stageDocs
                          .filter(d => d.sub_stage_id === ss.id)
                          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                        return (
                          <div key={ss.id} className="dt-sub-stage-group">
                            <div className="dt-sub-stage-header">{ss.name}</div>
                            {ssDocs.map((doc, i) => (
                              <DocRow
                                key={doc.id}
                                doc={doc}
                                index={i}
                                onPatch={patchDoc}
                                onUpload={uploadFile}
                                onVersionDelete={deleteVersion}
                                onDocDelete={deleteDoc}
                                onPreview={togglePreview}
                                onClientAccessChange={patchClientAccess}
                                isParentProject={isParentProject}
                                onOpenPropagate={openPropagate}
                                doneByName={doneByName[doc.client_completed_by] || ''}
                                isVersioned={subStageNameById[doc.sub_stage_id] === EXECUTION_PLANS_SUB_STAGE}
                                nameById={doneByName}
                              />
                            ))}
                            <AddDocRow
                              stage={stage}
                              stageId={stageId}
                              subStageId={ss.id}
                              onAdd={addCustomDoc}
                            />
                          </div>
                        )
                      })
                    ) : (
                      /* No sub-stages — flat list as before */
                      <>
                        {stageDocs.map((doc, i) => (
                          <DocRow
                            key={doc.id}
                            doc={doc}
                            index={i}
                            onPatch={patchDoc}
                            onUpload={uploadFile}
                            onVersionDelete={deleteVersion}
                            onDocDelete={deleteDoc}
                            onPreview={togglePreview}
                            onClientAccessChange={patchClientAccess}
                            isParentProject={isParentProject}
                            onOpenPropagate={openPropagate}
                            doneByName={doneByName[doc.client_completed_by] || ''}
                            isVersioned={subStageNameById[doc.sub_stage_id] === EXECUTION_PLANS_SUB_STAGE}
                            nameById={doneByName}
                          />
                        ))}
                        <AddDocRow
                          stage={stage}
                          stageId={stageId}
                          subStageId={null}
                          onAdd={addCustomDoc}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

      </div>

      {/* Transient error toast for client_access save failures.
          Fixed-position so it floats above whichever panel is active. */}
      {accessError && (
        <div className="dt-access-toast" role="alert">{accessError}</div>
      )}

      {/* ── Left panel: preview ── */}
      <div className="dt-panel-left" ref={previewPaneRef}>
        <FilePreviewPane file={previewFile} bucket={BUCKET} />
      </div>

      {/* ── Propagate client_access to child projects (parent projects only) ── */}
      {propagateTarget && (
        <PropagateAccessModal
          parentProjectId={projectId}
          templateId={propagateTarget.templateId}
          docName={propagateTarget.docName}
          accessValue={propagateTarget.accessValue}
          onClose={() => setPropagateTarget(null)}
        />
      )}

    </div>
  )
}
