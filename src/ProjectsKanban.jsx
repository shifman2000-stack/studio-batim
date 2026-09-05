import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { generateUniqueAuthCode } from './lib/generateAuthCode'
import { markProjectAsParent, inheritClientInfoFromParent } from './lib/parentProjectInheritance'
import NewTaskModal from './NewTaskModal'
import ClientPreviewOverlay from './components/ClientPreviewOverlay'
import InlineField from './components/InlineField'
import { ActionRequiredDot } from './components/ActionRequiredBadge'
import { loadAllProjectStreams } from './lib/staffNotifications'
import './ProjectsKanban.css'

/* ── The card's notification dots ──────────────────────────────────────
   The board shows PRESENCE, not quantity: one dot if anything is pending
   in the document stream, a second if anything is pending in the
   questionnaire stream. 0, 1 or 2 dots, never a number.

   Counting continues everywhere below the board — the two tab badges,
   the stage-group badges, the per-row lines and the שאלון פרוגרמה link
   all still carry real counts. A card is a "look here", not a tally.

   Reinstated in the exact slot and dimensions the removed task dots
   occupied (6px, 3px apart, bottom of the card, visual LEFT), so the
   board reads the way it always did. Nothing here touches
   tasksByProject, which stays wired to the two board filters only. */
const NOTIF_DOT_SIZE = 6

function getTextColor(bgHex) {
  if (!bgHex) return '#1a1a18'
  const hex = bgHex.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#1a1a18' : '#ffffff'
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function daysInStage(stage_entered_at) {
  if (!stage_entered_at) return 0
  const entered = new Date(stage_entered_at)
  const today   = new Date()
  entered.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.round((today - entered) / 86400000))
}

const IconArchive = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8"/>
    <rect x="1" y="3" width="22" height="5"/>
    <line x1="10" y1="12" x2="14" y2="12"/>
  </svg>
)

const IconCheck = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
)

const IconFolder = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"
    fill="currentColor" stroke="none">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
)

/* Feather-style floppy-disk save glyph — used by the "הגדרות פרויקט"
   modal footer save button. */
const IconSave = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </svg>
)

/* Feather-style X glyph — used by the "הגדרות פרויקט" modal footer
   cancel button. Caller sets the stroke color (we render it red there). */
const IconX = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

/* Feather-style smartphone glyph — "תצוגת לקוח" button in the "הגדרות
   פרויקט" modal, opens ClientPreviewOverlay. */
const IconSmartphone = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
    <line x1="12" y1="18" x2="12.01" y2="18"/>
  </svg>
)

/* Feather-style copy glyph — the small affordance beside anything the
   "הגדרות פרויקט" modal offers to copy (auth code, links). Deliberately
   an icon rather than a labelled button: several of them sit in one
   short column and full buttons crowded it. */
const IconCopy = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
)

/* The existing IconCheck above doubles as the "copied" tick. */

