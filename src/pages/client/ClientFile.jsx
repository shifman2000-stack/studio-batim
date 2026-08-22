// src/pages/client/ClientFile.jsx
//
// "פרטי תיק" screen — view + edit mode.
//
// Card order (top → bottom):
//   1. פרטים אישיים  (was "אנשי קשר" — the ONLY editable card)
//   2. פרטי מגרש      (read-only)
//   3. בעלי מקצוע    (read-only)
//
// "אחראית פרויקט" and "פרטי רישוי" cards are intentionally absent on
// the client side — they exist on the manager-side ProjectDetail but
// the client never sees them.
//
// VIEW MODE (default): three cards as above. The "ערוך" button lives
// INSIDE the "פרטים אישיים" card header (the only editable card).
//
// EDIT MODE: only "פרטים אישיים" becomes editable. The other two cards
// stay as read-only display even in edit mode. Two sticky buttons at
// the bottom of the viewport — "שמור" (sage) and "ביטול" (neutral).
//
// On save: only changed project_contacts rows are updated, in parallel
// via Promise.all. RLS already restricts writes to the client's own
// project. If no contact changed, save is a silent no-op + flash.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase, isPreviewBlockedError } from '../../supabaseClient'
import { useClient } from '../../components/ClientRoute'
import { useClientFooter } from './ClientFooter'
import { logError } from '../../lib/clientActivityLog'
import { computeContactsActionRequired } from '../../lib/actionRequired'
import { ActionRequiredDot } from '../../components/ActionRequiredBadge'

/* ── Section: פרטי מגרש — client_info columns (READ-ONLY) ────────── */
const PROJECT_DETAIL_FIELDS = [
  { field: 'city',         label: 'ישוב' },
  { field: 'gush',         label: 'גוש' },
  { field: 'helka',        label: 'חלקה' },
  { field: 'migrash',      label: 'מגרש' },
  { field: 'area',         label: 'שטח המגרש' },
  { field: 'active_plans', label: 'תוכניות חלות במקום', multiline: true },
]

/* Contact fields per row in project_contacts (editable).
   Note: id_number stays default direction (RTL) — values are typed
   numbers but the input/value behaves correctly under the surrounding
   RTL layout without an explicit dir override. */
const CONTACT_FIELDS = [
  { field: 'first_name', label: 'שם פרטי' },
  { field: 'last_name',  label: 'שם משפחה' },
  { field: 'id_number',  label: 'ת״ז' },
  { field: 'phone',      label: 'טלפון',  ltr: true },
  { field: 'email',      label: 'אימייל', ltr: true },
]

/* ── Section: בעלי מקצוע — READ-ONLY ─────────────────────────────── */
const PROFESSIONAL_ROLES = [
  { key: 'surveyor',          label: 'מודד' },
  { key: 'constructor',       label: 'קונסטרוקטור' },
  { key: 'plumbing_engineer', label: 'מהנדס אינסטלציה' },
  { key: 'soil_consultant',   label: 'יועץ קרקע' },
  { key: 'contractor',        label: 'קבלן' },
  { key: 'supervisor',        label: 'מפקח' },
  { key: 'project_manager',   label: 'מנהל פרויקט' },
]

function clean(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

function fullName(first, last) {
  const parts = [clean(first), clean(last)].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

/* Normalize a draft value for DB write: empty / whitespace → null, else trimmed string. */
function normalizeForDb(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/* ── Inline SVG icons (Feather-like, stroke="currentColor") ────────── */
const IconChevron = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)

const IconPencil = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
  </svg>
)

export default function ClientFile() {
  const { id: clientUserId, project_id, previewMode } = useClient()
  const logCtx = { projectId: project_id, clientUserId, previewMode }
  const isMounted = useRef(true)

  /* ── Loaded data (source of truth, refreshed after save) ─────────── */
  const [project, setProject]         = useState(null)
  const [clientInfo, setClientInfo]   = useState(null)
  const [contacts, setContacts]       = useState([])
  const [profById, setProfById]       = useState({})
  const [loading, setLoading]         = useState(true)
  /* A load that FAILED, as distinct from a load that returned nothing.
     Without this the two are the same screen, which is how the Prod
     42703 below stayed invisible. */
  const [loadError, setLoadError]     = useState(false)

  /* ── Edit-mode state ─────────────────────────────────────────────
     Only contacts are editable, so the only draft we keep is contactsDraft.
     [{ id, first_name, last_name, id_number, phone, email }] */
  const [editMode, setEditMode]           = useState(false)
  const [contactsDraft, setContactsDraft] = useState([])
  const [saving, setSaving]               = useState(false)
  const [saveError, setSaveError]         = useState('')
  const [savedFlash, setSavedFlash]       = useState(false)

  /* ── Accordion state ─────────────────────────────────────────────
     Set of currently-open block keys. Default: only 'personal' open;
     'project' and 'professionals' collapsed. Visual language matches
     the שלבי התקדמות accordion (.cp-progress-block / .cp-progress-header). */
  const [openSet, setOpenSet] = useState(new Set(['personal']))

  useEffect(() => {
    isMounted.current = true
    return () => { isMounted.current = false }
  }, [])

  /* While editing, hide the portal's sticky contact footer so it
     doesn't compete with the fixed save/cancel bar at the same edge.
     Restored when edit mode ends or the screen unmounts. */
  const { setHidden: setFooterHidden } = useClientFooter()
  useEffect(() => {
    setFooterHidden(editMode)
    return () => setFooterHidden(false)
  }, [editMode, setFooterHidden])

  /* ── Data load (also used by save's refresh) ─────────────────────── */
  const loadData = useCallback(async () => {
    if (!project_id) return
    setLoading(true)

    const [
      { data: projData,     error: projErr },
      { data: ciData,       error: ciErr },
      { data: contactsData, error: contactsErr },
    ] = await Promise.all([
      supabase.from('projects')
        /* EXACTLY what this screen renders — the project name and the
           stage — and nothing else.

           The stage name comes from the LUT through stage_id, never from
           the denormalised current_stage column, which drifts. RLS on
           `stages` grants SELECT to any authenticated user, so the embed
           resolves for a client session.

           This list used to also carry type, status, location, notes,
           urgency and intake_date. None of them were ever read, and four
           of them (type, status, location, notes) do not exist on
           Production at all — so PostgREST rejected the WHOLE request
           with 42703 and this screen rendered an empty header to every
           production client from the day it shipped. Keep this list to
           what the component actually uses. */
        .select('name, stages!stage_id(name)')
        .eq('id', project_id)
        .maybeSingle(),
      supabase.from('client_info')
        .select('*')
        .eq('project_id', project_id)
        .maybeSingle(),
      supabase.from('project_contacts')
        .select('id, first_name, last_name, id_number, phone, email')
        .eq('project_id', project_id)
        .order('id'),
    ])

    if (!isMounted.current) return

    /* Surface a failed load instead of rendering it as "no data".
       Discarding these three `error`s is what let a hard 400 look
       exactly like a project with nothing filled in. Any of the three
       failing is treated as fatal for the screen: a partial render here
       would put the client back in the same position of not being able
       to tell missing data from a broken fetch. */
    const loadErr = projErr || ciErr || contactsErr
    if (loadErr) {
      console.error('ClientFile load failed:', { projErr, ciErr, contactsErr })
      logError('file', 'load_failed', logCtx, {
        message: loadErr.message,
        code:    loadErr.code,
      })
      setLoadError(true)
      setLoading(false)
      return
    }

    setLoadError(false)
    setProject(projData || null)
    setClientInfo(ciData || null)
    setContacts(Array.isArray(contactsData) ? contactsData : [])

    /* Stage 2 — professionals lookup (only thing left, since the
       "אחראית פרויקט" card was removed). */
    const profIds = []
    if (ciData) {
      for (const r of PROFESSIONAL_ROLES) {
        const id = ciData[`${r.key}_id`]
        if (id) profIds.push(id)
      }
    }

    let profsResult = null
    if (profIds.length > 0) {
      const { data } = await supabase.from('professionals')
        .select('id, first_name, last_name')
        .in('id', profIds)
      profsResult = data || []
    }
    if (!isMounted.current) return

    /* Reset so stale lookups from previous projects don't bleed through. */
    setProfById({})
    if (profsResult) {
      const map = {}
      for (const p of profsResult) map[p.id] = fullName(p.first_name, p.last_name)
      setProfById(map)
    }
    setLoading(false)
  }, [project_id])

  useEffect(() => { loadData() }, [loadData])

  /* ── Edit-mode handlers ──────────────────────────────────────────── */
  const handleEnterEdit = () => {
    /* Snapshot the contacts into a controlled-input-safe draft. */
    const cd = contacts.map(c => ({
      id:         c.id,
      first_name: c.first_name ?? '',
      last_name:  c.last_name  ?? '',
      id_number:  c.id_number  ?? '',
      phone:      c.phone      ?? '',
      email:      c.email      ?? '',
    }))
    setContactsDraft(cd)

    setSaveError('')
    setSavedFlash(false)
    setEditMode(true)
  }

  const handleCancel = () => {
    if (saving) return
    setEditMode(false)
    setSaveError('')
    setContactsDraft([])
  }

  /* Open/close a block. Collapsing 'personal' while editing exits edit
     mode (without saving) so the user isn't stuck in a hidden form. */
  const toggleOpen = (key) => {
    const wasOpen = openSet.has(key)
    if (wasOpen && key === 'personal' && editMode) {
      handleCancel()
    }
    setOpenSet(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /* Keyboard accessibility for the div-based accordion header. */
  const handleHeaderKeyDown = (e, key) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleOpen(key)
    }
  }

  const updateContactDraft = (idx, field, value) => {
    setContactsDraft(prev => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)))
  }

  const handleSave = async () => {
    if (saving) return
    setSaveError('')
    setSaving(true)

    try {
      const updates = []

      /* ── project_contacts patches — one per modified row, matched by id ──
         The loop over CONTACT_FIELDS picks up id_number automatically. */
      for (let i = 0; i < contactsDraft.length; i++) {
        const draft = contactsDraft[i]
        if (!draft?.id) continue
        const orig = contacts.find(c => c.id === draft.id)
        if (!orig) continue

        const cPatch = {}
        for (const f of CONTACT_FIELDS) {
          const newVal = normalizeForDb(draft[f.field])
          const oldVal = normalizeForDb(orig[f.field])
          if (newVal !== oldVal) cPatch[f.field] = newVal
        }
        if (Object.keys(cPatch).length > 0) {
          updates.push(
            supabase.from('project_contacts').update(cPatch).eq('id', draft.id)
          )
        }
      }

      if (updates.length === 0) {
        /* No contacts changed — exit edit mode silently with a quick flash. */
        if (!isMounted.current) return
        setEditMode(false)
        setSavedFlash(true)
        setTimeout(() => isMounted.current && setSavedFlash(false), 2000)
        setSaving(false)
        return
      }

      const results = await Promise.all(updates)
      const errors  = results.filter(r => r.error)
      /* Every failure being a preview-guard block means this is the
         admin's read-only "תצוגת לקוח" — leave edit mode quietly, with
         no red banner and no "נשמר" flash (nothing was saved). Mixed
         or other errors still fall through to the real error path. */
      if (errors.length > 0 && errors.every(r => isPreviewBlockedError(r.error))) {
        if (!isMounted.current) return
        setEditMode(false)
        setContactsDraft([])
        setSaving(false)
        return
      }
      if (errors.length > 0) {
        console.error('client save errors:', errors.map(r => r.error))
        throw new Error('save failed')
      }

      /* Refetch so the view-mode rows reflect what's actually in the DB. */
      await loadData()
      if (!isMounted.current) return
      setEditMode(false)
      setContactsDraft([])
      setSavedFlash(true)
      setTimeout(() => isMounted.current && setSavedFlash(false), 2000)
    } catch (e) {
      console.error('client save error:', e)
      if (isMounted.current) setSaveError('לא הצלחנו לשמור, נסה שוב')
      logError('file', 'save_failed', logCtx)
    }
    if (isMounted.current) setSaving(false)
  }

  /* ── Loading state ───────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="cp-loading"><p>טוען...</p></div>
    )
  }

  /* ── Failed load ─────────────────────────────────────────────────
     Deliberately NOT an empty page. The client has to be able to tell
     "we couldn't fetch this" from "there's nothing here yet". */
  if (loadError) {
    return (
      <div className="cp-page">
        <div className="cp-container">
          <div className="cp-save-error" role="alert">
            לא הצלחנו לטעון את פרטי התיק. נסו לרענן את הדף, ואם התקלה חוזרת — פנו אלינו.
          </div>
        </div>
      </div>
    )
  }

  /* ── Render helpers ──────────────────────────────────────────────── */
  /* renderClientInfoFields: always read-only display, skipping empties.
     (No edit-mode branch — pertaining cards are no longer editable.) */
  const renderClientInfoFields = (fields) => {
    const rows = []
    for (const f of fields) {
      const v = clean(clientInfo?.[f.field])
      if (v == null) continue
      rows.push(
        <div key={f.field} className="cp-row">
          <span className="cp-label">{f.label}:</span>
          <span className={`cp-value${f.multiline ? ' cp-value--multiline' : ''}`}>{v}</span>
        </div>
      )
    }
    return rows
  }

  const projectName = clean(project?.name) || 'פרויקט'
  /* Header subtitle — the stage, prefixed with "שלב הפרויקט:" so the
     client sees an explicit field name. This used to join a
     projects.type segment in front with " · ", but that column is dead:
     null on all 56 Dev rows and absent from Prod entirely, so the
     separator was unreachable and the type segment never rendered. */
  const stageVal = clean(project?.stages?.name)
  const subtitle = stageVal ? `שלב הפרויקט: ${stageVal}` : ''

  const detailRows    = renderClientInfoFields(PROJECT_DETAIL_FIELDS)

  /* "דרוש טיפול" — same primitive src/lib/actionRequired.js uses for the
     home-screen "פרטי תיק" tile badge, computed here directly from the
     already-loaded `contacts` (no redundant fetch), same pattern the
     questionnaire hub's own tile dots use. */
  const contactsNeedAttention = computeContactsActionRequired(contacts).total > 0

  /* Professionals — ALWAYS read-only (also in edit mode).
     Dynamic key lookups off clientInfo are guarded with hasOwnProperty
     because role.key === 'constructor' would otherwise fall through to
     Object.prototype.constructor and render "function Object() { [native code] }". */
  const professionalsRows = []
  for (const role of PROFESSIONAL_ROLES) {
    const idKey    = `${role.key}_id`
    const phoneKey = `${role.key}_phone`
    const id       = clientInfo && Object.prototype.hasOwnProperty.call(clientInfo, idKey)    ? clientInfo[idKey]    : null
    const legacy   = clean(clientInfo && Object.prototype.hasOwnProperty.call(clientInfo, role.key) ? clientInfo[role.key] : null)
    const lookedUp = id ? profById[id] : null
    const name     = lookedUp || legacy
    if (!name) continue
    const phone = clean(clientInfo && Object.prototype.hasOwnProperty.call(clientInfo, phoneKey) ? clientInfo[phoneKey] : null)
    professionalsRows.push(
      <div key={role.key} className="cp-row">
        <span className="cp-label">{role.label}:</span>
        <span className="cp-value">
          {name}
          {phone && <> · <span dir="ltr">{phone}</span></>}
        </span>
      </div>
    )
  }

  return (
    <div className={`cp-page${editMode ? ' cp-page--editing' : ''}`}>
      <div className="cp-container">

        {/* Error banner — shown at top when a save attempt failed. */}
        {saveError && (
          <div className="cp-save-error" role="alert">{saveError}</div>
        )}

        {/* Page header — project name + subtitle. The edit button lives
            inside the "פרטים אישיים" card (the only editable card). */}
        <header className="cp-header">
          <h1 className="cp-project-name">{projectName}</h1>
          {subtitle && <p className="cp-project-subtitle">{subtitle}</p>}
        </header>

        {/* Accordion — three collapsible blocks. The pencil edit affordance
            replaces the old "ערוך" button and only appears in the open
            "פרטים אישיים" header. Clicking the header toggles open/closed;
            clicking the pencil enters edit mode (and does NOT toggle, via
            stopPropagation). */}
        <div className="cp-progress-accordion">

          {/* Block 1 — פרטים אישיים (THE ONLY editable block; open by default). */}
          {(() => {
            const isOpen = openSet.has('personal')
            return (
              <section className="cp-progress-block">
                <div
                  className="cp-progress-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggleOpen('personal')}
                  onKeyDown={(e) => handleHeaderKeyDown(e, 'personal')}
                >
                  <span className="cp-progress-header-name">פרטים אישיים</span>
                  {contactsNeedAttention && <ActionRequiredDot />}
                  {isOpen && !editMode && (
                    <button
                      type="button"
                      className="cp-acc-pencil"
                      onClick={(e) => { e.stopPropagation(); handleEnterEdit() }}
                      aria-label="ערוך פרטים אישיים"
                      title="ערוך"
                    >
                      <IconPencil size={16} />
                    </button>
                  )}
                  <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                    <IconChevron size={16} />
                  </span>
                </div>
                {isOpen && (
                  <div className="cp-acc-body">
                    {editMode ? (
                      contactsDraft.length > 0 ? (
                        contactsDraft.map((draft, idx) => (
                          <div key={draft.id ?? idx} className="cp-contact cp-contact--edit">
                            {CONTACT_FIELDS.map(f => (
                              <div key={f.field} className="cp-row cp-row--edit">
                                <span className="cp-label">{f.label}:</span>
                                <input
                                  type="text"
                                  className={`cp-input${f.ltr ? ' cp-input--ltr' : ''}`}
                                  value={draft[f.field] ?? ''}
                                  onChange={e => updateContactDraft(idx, f.field, e.target.value)}
                                  dir={f.ltr ? 'ltr' : undefined}
                                  disabled={saving}
                                />
                              </div>
                            ))}
                          </div>
                        ))
                      ) : (
                        <p className="cp-empty-card">לא הוזנו פרטים אישיים</p>
                      )
                    ) : (
                      contacts.length > 0 ? (
                        contacts.map((c, idx) => {
                          const name     = fullName(c.first_name, c.last_name) || '—'
                          const idNumber = clean(c.id_number)
                          const phone    = clean(c.phone)
                          const email    = clean(c.email)
                          return (
                            <div key={c.id ?? idx} className="cp-contact">
                              <p className="cp-contact-name">{name}</p>
                              {idNumber && (
                                <div className="cp-row">
                                  <span className="cp-label">ת״ז:</span>
                                  <span className="cp-value">{idNumber}</span>
                                </div>
                              )}
                              {phone && <p className="cp-contact-line cp-contact-line--ltr">{phone}</p>}
                              {email && <p className="cp-contact-line cp-contact-line--ltr">{email}</p>}
                            </div>
                          )
                        })
                      ) : (
                        <p className="cp-empty-card">לא הוזנו פרטים אישיים</p>
                      )
                    )}
                  </div>
                )}
              </section>
            )
          })()}

          {/* Block 2 — פרטי מגרש (read-only; no pencil). */}
          {(() => {
            const isOpen = openSet.has('project')
            return (
              <section className="cp-progress-block">
                <div
                  className="cp-progress-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggleOpen('project')}
                  onKeyDown={(e) => handleHeaderKeyDown(e, 'project')}
                >
                  <span className="cp-progress-header-name">פרטי מגרש</span>
                  <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                    <IconChevron size={16} />
                  </span>
                </div>
                {isOpen && (
                  <div className="cp-acc-body">
                    {detailRows.length > 0
                      ? detailRows
                      : <p className="cp-empty-card">אין פרטים זמינים</p>}
                  </div>
                )}
              </section>
            )
          })()}

          {/* Block 3 — בעלי מקצוע (read-only; no pencil). */}
          {(() => {
            const isOpen = openSet.has('professionals')
            return (
              <section className="cp-progress-block">
                <div
                  className="cp-progress-header"
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => toggleOpen('professionals')}
                  onKeyDown={(e) => handleHeaderKeyDown(e, 'professionals')}
                >
                  <span className="cp-progress-header-name">בעלי מקצוע</span>
                  <span className={'cp-progress-chevron' + (isOpen ? ' cp-progress-chevron--open' : '')}>
                    <IconChevron size={16} />
                  </span>
                </div>
                {isOpen && (
                  <div className="cp-acc-body">
                    {professionalsRows.length > 0
                      ? professionalsRows
                      : <p className="cp-empty-card">לא הוזנו בעלי מקצוע</p>}
                  </div>
                )}
              </section>
            )
          })()}

        </div>

      </div>

      {/* Sticky edit bar — only in edit mode. position:fixed escapes the scroll. */}
      {editMode && (
        <div className="cp-edit-bar">
          <button
            type="button"
            className="cp-edit-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'שומר...' : 'שמור'}
          </button>
          <button
            type="button"
            className="cp-edit-btn-secondary"
            onClick={handleCancel}
            disabled={saving}
          >
            ביטול
          </button>
        </div>
      )}

      {/* Brief success indicator — appears after a successful save, fades after 2s. */}
      {savedFlash && (
        <div className="cp-save-success" role="status">✓ נשמר</div>
      )}
    </div>
  )
}