function formatDate(iso) {
  if (!iso) return ''
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function ProjectsKanban() {
  const [projects, setProjects]             = useState([])
  const [stages, setStages]                 = useState([])
  const [userRole, setUserRole]             = useState(null)
  const [currentUserName, setCurrentUserName] = useState('')
  const [users, setUsers]                   = useState([])
  const [showModal, setShowModal]           = useState(false)
  const [newName, setNewName]               = useState('')
  const [newResponsible, setNewResponsible] = useState('')
  const [adding, setAdding]                 = useState(false)
  const [modalError, setModalError]         = useState('')
  const [dragId, setDragId]                 = useState(null)
  const [contextMenu, setContextMenu]       = useState(null) // { x, y, project }
  const [filterResponsible, setFilterResponsible] = useState('')
  const [tasksByProject, setTasksByProject]       = useState({})
  /* Unread staff notifications per project, as two booleans:
     { [project_id]: { documents, questionnaire } }. Loaded by ONE query
     for the whole board and grouped in memory, exactly like
     tasksByProject above. No per-card query. */
  const [notifsByProject, setNotifsByProject]     = useState({})
  const menuRef                             = useRef(null)

  // Inquiry search state
  const [showInquirySearch, setShowInquirySearch] = useState(false)
  const [inquiryQuery, setInquiryQuery]           = useState('')
  const [inquiries, setInquiries]                 = useState([])
  const [selectedInquiry, setSelectedInquiry]     = useState(null)

  // Archive feature
  const [archiveView, setArchiveView]           = useState(false)
  const [archivedProjects, setArchivedProjects] = useState([])
  const [archiveSearch, setArchiveSearch]       = useState('')
  const [archiveLoading, setArchiveLoading]     = useState(false)
  // Two-step archive confirmation
  const [archiveStep, setArchiveStep]   = useState(0) // 0=none, 1=dialog1, 2=dialog2
  const [archiveTarget, setArchiveTarget] = useState(null) // project to archive

  /* ── Archived-in-hold-column bucket ──
     Separate state for archived (finished) projects surfaced under the
     "השהייה" column as a collapsible bucket. Kept in its own array so
     the main `projects` state stays archived-free (every drag/drop and
     stage-placement filter still works unchanged). The accordion starts
     collapsed on every mount. */
  const [archivedHold,     setArchivedHold]     = useState([])
  const [archiveHoldOpen,  setArchiveHoldOpen]  = useState(false)

  // ── Parent-project feature (2-level hierarchy enforced frontend-only).
  // The Kanban shows only top-level projects (parent_project_id IS NULL).
  // childCounts maps a top-level project id -> number of non-archived children.
  // Drives both the "פרויקט בן" checkbox visibility in the context menu
  // (>0 children → hidden, a parent can't become a child) and the small
  // folder badge on cards that already have children. ──
  const [parentOptions, setParentOptions]   = useState([])
  const [newParentId, setNewParentId]       = useState('')
  const [showParentPicker, setShowParentPicker] = useState(false)
  const [childCounts, setChildCounts]       = useState({})
  const [ctxChildPickerOpen, setCtxChildPickerOpen] = useState(false)
  const [ctxChildPickedId,   setCtxChildPickedId]   = useState('')
  const [parentConfirm, setParentConfirm]   = useState(null) // { mode: 'attach'|'detach', project, parentId?, parentName? }
  /* Welcome-message popup opened from the kanban context menu —
     composes a Hebrew "ברוכים הבאים" message based on the project's
     contacts + auth_code, with a copy-to-clipboard action. */
  const [welcomePopup, setWelcomePopup]     = useState(null) // { message, copied } | null

  /* ── "הגדרות פרויקט" modal ─────────────────────────────────────────
     The right-click context menu is now just two items — "+ פתח משימה
     חדשה" and "הגדרות פרויקט". Picking the latter sets settingsTarget
     to the project the user right-clicked, which opens a Pattern-A
     modal containing every per-project setting that used to live in
     the context menu (rename, favorite, responsible, parent, archive,
     auth code + welcome message) plus the new whatsapp_group_url field.

     Draft/save model — the modal holds a LOCAL DRAFT of the editable
     fields. Typing into an input mutates the draft only; the DB write
     happens ONCE, on שמור, with a single UPDATE that carries only the
     fields that actually changed. ביטול / סגור / overlay-click drop
     the draft. settingsTarget is the original project row (kept around
     for the diff comparison and for read-only fields like auth_code,
     parent_project_id).

     Draft fields = the editable ones:
       name, is_favorite, responsible_id, whatsapp_group_url.

     whatsapp_group_url is null-safe: rows loaded from a not-yet-migrated
     prod don't carry the property, so the seed uses `?? ''` and the
     diff treats missing/null/'' as the same baseline. ── */
  const [settingsTarget, setSettingsTarget] = useState(null) // project | null
  const [settingsDraft,  setSettingsDraft]  = useState(null) // { name, is_favorite, responsible_id, whatsapp_group_url, is_parent_project } | null
  const [settingsSaving, setSettingsSaving] = useState(false)
  // "תצוגת לקוח" — admin-only read-only preview of the client portal for
  // this project, rendered on top of the settings modal (which stays
  // mounted underneath so closing the preview returns to it). See
  // src/components/ClientPreviewOverlay.jsx.
  const [clientPreviewProject, setClientPreviewProject] = useState(null) // project | null
  // Inline warning shown when the admin tries to uncheck "פרויקט אב" on a
  // project that still has real children — see the checkbox's onChange.
  const [settingsError,  setSettingsError]  = useState('')
  // "הועתק" confirmation for the פרויקטי בנים token link's copy button.
  /* Which copyable value most recently flashed its "copied" tick, by
     key ('auth' | 'wa' | 'inquiry'), or null. One shared slot so two
     rows can never both claim success at once. */
  const [settingsCopied, setSettingsCopied] = useState(null)
  /* Models belonging to THIS project's parent — the options for
     "דגם נבחר". Only ever loaded for a child project; an empty list for
     everything else, which is what hides the row. */
  const [settingsModels, setSettingsModels] = useState([])

  // ── Parent-view mode (route /פרויקטים/אב/:parentId).
  // When the URL carries a parentId, this same Kanban renders only the
  // children of that parent. parentProject holds { id, name } of the URL's
  // parent (for the header title + back link). parentProjectsList is every
  // top-level project that has at least one child, populated by
  // loadChildCounts — used by the parent-view dropdown switcher and by the
  // "תצוגת פרויקטי אב" toolbar button on the normal board. ──
  const [parentProject,       setParentProject]       = useState(null)
  const [parentProjectsList,  setParentProjectsList]  = useState([])

  const navigate = useNavigate()
  const location = useLocation()
  const { parentId } = useParams()    // present only on /פרויקטים/אב/:parentId

  // On mount or navigation: open archive view if requested, otherwise exit it
  useEffect(() => {
    if (location.state?.showArchive) {
      openArchiveView()
    } else if (archiveView) {
      setArchiveView(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // Archive toast
  const [archiveToast, setArchiveToast]   = useState('')
  const showArchiveToast = (msg) => {
    setArchiveToast(msg)
    setTimeout(() => setArchiveToast(''), 2800)
  }

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, first_name, last_name')
        .eq('id', session.user.id)
        .single()
      if (profile) {
        setUserRole(profile.role)
        setCurrentUserName([profile.first_name, profile.last_name].filter(Boolean).join(' '))
      }

      const { data: stagesData } = await supabase
        .from('stages').select('*').eq('is_active', true).order('order_index')
      if (stagesData) setStages(stagesData)

      let projectsQuery = supabase
        .from('projects')
        .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
        .eq('archived', false)
      projectsQuery = parentId
        ? projectsQuery.eq('parent_project_id', parentId)
        : projectsQuery.is('parent_project_id', null)
      const { data: projectsData } = await projectsQuery
        .order('created_at', { ascending: false })
      await loadChildCounts()
      if (parentId) {
        const { data: parentRow } = await supabase
          .from('projects')
          .select('id, name')
          .eq('id', parentId)
          .single()
        setParentProject(parentRow || null)
      } else {
        setParentProject(null)
      }
      if (projectsData) {
        const today = todayISO()
        const nullIds = projectsData.filter(p => !p.stage_entered_at).map(p => p.id)
        if (nullIds.length > 0) {
          await supabase.from('projects').update({ stage_entered_at: today }).in('id', nullIds)
          projectsData.forEach(p => { if (!p.stage_entered_at) p.stage_entered_at = today })
        }
        setProjects(projectsData)
      }

      /* Also load archived projects at this hierarchy level for the
         "השהייה" column's archive bucket. Kept in a separate state
         so the main `projects` array stays archived-free. */
      await fetchArchivedHold()

      const { data: usersData } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('role', ['admin', 'employee'])
        .order('first_name')
      if (usersData) setUsers(usersData)

      const { data: tasksData } = await supabase
        .from('tasks')
        .select('project_id, status_id')
        .neq('status_id', 3)
      if (tasksData) {
        const grouped = {}
        tasksData.forEach(t => {
          if (!t.project_id) return
          if (!grouped[t.project_id]) grouped[t.project_id] = []
          grouped[t.project_id].push(t.status_id)
        })
        setTasksByProject(grouped)
      }

      /* One query for the whole board, same shape as the tasks query
         above. Counts BOTH streams — a questionnaire notification shows
         in this total even though the place to click through to it does
         not exist yet (that is step 3). Expected and temporary; do not
         filter it out here. */
      setNotifsByProject(await loadAllProjectStreams())
    }
    init()
  }, [parentId])

  useEffect(() => {
    if (!contextMenu) return
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu])

  const fetchProjects = async () => {
    let q = supabase
      .from('projects')
      .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
      .eq('archived', false)
    q = parentId
      ? q.eq('parent_project_id', parentId)
      : q.is('parent_project_id', null)
    const { data, error } = await q.order('created_at', { ascending: false })
    if (!error && data) setProjects(data)
    await loadChildCounts()
    await fetchArchivedHold()
  }

  /* Fetch archived projects at the SAME hierarchy level the board is
     currently showing (top-level or under the URL parent). Mirrors the
     shape and joins of the main projects query so we can render the
     bucket cards with the same markup. Used exclusively by the "השהייה"
     column's archive accordion — never merged into `projects`. */
  const fetchArchivedHold = async () => {
    let q = supabase
      .from('projects')
      .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
      .eq('archived', true)
    q = parentId
      ? q.eq('parent_project_id', parentId)
      : q.is('parent_project_id', null)
    const { data, error } = await q.order('archived_at', { ascending: false })
    if (!error && data) setArchivedHold(data)
  }

  // ── Archive view fetch ──
  const fetchArchivedProjects = async () => {
    setArchiveLoading(true)
    const { data } = await supabase
      .from('projects')
      .select('id, name, archived_at, client_info(city)')
      .eq('archived', true)
      .order('archived_at', { ascending: false })
    setArchivedProjects(data || [])
    setArchiveLoading(false)
  }

  const openArchiveView = () => {
    setArchiveView(true)
    setArchiveSearch('')
    fetchArchivedProjects()
  }

  const closeArchiveView = () => {
    setArchiveView(false)
    setArchivedProjects([])
    setArchiveSearch('')
  }

  // ── Restore archived project ──
  const handleRestoreProject = async (projectId) => {
    const target = archivedProjects.find(p => p.id === projectId)
    const { error } = await supabase
      .from('projects')
      .update({ archived: false, archived_at: null })
      .eq('id', projectId)
    if (!error) {
      setArchivedProjects(prev => prev.filter(p => p.id !== projectId))
      const { data: restored } = await supabase
        .from('projects')
        .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
        .eq('id', projectId)
        .single()
      if (restored) setProjects(prev => [restored, ...prev])
      /* Keep the "השהייה" archive bucket in sync — the restored row
         must not appear in both the bucket and the main columns. */
      setArchivedHold(prev => prev.filter(p => p.id !== projectId))
      showArchiveToast(`הפרויקט "${target?.name ?? ''}" שוחזר בהצלחה`)
    }
  }

  // ── Two-step archive flow ──
  const startArchiveFlow = (project) => {
    setArchiveTarget(project)
    setContextMenu(null)
    /* Close the settings modal too — the archive confirm dialogs
       overlay everything, and once the project is archived it leaves
       the kanban view entirely, so there's nothing for the settings
       modal to point at anymore. Cancel just drops you back to the
       kanban. Draft is dropped along with the modal. */
    setSettingsTarget(null)
    setSettingsDraft(null)
    setArchiveStep(1)
  }

  const handleArchiveStep1Confirm = () => setArchiveStep(2)
  const handleArchiveCancel = () => { setArchiveStep(0); setArchiveTarget(null) }

  const handleArchiveStep2Confirm = async () => {
    if (!archiveTarget) return
    const projectId = archiveTarget.id
    const projectName = archiveTarget.name
    setArchiveStep(0)
    setArchiveTarget(null)
    await supabase.from('tasks').delete().eq('project_id', projectId)
    await supabase.from('projects').update({ archived: true, archived_at: new Date().toISOString() }).eq('id', projectId)
    setProjects(prev => prev.filter(p => p.id !== projectId))
    /* Refresh the "השהייה" column's archive bucket so the freshly
       archived project appears there without needing a page reload. */
    await fetchArchivedHold()
    showArchiveToast(`הפרויקט "${projectName}" הועבר לארכיון בהצלחה`)
  }

  const openModal = () => {
    setNewName(''); setNewResponsible(''); setModalError('')
    setShowInquirySearch(false); setInquiryQuery(''); setInquiries([])
    setSelectedInquiry(null)
    // In parent view the parent is fixed by the URL — no manual picker.
    if (parentId) {
      setNewParentId(parentId)
      setShowParentPicker(false)
    } else {
      setNewParentId(''); setShowParentPicker(false)
      loadParentOptions()
    }
    setShowModal(true)
  }

  const handleAddProject = async () => {
    if (!newName.trim()) { setModalError('יש להזין שם פרויקט'); return }
    setAdding(true); setModalError('')
    const firstStageId = stages.find(s => s.name === 'קליטת פרויקט')?.id ?? stages[0]?.id ?? null
    const isChild    = !!newParentId
    const parentName = isChild ? (parentOptions.find(p => p.id === newParentId)?.name || '') : ''

    /* Generate the project's auth code (BATIM####). A null result —
       from a network error or 15 collisions in a row — must not block
       creation; the column allows null and can be back-filled later. */
    let authCode = null
    try {
      authCode = await generateUniqueAuthCode(supabase)
    } catch (e) {
      console.warn('handleAddProject — auth code generation failed:', e)
    }

    const { data, error } = await supabase.from('projects')
      .insert([{
        name: newName.trim(),
        responsible_id: newResponsible || null,
        current_stage: 'קליטת פרויקט',
        stage_id: firstStageId,
        stage_entered_at: todayISO(),
        archived: false,
        parent_project_id: newParentId || null,
        urgency: 'רגיל',
        auth_code: authCode,
      }])
      .select().single()
    setAdding(false)
    if (error) { setModalError(`שגיאה: ${error.message}`); return }
    if (!data) return

    /* Preserve the existing "assign a parent when creating a child"
       workflow: flag the chosen parent as is_parent_project so it keeps
       showing up as a parent everywhere that now reads the flag, without
       requiring the admin to separately tick the checkbox on it. */
    if (isChild) {
      await markProjectAsParent(newParentId)
    }

    const { data: fullProject } = await supabase
      .from('projects')
      .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name, color)')
      .eq('id', data.id)
      .single()
    const projectToAdd = fullProject || data

    if (selectedInquiry) {
      const inq = selectedInquiry
      const coupled = splitCoupledFirstName(inq.first_name ?? '')
      const mainContacts = coupled
        ? [
            { project_id: data.id, first_name: coupled.part1, last_name: inq.last_name ?? null, phone: inq.phone ?? null, email: null },
            { project_id: data.id, first_name: coupled.part2, last_name: inq.last_name ?? null, phone: null, email: null },
          ]
        : [{ project_id: data.id, first_name: inq.first_name ?? null, last_name: inq.last_name ?? null, phone: inq.phone ?? null, email: null }]
      const contactRows = [
        ...mainContacts,
        ...((Array.isArray(inq.additional_contacts) ? inq.additional_contacts : [])
          .filter(c => c.first_name || c.last_name || c.phone)
          .map(c => ({ project_id: data.id, first_name: c.first_name ?? null, last_name: c.last_name ?? null, phone: c.phone ?? null, email: null }))
        ),
      ]
      await supabase.from('project_contacts').insert(contactRows)
      await supabase.from('client_info').insert([{ project_id: data.id, city: inq.city ?? null }])
      await supabase.from('inquiries').update({ converted_to_project: true }).eq('id', inq.id)
      if (!isChild) setProjects(prev => [projectToAdd, ...prev])
      else if (parentId) setProjects(prev => [projectToAdd, ...prev])  /* parent view: child belongs here */
      setShowModal(false)
      if (isChild) {
        await loadChildCounts()
        if (!parentId) showArchiveToast(`הפרויקט נוצר כבן של "${parentName}"`)
      } else {
        navigate('/פרויקטים')
      }
    } else {
      if (!isChild) setProjects(prev => [projectToAdd, ...prev])
      else if (parentId) setProjects(prev => [projectToAdd, ...prev])  /* parent view: child belongs here */
      setShowModal(false)
      if (isChild) {
        await loadChildCounts()
        if (!parentId) showArchiveToast(`הפרויקט נוצר כבן של "${parentName}"`)
      }
    }

    /* One-time client_info field inheritance from the chosen parent.
       Placed after both branches above (rather than right after the
       parent_project_id insert) so it runs AFTER the selectedInquiry
       branch's own client_info insert — otherwise this would race that
       insert and hit the project_id unique constraint. */
    if (isChild) {
      await inheritClientInfoFromParent(newParentId, data.id)
    }
  }

  function splitCoupledFirstName(firstName) {
    if (!firstName) return null
    const words = firstName.trim().split(/\s+/)
    const connIdx = words.findIndex(w => w.length > 1 && w[0] === 'ו')
    if (connIdx === -1) return null
    const part1 = words.slice(0, connIdx).join(' ')
    if (!part1) return null
    const afterWords = [...words.slice(connIdx)]
    afterWords[0] = afterWords[0].slice(1)
    const part2 = afterWords.join(' ')
    if (!part2) return null
    return { part1, part2 }
  }

  const loadInquiries = async () => {
    const { data } = await supabase
      .from('inquiries')
      .select('id, first_name, last_name, phone, city, additional_contacts')
      .eq('converted_to_project', false)
      .order('date', { ascending: false })
    setInquiries(data ?? [])
  }

  // ── Parent-project helpers ─────────────────────────────────────────
  // loadParentOptions: top-level non-archived projects, for the "pick a
  // parent" dropdowns. Shared by the new-project modal and the context-menu
  // attach flow. ──
  const loadParentOptions = async () => {
    const { data } = await supabase
      .from('projects')
      .select('id, name')
      .eq('archived', false)
      .is('parent_project_id', null)
      .order('name', { ascending: true })
    setParentOptions(data || [])
  }

  // loadChildCounts: map of top-level project id -> number of non-archived
  // children, used ONLY for the real folder-badge counts on parent cards
  // (childCounts[id] still reflects actual live children — this number
  // can't come from a boolean flag). As a side-effect also rebuilds
  // parentProjectsList — { id, name } of every project flagged
  // is_parent_project=true — feeding the parent-view header dropdown and
  // the "תצוגת פרויקטי אב" toolbar button. A flagged project with zero
  // children still appears here on purpose (item 4 of the parent-flag
  // change: a project can be marked as a parent ahead of having children).
  const loadChildCounts = async () => {
    const { data } = await supabase
      .from('projects')
      .select('parent_project_id')
      .eq('archived', false)
      .not('parent_project_id', 'is', null)
    const counts = {}
    for (const row of data || []) {
      const pid = row.parent_project_id
      if (!pid) continue
      counts[pid] = (counts[pid] || 0) + 1
    }
    setChildCounts(counts)

    const { data: parents } = await supabase
      .from('projects')
      .select('id, name')
      .eq('is_parent_project', true)
      .eq('archived', false)
      .order('name', { ascending: true })
    setParentProjectsList(parents || [])
  }

  const handleParentConfirm = async () => {
    if (!parentConfirm) return
    const { mode, project, parentId } = parentConfirm
    const nextParent = mode === 'attach' ? parentId : null
    await supabase.from('projects').update({ parent_project_id: nextParent }).eq('id', project.id)
    /* Same auto-flag as handleAddProject: attaching to an existing
       project as its child marks that project is_parent_project, so the
       existing "pick a parent" flow keeps working without a separate
       manual checkbox step. */
    if (mode === 'attach') {
      await markProjectAsParent(parentId)
      await inheritClientInfoFromParent(parentId, project.id)
    }
    setParentConfirm(null)
    setCtxChildPickerOpen(false)
    setCtxChildPickedId('')
    setContextMenu(null)
    /* Same reasoning as startArchiveFlow — once the parent flips, the
       project either disappears from the top-level board or jumps to
       a different parent view, so the settings modal pointing at the
       old row no longer makes sense. Draft is dropped along with the
       modal. */
    setSettingsTarget(null)
    setSettingsDraft(null)
    await fetchProjects()
  }

  /* ── Welcome-message composer ─────────────────────────────────────
     Triggered from the context menu. Fetches the project's contacts on
     demand (the kanban fetch doesn't join project_contacts), composes
     a Hebrew "ברוכים הבאים" message that includes the per-contact
     emails + the project's auth_code, and opens a popup with a copy
     button. ── */
  const handleOpenWelcomeMessage = async () => {
    if (!settingsTarget) return
    const projectId = settingsTarget.id
    const authCode  = settingsTarget.auth_code
    /* The welcome popup overlays the settings modal (both use
       .modal-overlay). We INTENTIONALLY keep settingsTarget open so
       that closing the welcome popup drops the user back into the
       settings modal — no need to right-click and re-enter. */

    let contacts = []
    try {
      const { data } = await supabase
        .from('project_contacts')
        .select('first_name, last_name, email')
        .eq('project_id', projectId)
        .order('id')
      contacts = Array.isArray(data) ? data : []
    } catch (e) {
      console.warn('handleOpenWelcomeMessage — contacts fetch failed:', e)
    }

    /* lastName: first contact with a non-empty trimmed last_name. */
    let lastName = null
    for (const c of contacts) {
      const ln = (c.last_name ?? '').trim()
      if (ln) { lastName = ln; break }
    }

    /* Distinct emails, lower-cased for the dedupe key, original case
       preserved for display. first_name kept alongside for the
       multi-contact phrasing. */
    const emailMap = new Map()
    for (const c of contacts) {
      const e = (c.email ?? '').trim()
      if (!e) continue
      const key = e.toLowerCase()
      if (!emailMap.has(key)) {
        emailMap.set(key, {
          first_name: (c.first_name ?? '').trim(),
          email:      e,
        })
      }
    }
    const distinctEntries = Array.from(emailMap.values())

    let emailsBlock
    if (distinctEntries.length === 0) {
      emailsBlock = 'חשוב: ההתחברות חייבת להיות עם המייל הרשום אצלנו.'
    } else if (distinctEntries.length === 1) {
      emailsBlock = `חשוב: ההתחברות חייבת להיות עם המייל הרשום אצלנו: ${distinctEntries[0].email}`
    } else {
      const lines = distinctEntries
        .map(e => `${e.first_name || '—'} — ${e.email}`)
        .join('\n')
      emailsBlock = `חשוב: ההתחברות חייבת להיות עם המייל הרשום אצלנו, כל אחד עם המייל שלו:\n${lines}`
    }

    const titleLine = lastName
      ? `ברוכים הבאים משפחת ${lastName} 🏠`
      : 'ברוכים הבאים 🏠'

    const message = `${titleLine}

שמחה לפתוח עבורכם את המרחב האישי שלכם בסטודיו בתים — מקום אחד שבו תוכלו לעקוב אחר התקדמות הפרויקט, לצפות במסמכים ולשתף איתנו קבצים.

הכניסה למרחב היא דרך האתר שלנו:
https://batim-es.com/
דרך כפתור "כניסת משתמשים"

${emailsBlock}

ההמלצה שלנו היא להתחבר עם חשבון Google (הכי פשוט ומאובטח).

אם המייל שלכם אינו חשבון Google, ניתן להירשם עם המייל הזה וסיסמה שתבחרו, באמצעות קוד ההרשאה:
${authCode || '—'}

אשמח לעמוד לרשותכם בכל שאלה 🤍
עינב | סטודיו בתים`

    setWelcomePopup({ message, copied: false })
  }

  const handleCopyWelcomeMessage = async () => {
    if (!welcomePopup) return
    try {
      await navigator.clipboard.writeText(welcomePopup.message)
      setWelcomePopup(prev => prev ? { ...prev, copied: true } : null)
      setTimeout(() => {
        setWelcomePopup(prev => prev ? { ...prev, copied: false } : null)
      }, 2000)
    } catch (e) {
      console.warn('handleCopyWelcomeMessage — clipboard failed:', e)
    }
  }

  const selectInquiry = (inq) => {
    const fullName = [inq.first_name, inq.last_name].filter(Boolean).join(' ')
    setNewName(fullName)
    setSelectedInquiry(inq)
    setShowInquirySearch(false)
    setInquiryQuery('')
  }

  const handleCardRightClick = (e, project) => {
    if (!isAdmin) return
    e.preventDefault()
    /* Two-item menu now → height shrank from ~300px to ~120px. The
       boundary check uses the smaller value so the menu still opens
       in the right quadrant near a viewport edge. */
    const menuW = 180, menuH = 120
    const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
    setContextMenu({ x, y, project })
  }

  /* Open the per-project settings modal. Seeds the local DRAFT from
     the project's current values (so cancelling has somewhere to
     revert to), pre-warms the parent-options dropdown so it's ready
     when the user ticks "פרויקט בן", and closes the context menu in
     the same gesture. The parent-picker UI flags
     (ctxChildPickerOpen / ctxChildPickedId) are NOT part of the draft —
     parent change has its own two-step confirm flow. */
  const openSettings = (project) => {
    setSettingsTarget(project)
    setSettingsDraft({
      name:                          project.name               || '',
      is_favorite:                   !!project.is_favorite,
      responsible_id:                project.responsible_id     || '',
      whatsapp_group_url:            project.whatsapp_group_url ?? '',   // null-safe for not-yet-migrated prod
      /* Per-project override: whether the client sees the programming
         questionnaire tile in the portal. Same null-safety pattern —
         a row without the column reads as undefined and normalises to
         false so the modal shows an unchecked box on unmigrated rows. */
      show_programming_questionnaire: project.show_programming_questionnaire === true,
      is_parent_project:              project.is_parent_project === true,
      /* Same column ProjectDetail's "פרטי דגם" writes. Drafted here so
         it saves through this modal's own save/cancel like every other
         field, rather than writing the instant the select changes. */
      selected_model_id:              project.selected_model_id || '',
    })
    setSettingsError('')
    /* Model options come from the PARENT's catalogue — a child picks one
       of its parent's models. Same query ProjectDetail uses. */
    setSettingsModels([])
    if (project.parent_project_id) {
      supabase
        .from('project_models')
        .select('id, name')
        .eq('project_id', project.parent_project_id)
        .order('created_at', { ascending: true })
        .then(({ data }) => setSettingsModels(data || []))
    }
    setCtxChildPickerOpen(false)
    setCtxChildPickedId('')
    setContextMenu(null)
    /* Pre-warm the parent-options dropdown only when the "הפוך לפרויקט
       בן" attach flow could actually be used from this modal: the
       project isn't already someone's child, and it isn't itself
       flagged as a parent (attaching a flagged parent as a child would
       recreate the 3-level nesting the app doesn't support). */
    if (!parentId && !project.parent_project_id && !project.is_parent_project) {
      loadParentOptions()
    }
  }

  /* ── Settings-modal: save / cancel ────────────────────────────────
     handleSettingsSave diffs settingsDraft against the original
     settingsTarget row and runs ONE supabase UPDATE with only the
     columns that actually changed. Empty strings on nullable columns
     (responsible_id, whatsapp_group_url) become NULL so the column
     doesn't fill with junk. After the write we patch the local
     `projects` array so the kanban card refreshes; the modal closes
     unconditionally on success (and on no-change).

     handleSettingsCancel drops the draft and closes the modal — no
     DB write, no local-state mutation. Same handler is wired to the
     ביטול and סגור buttons and to the overlay-click. ── */

  const handleSettingsSave = async () => {
    if (!settingsTarget || !settingsDraft || settingsSaving) return

    const patch = {}

    /* name — trim. Blank reverts to original (no-op); unchanged also no-op. */
    const nameTrim = settingsDraft.name.trim()
    const nameOrig = settingsTarget.name || ''
    if (nameTrim && nameTrim !== nameOrig) patch.name = nameTrim

    /* is_favorite — boolean diff. */
    if (settingsDraft.is_favorite !== !!settingsTarget.is_favorite) {
      patch.is_favorite = settingsDraft.is_favorite
    }

    /* responsible_id — empty → null. Compare normalised. */
    const respDraft = settingsDraft.responsible_id || null
    const respOrig  = settingsTarget.responsible_id || null
    if (respDraft !== respOrig) patch.responsible_id = respDraft

    /* whatsapp_group_url — trim, empty → null. Original may be
       null/undefined/'' on prod-loaded rows; the baseline normalises
       all three to '' so a not-yet-set row stays untouched on save. */
    const waDraft = (settingsDraft.whatsapp_group_url || '').trim() || null
    const waOrig  = ((settingsTarget.whatsapp_group_url ?? '') || '').trim() || null
    if (waDraft !== waOrig) patch.whatsapp_group_url = waDraft

    /* show_programming_questionnaire — boolean diff. Undefined on the
       original (unmigrated row) normalises to false so the checkbox
       reflects "no override yet"; only patch when the draft actually
       differs from that baseline. */
    const spqDraft = !!settingsDraft.show_programming_questionnaire
    const spqOrig  = settingsTarget.show_programming_questionnaire === true
    if (spqDraft !== spqOrig) patch.show_programming_questionnaire = spqDraft

    /* is_parent_project — boolean diff. The checkbox's own onChange
       already refuses to draft an uncheck while real children exist
       (see the JSX below), so no re-check is needed here. */
    const parentFlagDraft = !!settingsDraft.is_parent_project
    const parentFlagOrig  = settingsTarget.is_parent_project === true
    if (parentFlagDraft !== parentFlagOrig) patch.is_parent_project = parentFlagDraft

    /* selected_model_id — empty → null, exactly as ProjectDetail's
       saveSelectedModel normalises it, so the two places can never
       write the column differently. */
    const modelDraft = settingsDraft.selected_model_id || null
    const modelOrig  = settingsTarget.selected_model_id || null
    if (modelDraft !== modelOrig) patch.selected_model_id = modelDraft

    /* No-op shortcut. */
    if (Object.keys(patch).length === 0) {
      setSettingsTarget(null)
      setSettingsDraft(null)
      return
    }

    setSettingsSaving(true)
    await supabase.from('projects').update(patch).eq('id', settingsTarget.id)

    /* Turning "חשוף שאלון פרוגרמה ללקוח" ON creates the project's
       programming_questionnaires row right now, instead of leaving it
       to be auto-created the first time the client happens to open the
       hub screen. Guarded on a SELECT first so re-toggling off/on (or a
       row that already exists from before this change) never creates a
       duplicate. Best-effort — a failure here just means the row gets
       created lazily by ClientProgrammingQuestionnaire's own fallback
       the next time an admin edits it via the meeting-embedded view;
       it must not block the settings save. */
    if (patch.show_programming_questionnaire === true) {
      try {
        const { data: existingQ } = await supabase
          .from('programming_questionnaires')
          .select('id')
          .eq('project_id', settingsTarget.id)
          .maybeSingle()
        if (!existingQ) {
          const { error: qErr } = await supabase
            .from('programming_questionnaires')
            .insert({ project_id: settingsTarget.id, answers: {} })
          if (qErr) console.warn('programming_questionnaires row creation failed:', qErr)
        }
      } catch (e) {
        console.warn('programming_questionnaires row creation failed:', e)
      }
    }

    /* Local-state patch carries the joined profiles row if the
       responsible changed — same shape the kanban list uses. */
    const localPatch = { ...patch }
    if ('responsible_id' in patch) {
      const user = users.find(u => u.id === patch.responsible_id)
      localPatch.profiles = user ? { first_name: user.first_name } : null
    }
    setProjects(prev => prev.map(p => p.id === settingsTarget.id ? { ...p, ...localPatch } : p))

    setSettingsSaving(false)
    setSettingsTarget(null)
    setSettingsDraft(null)
  }

  const handleSettingsCancel = () => {
    setSettingsTarget(null)
    setSettingsDraft(null)
    setSettingsError('')
    setSettingsCopied(null)
    setCtxChildPickerOpen(false)
    setCtxChildPickedId('')
  }

  const handleDragStart = (e, projectId) => {
    if (userRole !== 'admin') { e.preventDefault(); return }
    /* Belt-and-suspenders: archived cards render with draggable={false}
       so this branch shouldn't fire in normal flow, but if anything
       ever kicks off a drag on one (e.g. programmatic), abort. */
    if (archivedHold.some(p => p.id === projectId)) { e.preventDefault(); return }
    setDragId(projectId)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e, stageObj) => {
    e.preventDefault()
    if (!dragId) return
    const project = projects.find(p => p.id === dragId)
    if (!project || project.stage_id === stageObj.id) { setDragId(null); return }

    const today     = todayISO()
    const enteredAt = project.stage_entered_at || today
    const days      = daysInStage(enteredAt)

    /* The stage being LEFT, resolved from stage_id through the LUT.

       This used to read projects.current_stage, and that was the source
       of a real bug: current_stage is a denormalised copy that this
       handler never updated, so it froze at whatever it was when the
       project was created. Every drag then stamped the history row with
       that stale name — and wrote no stage_id at all — which is why
       project_stage_history disagreed with itself (28 rows by id vs 30
       by text) and why 94% of production projects displayed a stage
       name that did not match their actual stage. */
    const fromStage = stages.find(s => s.id === project.stage_id) || null

    await supabase.from('project_stage_history').insert([{
      project_id:    project.id,
      stage_id:      fromStage?.id ?? project.stage_id ?? null,
      /* current_stage as a LAST-RESORT fallback only — not as a source of
         truth. It matters because project_stage_history.stage is NOT NULL
         on Dev (it is nullable on Prod), so a project with a null stage_id
         would make the LUT lookup miss and this insert throw, where the
         old name-based code survived. No such project exists in either
         environment today (0 rows), and nothing enforces stage_id NOT
         NULL, so this keeps the old behaviour for the one case it
         differed in. */
      stage:         fromStage?.name ?? project.current_stage ?? null,
      entered_at:    enteredAt,
      exited_at:     today,
      days_in_stage: days,
    }])

    /* Both columns are written, deliberately. stage_id is the single
       source of truth and the only one anything READS; current_stage is
       kept in step purely so the column stays truthful for any consumer
       neither of us found. Writing it costs nothing; letting it drift
       again would cost another 94%. */
    await supabase.from('projects')
      .update({
        stage_id:         stageObj.id,
        stage_entered_at: today,
        current_stage:    stageObj.name,
      })
      .eq('id', dragId)

    setProjects(prev => prev.map(p =>
      p.id === dragId
        ? { ...p, stage_id: stageObj.id, current_stage: stageObj.name, stages: { id: stageObj.id, name: stageObj.name, color: stageObj.color }, stage_entered_at: today }
        : p
    ))
    setDragId(null)
  }

  const isAdmin = userRole === 'admin'

  const filteredInquiries = inquiries.filter(inq => {
    if (!inquiryQuery) return true
    const label = [inq.first_name, inq.last_name].filter(Boolean).join(' ') + (inq.city ? ` ${inq.city}` : '')
    return label.includes(inquiryQuery)
  })

  const [filterFavorite, setFilterFavorite]   = useState(false)
  const [filterUrgentTask, setFilterUrgentTask] = useState(false)
  const [filterActiveTask, setFilterActiveTask] = useState(false)

  const [taskModal, setTaskModal] = useState(null)
  const [taskToast, setTaskToast] = useState(false)

  const openTaskModal = (project) => {
    setTaskModal(project)
    setContextMenu(null)
  }

  const handleTaskSaved = async () => {
    setTaskToast(true)
    setTimeout(() => setTaskToast(false), 2500)
    const { data: tasksData } = await supabase.from('tasks').select('project_id, status_id').neq('status_id', 3)
    if (tasksData) {
      const grouped = {}
      tasksData.forEach(t => {
        if (!t.project_id) return
        if (!grouped[t.project_id]) grouped[t.project_id] = []
        grouped[t.project_id].push(t.status_id)
      })
      setTasksByProject(grouped)
    }
  }

  const isVisible = (project) => {
    if (filterResponsible && project.responsible_id !== filterResponsible) return false
    if (filterFavorite && !project.is_favorite) return false
    if (filterUrgentTask && !tasksByProject[project.id]?.some(s => s === 2)) return false
    if (filterActiveTask && !tasksByProject[project.id]?.some(s => s === 1)) return false
    return true
  }

  const filteredArchived = archivedProjects.filter(p =>
    !archiveSearch.trim() || p.name.toLowerCase().includes(archiveSearch.trim().toLowerCase())
  )

  // ── Archive view ──
  if (archiveView) {
    return (
      <div className="page" dir="rtl">
        <div className="kanban-container">
          <div className="kanban-topbar">
            <h1 className="kanban-archive-title">ארכיון פרויקטים</h1>
            <button className="kanban-archive-back-btn" onClick={closeArchiveView}>
              חזור לפרויקטים
            </button>
          </div>

          <div className="kanban-archive-toolbar">
            <input
              className="kanban-archive-search"
              placeholder="חיפוש לפי שם פרויקט..."
              value={archiveSearch}
              onChange={e => setArchiveSearch(e.target.value)}
              dir="rtl"
            />
          </div>

          <div className="kanban-archive-table-wrap">
            {archiveLoading ? (
              <p style={{ textAlign: 'center', color: '#888', padding: 40 }}>טוען...</p>
            ) : (
              <table className="kanban-archive-table" dir="rtl">
                <thead>
                  <tr>
                    <th>שם פרויקט</th>
                    <th>יישוב</th>
                    <th>תאריך העברה</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredArchived.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', color: '#888', padding: 40 }}>אין פרויקטים בארכיון</td></tr>
                  ) : filteredArchived.map(p => (
                    <tr key={p.id}>
                      <td
                        style={{ cursor: 'pointer' }}
                        onDoubleClick={() => navigate(`/projects/${p.id}`, { state: { fromArchive: true } })}
                      >{p.name}</td>
                      <td>{p.client_info?.city || ''}</td>
                      <td>{formatDate(p.archived_at)}</td>
                      <td>
                        <button className="kanban-restore-btn" onClick={() => handleRestoreProject(p.id)}>
                          שחזר
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        {archiveToast && <div className="ktm-toast">{archiveToast}</div>}
      </div>
    )
  }

  return (
    <div className="page" dir="rtl">
      <div className="kanban-container">

        {/* ── Parent-view header (only when /פרויקטים/אב/:parentId) ── */}
        {parentId && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              flexWrap: 'wrap',
              padding: '8px 4px 14px',
              borderBottom: '1px solid #ece8df',
              marginBottom: 10,
            }}
          >
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#1a1a18', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconFolder size={20} />
              <span>{parentProject?.name || '...'}</span>
            </h1>
            <button
              type="button"
              onClick={() => navigate(`/projects/${parentId}`)}
              style={{ background: 'none', border: 'none', color: '#7a9478', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0, textDecoration: 'underline' }}
            >
              ← לדף הפרויקט של האב
            </button>
            {parentProjectsList.length > 0 && (
              <select
                value={parentId}
                onChange={e => { if (e.target.value) navigate(`/פרויקטים/אב/${e.target.value}`) }}
                style={{ marginInlineStart: 'auto', padding: '6px 10px', border: '1px solid #d6d2c7', borderRadius: 6, background: '#fff', fontFamily: 'inherit', fontSize: 13, color: '#1a1a18' }}
                title="מעבר לפרויקט אב אחר"
              >
                {(parentProjectsList.some(p => p.id === parentId)
                  ? parentProjectsList
                  : (parentProject ? [parentProject, ...parentProjectsList] : parentProjectsList)
                ).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Topbar */}
        <div className="kanban-topbar">
          <span className="kanban-total">סה״כ פרויקטים: {projects.length}</span>
          <div className="kanban-filters">
            <button
              className={'kanban-filter-icon' + (filterFavorite ? ' kanban-filter-icon--active' : '')}
              onClick={() => setFilterFavorite(v => !v)}
              title="מועדפים בלבד"
            >
              <svg width="16" height="16" viewBox="0 0 24 24"
                fill={filterFavorite ? '#F6BF26' : 'none'}
                stroke={filterFavorite ? '#F6BF26' : '#9ca3af'}
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </button>

            <button
              className={'kanban-filter-icon' + (filterUrgentTask ? ' kanban-filter-icon--active' : '')}
              onClick={() => setFilterUrgentTask(v => !v)}
              title="יש משימות דחופות"
            >
              <svg width="14" height="14" viewBox="0 0 24 24"
                fill={filterUrgentTask ? '#E24B4A' : 'none'}
                stroke="#E24B4A"
                strokeWidth="2.2">
                <circle cx="12" cy="12" r="10"/>
              </svg>
            </button>

            <button
              className={'kanban-filter-icon' + (filterActiveTask ? ' kanban-filter-icon--active' : '')}
              onClick={() => setFilterActiveTask(v => !v)}
              title="יש משימות פעילות"
            >
              <svg width="14" height="14" viewBox="0 0 24 24"
                fill={filterActiveTask ? '#2D3748' : 'none'}
                stroke="#2D3748"
                strokeWidth="2.2">
                <circle cx="12" cy="12" r="10"/>
              </svg>
            </button>

            <select className="kanban-filter-select" value={filterResponsible} onChange={e => setFilterResponsible(e.target.value)}>
              <option value="">אחראית: הכל</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.first_name}</option>
              ))}
            </select>
            <button
              className="kanban-filter-reset"
              onClick={() => {
                setFilterResponsible('')
                setFilterFavorite(false)
                setFilterUrgentTask(false)
                setFilterActiveTask(false)
              }}
            >
              בטל סינון
            </button>
          </div>

          {/* Parent-view entry (only on the normal board) */}
          {!parentId && (
            <button
              className="kanban-archive-btn"
              onClick={() => {
                if (parentProjectsList.length > 0) {
                  navigate(`/פרויקטים/אב/${parentProjectsList[0].id}`)
                }
              }}
              disabled={parentProjectsList.length === 0}
              title={parentProjectsList.length === 0 ? 'אין עדיין פרויקטי אב' : 'תצוגת פרויקטי אב'}
            >
              <IconFolder size={14} />
              תצוגת פרויקטי אב
            </button>
          )}

          {/* Archive button + separator + add button */}
          <button className="kanban-archive-btn" onClick={openArchiveView}>
            <IconArchive size={14} />
            ארכיון
          </button>
          {isAdmin && <div className="kanban-topbar-sep" />}
          {isAdmin && (
            <button className="btn-add-project kanban-add-btn" title="פרויקט חדש" onClick={openModal}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
                <path d="M9 21V12h6v9"/>
                <circle cx="18.5" cy="5.5" r="3.5" fill="#1a1a1a" stroke="none"/>
                <line x1="18.5" y1="3.5" x2="18.5" y2="7.5" stroke="white" strokeWidth="1.8"/>
                <line x1="16.5" y1="5.5" x2="20.5" y2="5.5" stroke="white" strokeWidth="1.8"/>
              </svg>
            </button>
          )}
        </div>

        {/* Board */}
        <div className="kanban-board">
          <div className="kanban-columns-wrap">
          {stages.map(stage => {
            const bg   = stage.color || '#f0f0f0'
            const text = getTextColor(bg)
            const cards = projects.filter(p => p.stage_id === stage.id)
            return (
              <div
                key={stage.id}
                className={`kanban-column${stage.name === 'השהייה' ? ' kanban-column--narrow' : ''}`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
              >
                <div className="kanban-col-header" style={{ background: bg, color: text }}>
                  {/* Display-only override: this column also holds the
                      archive bucket, so the title reads split. The DB
                      stage name stays "השהייה" and every code path that
                      matches on stage.name === 'השהייה' is unchanged. */}
                  {stage.name === 'השהייה' ? 'בהשהייה / הסתיימו' : stage.name}
                  <span className="kanban-col-count">{cards.length}</span>
                </div>

                <div className="kanban-cards">
                  {cards.map(project => (
                    <div
                      key={project.id}
                      className="kanban-card"
                      draggable={isAdmin}
                      onDragStart={(e) => handleDragStart(e, project.id)}
                      onDoubleClick={() => navigate(`/projects/${project.id}`)}
                      onContextMenu={(e) => handleCardRightClick(e, project)}
                      style={{
                        ...(project.is_favorite ? { border: '2.5px solid #2D3748' } : {}),
                        ...(!isVisible(project) ? { opacity: 0.25, filter: 'grayscale(1)' } : {}),
                      }}
                    >
                      <div className="kanban-card-top-row">
                        <div className="kanban-card-name">
                          {project.name}
                          {!parentId && (childCounts[project.id] > 0 || project.is_parent_project) && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/פרויקטים/אב/${project.id}`)
                              }}
                              onDoubleClick={(e) => e.stopPropagation()}   /* don't open the project file too */
                              onMouseDown={(e) => e.stopPropagation()}     /* don't start a drag from the badge */
                              onContextMenu={(e) => e.stopPropagation()}   /* keep the card's context menu off the badge */
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7' }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 2,
                                color: '#7a9478',
                                fontSize: 11,
                                fontWeight: 500,
                                marginInlineStart: 6,
                                verticalAlign: 'middle',
                                cursor: 'pointer',
                                transition: 'opacity 0.12s',
                              }}
                              title={childCounts[project.id] > 0 ? `${childCounts[project.id]} פרויקטי בן — לחיצה למעבר לתצוגת הילדים` : 'פרויקט אב — לחיצה למעבר לתצוגת הילדים'}
                            >
                              <IconFolder size={12} />
                              {childCounts[project.id] > 0 && <span>{childCounts[project.id]}</span>}
                            </span>
                          )}
                        </div>
                        <div className="kanban-card-days">{daysInStage(project.stage_entered_at)}</div>
                      </div>
                      <div className="kanban-card-meta">
                        {project.profiles?.first_name && (
                          <span className="kanban-card-responsible">
                            {project.profiles.first_name}
                          </span>
                        )}
                      </div>
                      {/* Notification dots — the task-status dots that used
                          to sit here are gone for good, and tasksByProject
                          is deliberately NOT consulted below: it still backs
                          the two board filters (יש משימות דחופות / יש משימות
                          פעילות) in isVisible() above and nothing else. */}
                      {(() => {
                        const n = notifsByProject[project.id]
                        if (!n || (!n.documents && !n.questionnaire)) return null
                        return (
                          <div className="kanban-card-notifs">
                            {n.documents && (
                              <ActionRequiredDot size={NOTIF_DOT_SIZE} label="עדכון חדש במסמכים" />
                            )}
                            {n.questionnaire && (
                              <ActionRequiredDot size={NOTIF_DOT_SIZE} label="עדכון חדש בשאלון פרוגרמה" />
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>

                {/* ── Archive bucket (SHOWN ONLY IN "השהייה" COLUMN) ──
                      Collapsible list of archived projects at the same
                      hierarchy level. Cards mirror the normal-card
                      markup so the visual parity is preserved; drag
                      is disabled per-card AND the wrapper swallows
                      dragover/drop so nothing can be dropped into
                      the archive. Header shows a chevron on the
                      visual-right (RTL first-child) + count. */}
                {stage.name === 'השהייה' && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation() }}
                    style={{ padding: '0 5px 6px' }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={archiveHoldOpen}
                      onClick={() => setArchiveHoldOpen(v => !v)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setArchiveHoldOpen(v => !v)
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '6px 8px',
                        background: archiveHoldOpen ? '#eeebe6' : '#f2efe9',
                        border: '1px solid rgba(26,26,24,0.13)', borderRadius: 6,
                        cursor: 'pointer', direction: 'rtl',
                        fontFamily: 'Heebo, sans-serif', fontSize: 13, color: '#1a1a18',
                        userSelect: 'none',
                      }}
                    >
                      {/* Chevron rendered FIRST — in this RTL row it
                          lands on the visual-right, mirroring the
                          accordion pattern used elsewhere. */}
                      <svg
                        width="12" height="12" viewBox="0 0 24 24"
                        fill="none" stroke="#7a9478" strokeWidth="2.4"
                        strokeLinecap="round" strokeLinejoin="round"
                        aria-hidden="true"
                        style={{
                          flexShrink: 0,
                          transform: archiveHoldOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.15s',
                        }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      <span style={{ flex: 1, fontWeight: 500 }}>הסתיימו</span>
                      <span style={{
                        background: 'rgba(0,0,0,0.10)', borderRadius: 10,
                        fontSize: 12, fontWeight: 600, padding: '1px 7px',
                      }}>
                        {archivedHold.length}
                      </span>
                    </div>

                    {/* Body — hidden via display:none when collapsed. */}
                    <div
                      aria-hidden={!archiveHoldOpen}
                      style={{
                        display: archiveHoldOpen ? 'flex' : 'none',
                        flexDirection: 'column', gap: 5,
                        padding: '6px 0 2px',
                      }}
                    >
                      {archivedHold.length === 0 ? (
                        <div style={{
                          color: '#8a8680', fontSize: 12, padding: '4px 6px',
                          textAlign: 'right', direction: 'rtl',
                        }}>
                          אין פרויקטים בארכיון.
                        </div>
                      ) : (
                        archivedHold.map(project => (
                          <div
                            key={project.id}
                            className="kanban-card"
                            /* Explicit false — never draggable, not even
                               for admins. */
                            draggable={false}
                            /* Open in READ-ONLY archive mode — same nav
                               shape the archive VIEW uses (line ~926).
                               ProjectDetail keys off location.state.fromArchive
                               to render the red banner, disable inputs,
                               and swap the back link to "חזור לארכיון". */
                            onDoubleClick={() => navigate(`/projects/${project.id}`, { state: { fromArchive: true } })}
                            onContextMenu={(e) => handleCardRightClick(e, project)}
                            style={{
                              opacity: 0.55,
                              filter: 'grayscale(0.5)',
                              cursor: 'default',
                              ...(project.is_favorite ? { border: '2.5px solid #2D3748' } : {}),
                            }}
                          >
                            <div className="kanban-card-top-row">
                              <div className="kanban-card-name">
                                {project.name}
                                {!parentId && (childCounts[project.id] > 0 || project.is_parent_project) && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      navigate(`/פרויקטים/אב/${project.id}`)
                                    }}
                                    onDoubleClick={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    onContextMenu={(e) => e.stopPropagation()}
                                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7' }}
                                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 2,
                                      color: '#7a9478',
                                      fontSize: 11,
                                      fontWeight: 500,
                                      marginInlineStart: 6,
                                      verticalAlign: 'middle',
                                      cursor: 'pointer',
                                      transition: 'opacity 0.12s',
                                    }}
                                    title={childCounts[project.id] > 0 ? `${childCounts[project.id]} פרויקטי בן — לחיצה למעבר לתצוגת הילדים` : 'פרויקט אב — לחיצה למעבר לתצוגת הילדים'}
                                  >
                                    <IconFolder size={12} />
                                    {childCounts[project.id] > 0 && <span>{childCounts[project.id]}</span>}
                                  </span>
                                )}
                              </div>
                              <div className="kanban-card-days">{daysInStage(project.stage_entered_at)}</div>
                            </div>
                            <div className="kanban-card-meta">
                              {project.profiles?.first_name && (
                                <span className="kanban-card-responsible">
                                  {project.profiles.first_name}
                                </span>
                              )}
                            </div>
                            {/* Task-status dots removed here too — this was
                                the archive board's duplicate of the active
                                card's block. */}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          </div>
        </div>

      </div>

      {/* ── Right-click context menu — slim, two items only.
            "פתח משימה חדשה" goes straight to NewTaskModal.
            "הגדרות פרויקט" hands off to the settings modal below.
            Everything else that used to live here (rename / favorite /
            responsible / parent / archive / auth code + welcome msg)
            now lives in that modal. ── */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-favorite-btn"
            onClick={() => openTaskModal(contextMenu.project)}
          >
            ＋ פתח משימה חדשה
          </button>
          <div className="context-menu-divider" />
          <button
            className="context-menu-favorite-btn"
            onClick={() => openSettings(contextMenu.project)}
          >
            ⚙ הגדרות פרויקט
          </button>
        </div>
      )}

      {/* Add Project Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()} dir="rtl">
            <h3 className="modal-title">פרויקט חדש</h3>

            <label className="modal-label">שם פרויקט</label>
            <input className="modal-input" placeholder="שם פרויקט" value={newName}
              onChange={e => setNewName(e.target.value)} autoFocus />

            <label className="modal-label">אחראי פרויקט</label>
            <select className="modal-input" value={newResponsible} onChange={e => setNewResponsible(e.target.value)}>
              <option value="">בחר אחראי...</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.first_name}</option>
              ))}
            </select>

            <div style={{ marginTop: 10, position: 'relative' }}>
              {selectedInquiry ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: '#F3F4F6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, color: '#1a1a2e', fontFamily: 'inherit', minHeight: 38, boxSizing: 'border-box' }}>
                  <span style={{ flex: 1 }}>
                    {[selectedInquiry.first_name, selectedInquiry.last_name].filter(Boolean).join(' ')}
                    {selectedInquiry.city ? ` — ${selectedInquiry.city}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedInquiry(null); setShowInquirySearch(false); setInquiryQuery('') }}
                    style={{ background: 'none', border: 'none', fontSize: 16, color: '#9ca3af', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 }}
                  >×</button>
                </div>
              ) : showInquirySearch ? (
                <>
                  <input
                    className="modal-input"
                    placeholder="חיפוש לפי שם או יישוב..."
                    value={inquiryQuery}
                    onChange={e => setInquiryQuery(e.target.value)}
                    style={{ marginBottom: 0 }}
                    autoFocus
                  />
                  {filteredInquiries.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', right: 0, left: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: 200, overflowY: 'auto' }}>
                      {filteredInquiries.slice(0, 8).map(inq => {
                        const label = [inq.first_name, inq.last_name].filter(Boolean).join(' ') + (inq.city ? ` — ${inq.city}` : '')
                        return (
                          <button key={inq.id} type="button" onClick={() => selectInquiry(inq)}
                            style={{ display: 'block', width: '100%', textAlign: 'right', padding: '9px 14px', background: 'none', border: 'none', borderBottom: '1px solid #f0f0f0', fontSize: 13, color: '#374151', cursor: 'pointer', fontFamily: 'inherit' }}
                            onMouseOver={e => e.currentTarget.style.background = '#f3f4f6'}
                            onMouseOut={e => e.currentTarget.style.background = 'none'}
                          >{label}</button>
                        )
                      })}
                    </div>
                  )}
                  {inquiries.length === 0 && (
                    <p style={{ fontSize: 12, color: '#888', margin: '5px 0 0', textAlign: 'right' }}>אין פניות פתוחות</p>
                  )}
                </>
              ) : (
                <button type="button" onClick={() => { setShowInquirySearch(true); loadInquiries() }}
                  style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 7, padding: '6px 14px', fontSize: 13, color: '#888', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
                >+ טען פניה</button>
              )}
            </div>

            {/* ── Parent-project picker — same three-state pattern as the
                "+ טען פניה" block (pill / select / dashed button). Choosing
                a parent here makes the new project a child of it. Hidden in
                parent view where the parent is fixed by the URL. ── */}
            {!parentId && (
            <div style={{ marginTop: 10, position: 'relative' }}>
              {newParentId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', background: '#F3F4F6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, color: '#1a1a2e', fontFamily: 'inherit', minHeight: 38, boxSizing: 'border-box' }}>
                  <span style={{ flex: 1 }}>
                    פרויקט אב: {parentOptions.find(p => p.id === newParentId)?.name || '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setNewParentId(''); setShowParentPicker(false) }}
                    style={{ background: 'none', border: 'none', fontSize: 16, color: '#9ca3af', cursor: 'pointer', padding: '0 2px', lineHeight: 1, fontFamily: 'inherit', flexShrink: 0 }}
                  >×</button>
                </div>
              ) : showParentPicker ? (
                <select
                  className="modal-input"
                  value={newParentId}
                  onChange={e => setNewParentId(e.target.value)}
                  style={{ marginBottom: 0 }}
                  autoFocus
                >
                  <option value="">ללא — פרויקט עליון</option>
                  {parentOptions.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              ) : (
                <button type="button" onClick={() => { setShowParentPicker(true); loadParentOptions() }}
                  style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 7, padding: '6px 14px', fontSize: 13, color: '#888', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}
                >+ בחר פרויקט אב</button>
              )}
            </div>
            )}

            {modalError && <p style={{ color: 'red', fontSize: '13px', margin: '8px 0 0', textAlign: 'right' }}>{modalError}</p>}
            <div className="modal-actions">
              <button className="modal-btn-add" onClick={handleAddProject} disabled={adding}>{adding ? '...' : 'צור פרויקט'}</button>
              <button className="modal-btn-cancel" onClick={() => setShowModal(false)}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Archive step 1 dialog ── */}
      {archiveStep === 1 && (
        <div className="modal-overlay" onClick={handleArchiveCancel}>
          <div className="kanban-confirm-dialog" onClick={e => e.stopPropagation()} dir="rtl">
            <p className="kanban-confirm-text">כל המשימות של הפרויקט "{archiveTarget?.name}" ימחקו לצמיתות. להמשיך?</p>
            <div className="kanban-confirm-actions">
              <button className="kanban-confirm-yes" onClick={handleArchiveStep1Confirm}>אשר</button>
              <button className="kanban-confirm-no" onClick={handleArchiveCancel}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Archive step 2 dialog ── */}
      {archiveStep === 2 && (
        <div className="modal-overlay" onClick={handleArchiveCancel}>
          <div className="kanban-confirm-dialog" onClick={e => e.stopPropagation()} dir="rtl">
            <p className="kanban-confirm-text">הפרויקט "{archiveTarget?.name}" יועבר לארכיון ולא יהיה ניתן לעריכה. להמשיך?</p>
            <div className="kanban-confirm-actions">
              <button className="kanban-confirm-yes" onClick={handleArchiveStep2Confirm}>אשר</button>
              <button className="kanban-confirm-no" onClick={handleArchiveCancel}>ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Parent-attach / detach confirm dialog (same style as archive) ── */}
      {parentConfirm && (
        <div
          className="modal-overlay"
          onClick={() => { setParentConfirm(null); setCtxChildPickedId('') }}
        >
          <div className="kanban-confirm-dialog" onClick={e => e.stopPropagation()} dir="rtl">
            <p className="kanban-confirm-text">
              {parentConfirm.mode === 'attach'
                ? `להפוך את הפרויקט "${parentConfirm.project?.name ?? ''}" לבן של "${parentConfirm.parentName ?? ''}"?`
                : 'לנתק את הפרויקט מהאב ולהפוך אותו לפרויקט רגיל?'}
            </p>
            <div className="kanban-confirm-actions">
              <button className="kanban-confirm-yes" onClick={handleParentConfirm}>אשר</button>
              <button
                className="kanban-confirm-no"
                onClick={() => { setParentConfirm(null); setCtxChildPickedId('') }}
              >ביטול</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Welcome-message popup — composed in handleOpenWelcomeMessage,
            shown here with the message inside a pre-wrapped block plus a
            Copy + Close pair. Reuses the standard modal-overlay; the
            dialog itself uses a kanban-welcome-* class set so we can
            give the message block its own styling (pre-wrap, selectable,
            scrollable). ── */}
      {welcomePopup && (
        <div className="modal-overlay" onClick={() => setWelcomePopup(null)}>
          <div className="kanban-welcome-dialog" onClick={e => e.stopPropagation()} dir="rtl">
            <pre className="kanban-welcome-text">{welcomePopup.message}</pre>
            <div className="kanban-confirm-actions">
              <button
                type="button"
                className="kanban-confirm-yes"
                onClick={handleCopyWelcomeMessage}
              >
                {welcomePopup.copied ? 'הועתק ✓' : 'העתק'}
              </button>
              <button
                type="button"
                className="kanban-confirm-no"
                onClick={() => setWelcomePopup(null)}
              >
                סגור
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── "הגדרות פרויקט" — per-project settings modal ────────────────
            Draft/save model: typing into any field mutates the local
            `settingsDraft` object only; the DB write happens ONCE on
            "שמור" via handleSettingsSave, which diffs draft vs original
            and runs a single UPDATE with just the changed columns.
            ביטול / סגור / overlay-click all drop the draft (handleSettingsCancel).

            Independent sections (NOT part of draft/save):
              * פרויקט בן — its own two-step parentConfirm flow.
              * קוד הרשאה — read-only, plus a green WhatsApp button that
                            opens the welcome-message popup composer.
              * העבר לארכיון — its own two-step archive flow.

            Design notes:
              * Every section is a `pdSettingsRow` block (label above
                input, full-width input, even vertical rhythm).
              * Border-radius dropped from the global 12px to 8px on
                inputs and buttons (override of .modal-input + inline
                styles on the footer buttons).
              * Subtle full-width divider above the destructive archive
                button so it visually separates from the editable rows.
              * Favorite icon now reflects the DRAFT state — ★ filled
                when is_favorite=true, ☆ outline when false (matches
                actual state, not the action).
            ── */}
      {settingsTarget && settingsDraft && (() => {
        /* ── "הגדרות פרויקט" ──────────────────────────────────────────
           Presentation only. Every value still saves exactly as before:
           the six drafted fields go through settingsDraft and are written
           by handleSettingsSave, and the flows that were never drafted
           (parent attach/detach, archive, welcome message, client
           preview) keep their own handlers untouched.

           Layout: five sections in a responsive grid — two columns where
           there is room, one where there isn't — with פעולות pulled out
           below a full-width rule.

           RTL: the modal is dir="rtl", so in every row the label is the
           FIRST child and therefore sits at the visual RIGHT, with the
           value and its icons running leftwards from it. */
        const pdFooterIconBtn = {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', padding: '6px 10px',
          fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
          color: '#1a1a2e',
        }

        const inquiryLink = settingsTarget.child_inquiry_token
          ? `${import.meta.env.VITE_APP_URL}/child-inquiry/${settingsTarget.child_inquiry_token}`
          : ''

        /* One copy handler for every copyable value; the key drives which
           icon shows its tick, so two rows can't both flash at once. */
        const copyValue = (key, text) => {
          if (!text) return
          navigator.clipboard.writeText(text)
          setSettingsCopied(key)
          setTimeout(() => setSettingsCopied(c => (c === key ? null : c)), 2000)
        }

        const CopyButton = ({ copyKey, text, label }) => (
          <button
            type="button"
            className={'pdset-icon-btn pdset-copy-cell' + (settingsCopied === copyKey ? ' pdset-icon-btn--ok' : '')}
            onClick={() => copyValue(copyKey, text)}
            disabled={!text}
            aria-label={settingsCopied === copyKey ? label + ' הועתק' : 'העתקת ' + label}
            title={settingsCopied === copyKey ? 'הועתק' : 'העתקת ' + label}
            style={!text ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
          >
            {settingsCopied === copyKey ? <IconCheck /> : <IconCopy />}
          </button>
        )

        /* "הפוך לפרויקט בן" is a FLOW, not a field: it opens a picker and
           then a two-step confirm that closes this modal on success. The
           condition for showing it is unchanged. */
        const showChildFlow =
          !parentId && (!!settingsTarget.parent_project_id || !settingsTarget.is_parent_project)

        const responsibleName =
          users.find(u => u.id === settingsDraft.responsible_id)?.first_name || ''

        /* A child can never also be a parent, so the "פרויקט אב" checkbox
           is hidden for one entirely rather than shown and then refused. */
        const isChild = !!settingsTarget.parent_project_id

        /* The parent's name. parentProjectsList holds every non-archived
           project flagged is_parent_project, and a child's parent is by
           definition one of those, so the lookup resolves; parentProject
           covers the parent-view route as a fallback. */
        const parentName = isChild
          ? (parentProjectsList.find(p => p.id === settingsTarget.parent_project_id)?.name
             || parentProject?.name
             || '')
          : ''

        /* Third header line — only rendered when it actually says
           something. Reads from the DRAFT for the parent case so ticking
           "פרויקט אב" updates it live. */
        const lineage = isChild
          ? (parentName ? 'פרויקט בן של ' + parentName : 'פרויקט בן')
          : (settingsDraft.is_parent_project ? 'פרויקט אב' : '')

        return (
          <div className="modal-overlay" onClick={handleSettingsCancel}>
            <div
              className="modal-box pdset-box"
              onClick={e => e.stopPropagation()}
              dir="rtl"
            >
              {/* Three-line header. The star mirrors settingsDraft, so
                  ticking "האם הפרויקט מועדף" below updates it live,
                  before saving — the same draft model every other field
                  in this modal follows. */}
              <div className="pdset-header">
                <div className="pdset-header-eyebrow">הגדרות פרויקט:</div>
                <div className="pdset-header-name-row">
                  <h3 className="pdset-header-name">{settingsDraft.name || '—'}</h3>
                  <span
                    className="pdset-header-star"
                    style={{ color: settingsDraft.is_favorite ? '#f5a623' : '#c8ccd2' }}
                    aria-label={settingsDraft.is_favorite ? 'פרויקט מועדף' : 'לא מועדף'}
                    title={settingsDraft.is_favorite ? 'פרויקט מועדף' : 'לא מועדף'}
                  >
                    {settingsDraft.is_favorite ? '★' : '☆'}
                  </span>
                </div>
                {lineage && <div className="pdset-header-lineage">{lineage}</div>}
              </div>

              <div className="pdset-grid">

                {/* ── 1. זיהוי הפרויקט ──────────────────────────────── */}
                <section className="pdset-section">
                  <h4 className="pdset-section-title">זיהוי הפרויקט</h4>

                  <div className="pdset-row pdset-row--grid">
                    <span className="pdset-row-label">שם הפרויקט</span>
                    <InlineField
                      value={settingsDraft.name}
                      onSave={v => setSettingsDraft(d => ({ ...d, name: v }))}
                      withPencil
                      splitCells
                      pencilClassName="pdset-action-cell"
                      ariaLabel="שם הפרויקט"
                      placeholder="—"
                      className="pdset-value pdset-value-cell"
                      emptyClassName="pdset-value-empty"
                      inputClassName="modal-input"
                    />
                  </div>

                  <div className="pdset-row pdset-row--grid">
                    <span className="pdset-row-label">אחראית</span>
                    {/* Stores responsible_id but reads as the person's
                        name — hence displayValue. */}
                    <InlineField
                      value={settingsDraft.responsible_id}
                      displayValue={responsibleName}
                      onSave={v => setSettingsDraft(d => ({ ...d, responsible_id: v }))}
                      withPencil
                      splitCells
                      pencilClassName="pdset-action-cell"
                      ariaLabel="אחראית"
                      placeholder="ללא"
                      className="pdset-value pdset-value-cell"
                      emptyClassName="pdset-value-empty"
                      renderInput={(props) => (
                        <select {...props} className="modal-input" style={{ borderRadius: 8 }}>
                          <option value="">ללא</option>
                          {users.map(u => (
                            <option key={u.id} value={u.id}>{u.first_name}</option>
                          ))}
                        </select>
                      )}
                    />
                  </div>

                  {/* A checkbox now, not the old star button — the star
                      moved to the header and reads the same draft value,
                      so ticking this updates it immediately. */}
                  <div className="pdset-row">
                    <label className="pdset-check">
                      <input
                        type="checkbox"
                        checked={!!settingsDraft.is_favorite}
                        onChange={e => setSettingsDraft(d => ({ ...d, is_favorite: e.target.checked }))}
                        style={{ width: 16, height: 16 }}
                      />
                      <span>האם הפרויקט מועדף</span>
                    </label>
                  </div>
                </section>

                {/* ── 2. גישה וקישורים ──────────────────────────────── */}
                <section className="pdset-section">
                  <h4 className="pdset-section-title">גישה וקישורים</h4>

                  {/* RTL grid: column 1 is the visual RIGHT. Reading
                      right-to-left — label, value, WhatsApp, copy — so the
                      copy icon is always the leftmost element and every row
                      in this group puts it on the same vertical line. */}
                  <div className="pdset-row pdset-row--grid pdset-row--copy">
                    <span className="pdset-row-label">קוד הרשאה</span>
                    {/* The welcome-message composer — an existing flow,
                        kept ALONGSIDE the copy icon, not replaced. As an
                        ACTION it sits beside the label. */}
                    <button
                        type="button"
                        className="pdset-icon-btn pdset-action-cell"
                        onClick={handleOpenWelcomeMessage}
                        title="הכנת הודעת ברוכים הבאים"
                        aria-label="הכנת הודעת ברוכים הבאים"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366" stroke="none" aria-hidden="true">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                          <path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.936.526 3.745 1.438 5.291L2 22l4.842-1.417A9.956 9.956 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 11.999 2zm0 18a7.958 7.958 0 0 1-4.28-1.244l-.307-.182-3.18.93.972-3.093-.2-.317A7.958 7.958 0 0 1 4 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z"/>
                        </svg>
                    </button>
                    <span className="pdset-value pdset-value-ltr pdset-value-cell" style={{ letterSpacing: '0.5px' }}>
                      {settingsTarget.auth_code || '—'}
                    </span>
                    <CopyButton copyKey="auth" text={settingsTarget.auth_code || ''} label="קוד ההרשאה" />
                  </div>

                  <div className="pdset-row pdset-row--grid pdset-row--copy">
                    <span className="pdset-row-label">קבוצת וואטסאפ</span>
                    <InlineField
                      value={settingsDraft.whatsapp_group_url}
                      onSave={v => setSettingsDraft(d => ({ ...d, whatsapp_group_url: v }))}
                      withPencil
                      splitCells
                      pencilClassName="pdset-action-cell"
                      ariaLabel="קישור קבוצת וואטסאפ"
                      placeholder="לא הוגדר"
                      className="pdset-value pdset-value-ltr pdset-value-cell"
                      emptyClassName="pdset-value-empty"
                      inputClassName="modal-input"
                    />
                    <CopyButton
                      copyKey="wa"
                      text={settingsDraft.whatsapp_group_url || ''}
                      label="קישור קבוצת וואטסאפ"
                    />
                  </div>

                  {/* Parent projects only — the public child-inquiry link. */}
                  {!!settingsDraft.is_parent_project && (
                    <div className="pdset-row pdset-row--grid pdset-row--copy">
                      <span className="pdset-row-label">טופס פנייה</span>
                      <span className="pdset-value pdset-value-ltr pdset-value-cell">{inquiryLink || '—'}</span>
                      <CopyButton copyKey="inquiry" text={inquiryLink} label="קישור טופס הפנייה" />
                    </div>
                  )}
                </section>

                {/* ── 3. מבנה הפרויקט ───────────────────────────────── */}
                <section className="pdset-section">
                  <h4 className="pdset-section-title">מבנה הפרויקט</h4>

                  {/* Hidden entirely for a child project — a child cannot
                      also be a parent, so offering the box at all would be
                      an option that could only ever be refused. */}
                  {!isChild && (
                  <div className="pdset-row" style={{ display: 'block' }}>
                    <label className="pdset-check">
                      <input
                        type="checkbox"
                        checked={!!settingsDraft.is_parent_project}
                        onChange={e => {
                          setSettingsError('')
                          if (!e.target.checked && childCounts[settingsTarget.id] > 0) {
                            setSettingsError('לא ניתן להסיר סימון "פרויקט אב" מפרויקט עם פרויקטי בן פעילים')
                            return
                          }
                          setSettingsDraft(d => ({ ...d, is_parent_project: e.target.checked }))
                        }}
                      />
                      <span>פרויקט אב</span>
                    </label>
                    {/* Stays attached to the checkbox that produces it. */}
                    {settingsError && (
                      <p style={{ color: 'red', fontSize: '13px', margin: '6px 0 0', textAlign: 'right' }}>{settingsError}</p>
                    )}
                  </div>
                  )}

                  {/* דגם נבחר — child projects only, chosen from the
                      PARENT's model catalogue. Writes the very same
                      projects.selected_model_id column ProjectDetail's
                      "פרטי דגם" writes, with the same empty-to-null
                      normalisation, so the two views can't drift. */}
                  {isChild && settingsModels.length > 0 && (
                    <div className="pdset-row pdset-row--grid">
                      <span className="pdset-row-label">דגם נבחר</span>
                      <InlineField
                        value={settingsDraft.selected_model_id}
                        displayValue={settingsModels.find(m => m.id === settingsDraft.selected_model_id)?.name || ''}
                        onSave={v => setSettingsDraft(d => ({ ...d, selected_model_id: v }))}
                        withPencil
                        splitCells
                        pencilClassName="pdset-action-cell"
                        ariaLabel="דגם נבחר"
                        placeholder="לא נבחר"
                        className="pdset-value pdset-value-cell"
                        emptyClassName="pdset-value-empty"
                        renderInput={(props) => (
                          <select {...props} className="modal-input" style={{ borderRadius: 8 }}>
                            <option value="">לא נבחר</option>
                            {settingsModels.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        )}
                      />
                    </div>
                  )}

                  {showChildFlow && (
                    <div className="pdset-row" style={{ display: 'block' }}>
                      <label className="pdset-check">
                        <input
                          type="checkbox"
                          checked={!!settingsTarget.parent_project_id || ctxChildPickerOpen}
                          onChange={e => {
                            const isCurrentlyChild = !!settingsTarget.parent_project_id
                            if (isCurrentlyChild) {
                              setParentConfirm({ mode: 'detach', project: settingsTarget })
                            } else if (e.target.checked) {
                              setCtxChildPickedId('')
                              setCtxChildPickerOpen(true)
                              loadParentOptions()
                            } else {
                              setCtxChildPickerOpen(false)
                              setCtxChildPickedId('')
                            }
                          }}
                        />
                        <span>הפוך לפרויקט בן</span>
                      </label>
                      {!settingsTarget.parent_project_id && ctxChildPickerOpen && (
                        <select
                          className="modal-input"
                          style={{ borderRadius: 8, marginTop: 8 }}
                          value={ctxChildPickedId}
                          onChange={e => {
                            const pid = e.target.value
                            setCtxChildPickedId(pid)
                            if (pid) {
                              const parentName = parentOptions.find(p => p.id === pid)?.name || ''
                              setParentConfirm({
                                mode: 'attach',
                                project: settingsTarget,
                                parentId: pid,
                                parentName,
                              })
                            }
                          }}
                        >
                          <option value="">בחר אב…</option>
                          {parentOptions
                            .filter(p => p.id !== settingsTarget.id)
                            .map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                      )}
                    </div>
                  )}
                </section>

                {/* ── 4. מה הלקוח רואה ──────────────────────────────── */}
                <section className="pdset-section">
                  <h4 className="pdset-section-title">מה הלקוח רואה</h4>

                  <div className="pdset-row">
                    <label className="pdset-check">
                      <input
                        type="checkbox"
                        checked={!!settingsDraft.show_programming_questionnaire}
                        onChange={(e) => setSettingsDraft(d => ({
                          ...d,
                          show_programming_questionnaire: e.target.checked,
                        }))}
                        style={{ width: 16, height: 16 }}
                      />
                      <span>חשוף שאלון פרוגרמה ללקוח</span>
                    </label>
                  </div>

                  {/* Opens ON TOP of this modal; the draft stays as-is so
                      closing the preview returns here unchanged. */}
                  {isAdmin && (
                    <div className="pdset-row">
                      {/* Same geometry as the checkbox above: the control
                          is the first child and so paints at the visual
                          RIGHT, with its text to the left of it. */}
                      <button
                        type="button"
                        className="pdset-check pdset-check-btn"
                        onClick={() => setClientPreviewProject(settingsTarget)}
                        title="תצוגת לקוח"
                        aria-label="פתיחת תצוגת לקוח"
                      >
                        <IconSmartphone size={16} />
                        <span>תצוגת לקוח</span>
                      </button>
                    </div>
                  )}
                </section>
              </div>

              {/* ── Footer ───────────────────────────────────────────
                  RTL: the first child sits at the visual RIGHT, so
                  "העברה לארכיון" keeps the side it had while the
                  save/cancel pair is pushed to the visual LEFT. The
                  archive flow itself is unchanged — it still opens the
                  same two-step confirm. */}
              <div className="pdset-footer">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => startArchiveFlow(settingsTarget)}
                    aria-label="העברת הפרויקט לארכיון"
                    title="העברה לארכיון"
                    style={{ ...pdFooterIconBtn, color: '#E24B4A' }}
                  >
                    <IconArchive size={16} />
                    <span>העברה לארכיון</span>
                  </button>
                )}

                <div className="pdset-footer-actions">
                <button
                  type="button"
                  onClick={handleSettingsSave}
                  disabled={settingsSaving}
                  aria-label="שמור"
                  title="שמור"
                  style={{
                    ...pdFooterIconBtn,
                    opacity: settingsSaving ? 0.4 : 1,
                    cursor: settingsSaving ? 'not-allowed' : 'pointer',
                    color: '#1a1a2e',
                  }}
                >
                  <IconSave size={18} />
                  <span>{settingsSaving ? '...' : 'שמור'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleSettingsCancel}
                  aria-label="ביטול"
                  title="ביטול"
                  style={{ ...pdFooterIconBtn, color: '#E24B4A' }}
                >
                  <IconX size={18} />
                  <span>ביטול</span>
                </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── תצוגת לקוח — read-only client-portal preview ── */}
      {clientPreviewProject && (
        <ClientPreviewOverlay
          project={clientPreviewProject}
          onClose={() => setClientPreviewProject(null)}
        />
      )}

      {/* ── New Task Modal ── */}
      {taskModal && (
        <NewTaskModal
          project={taskModal}
          users={users}
          onClose={() => setTaskModal(null)}
          onSaved={handleTaskSaved}
        />
      )}

      {taskToast && (
        <div className="ktm-toast">המשימה נשמרה ✓</div>
      )}

      {archiveToast && (
        <div className="ktm-toast">{archiveToast}</div>
      )}
    </div>
  )
}

export default ProjectsKanban
