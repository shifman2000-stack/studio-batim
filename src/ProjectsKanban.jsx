import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { generateUniqueAuthCode } from './lib/generateAuthCode'
import NewTaskModal from './NewTaskModal'
import './ProjectsKanban.css'

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
  const [settingsDraft,  setSettingsDraft]  = useState(null) // { name, is_favorite, responsible_id, whatsapp_group_url } | null
  const [settingsSaving, setSettingsSaving] = useState(false)

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
        .from('stages').select('*').order('order_index')
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
  // children, used to hide the "פרויקט בן" checkbox on cards that are
  // already parents and to render the folder badge on those cards. As a
  // side-effect also rebuilds parentProjectsList — { id, name } of every
  // project that currently has at least one child — feeding the parent-view
  // header dropdown and the "תצוגת פרויקטי אב" toolbar button.
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

    const distinctIds = Object.keys(counts)
    if (distinctIds.length > 0) {
      const { data: parents } = await supabase
        .from('projects')
        .select('id, name')
        .in('id', distinctIds)
        .order('name', { ascending: true })
      setParentProjectsList(parents || [])
    } else {
      setParentProjectsList([])
    }
  }

  const handleParentConfirm = async () => {
    if (!parentConfirm) return
    const { mode, project, parentId } = parentConfirm
    const nextParent = mode === 'attach' ? parentId : null
    await supabase.from('projects').update({ parent_project_id: nextParent }).eq('id', project.id)
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
    })
    setCtxChildPickerOpen(false)
    setCtxChildPickedId('')
    setContextMenu(null)
    if (!parentId && !(childCounts[project.id] > 0)) {
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

    /* No-op shortcut. */
    if (Object.keys(patch).length === 0) {
      setSettingsTarget(null)
      setSettingsDraft(null)
      return
    }

    setSettingsSaving(true)
    await supabase.from('projects').update(patch).eq('id', settingsTarget.id)

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

    await supabase.from('project_stage_history').insert([{
      project_id:    project.id,
      stage:         project.current_stage,
      entered_at:    enteredAt,
      exited_at:     today,
      days_in_stage: days,
    }])

    await supabase.from('projects')
      .update({ stage_id: stageObj.id, stage_entered_at: today })
      .eq('id', dragId)

    setProjects(prev => prev.map(p =>
      p.id === dragId
        ? { ...p, stage_id: stageObj.id, stages: { id: stageObj.id, name: stageObj.name, color: stageObj.color }, stage_entered_at: today }
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
                          {!parentId && childCounts[project.id] > 0 && (
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
                              title={`${childCounts[project.id]} פרויקטי בן — לחיצה למעבר לתצוגת הילדים`}
                            >
                              <IconFolder size={12} />
                              <span>{childCounts[project.id]}</span>
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
                      {tasksByProject[project.id]?.length > 0 && (() => {
                        const statuses = tasksByProject[project.id]
                        const dots = statuses.slice(0, 5)
                        const overflow = statuses.length > 5
                        return (
                          <div className="kanban-card-tasks">
                            {dots.map((s, i) => (
                              <span
                                key={i}
                                className="kanban-task-dot"
                                style={{ background: s === 2 ? '#E24B4A' : '#2D3748' }}
                              />
                            ))}
                            {overflow && <span className="kanban-task-overflow">5+</span>}
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
                                {!parentId && childCounts[project.id] > 0 && (
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
                                    title={`${childCounts[project.id]} פרויקטי בן — לחיצה למעבר לתצוגת הילדים`}
                                  >
                                    <IconFolder size={12} />
                                    <span>{childCounts[project.id]}</span>
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
                            {/* Task-status dots — archived projects have
                                their tasks deleted at archive time, so
                                this normally shows nothing, but keeping
                                the exact same conditional preserves
                                markup parity with regular cards. */}
                            {tasksByProject[project.id]?.length > 0 && (() => {
                              const statuses = tasksByProject[project.id]
                              const dots = statuses.slice(0, 5)
                              const overflow = statuses.length > 5
                              return (
                                <div className="kanban-card-tasks">
                                  {dots.map((s, i) => (
                                    <span
                                      key={i}
                                      className="kanban-task-dot"
                                      style={{ background: s === 2 ? '#E24B4A' : '#2D3748' }}
                                    />
                                  ))}
                                  {overflow && <span className="kanban-task-overflow">5+</span>}
                                </div>
                              )
                            })()}
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
        /* Inline style constants — shared across all rows so every
           field has identical alignment, width, and border-radius.
           Field grouping (separated by .pdGroupDivider):
             Group A — input fields    (name, responsible, whatsapp link)
             Group B — toggles/markers (favorite star, parent project)
             Group C — read-only       (auth code + welcome message)
             Group D — destructive     (archive — admin-only)
        */
        const pdSettingsRow   = { marginBottom: 14 }
        const pdInputBorder   = { borderRadius: 8 }
        const pdGroupDivider  = { borderTop: '1px solid #ececec', margin: '4px 0 14px' }
        /* Frameless icon-button base for the footer — no border, no
           background, just the icon over a comfortable tap area with a
           small text label beside it. Matches the spirit of the app's
           other small icon buttons. */
        const pdFooterIconBtn = {
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', padding: '6px 10px',
          fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
          color: '#1a1a2e',
        }
        return (
          <div className="modal-overlay" onClick={handleSettingsCancel}>
            <div
              className="modal-box"
              onClick={e => e.stopPropagation()}
              dir="rtl"
              style={{ width: 380, borderRadius: 10, gap: 0 }}
            >
              <h3 className="modal-title" style={{ marginBottom: 16 }}>הגדרות פרויקט</h3>

              {/* ── Group A: input fields ────────────────────────────── */}

              {/* 1. שם פרויקט */}
              <div style={pdSettingsRow}>
                <label className="modal-label">שם פרויקט</label>
                <input
                  type="text"
                  className="modal-input"
                  style={pdInputBorder}
                  value={settingsDraft.name}
                  onChange={e => setSettingsDraft(d => ({ ...d, name: e.target.value }))}
                  dir="rtl"
                />
              </div>

              {/* 2. אחראית */}
              <div style={pdSettingsRow}>
                <label className="modal-label">אחראית</label>
                <select
                  className="modal-input"
                  style={pdInputBorder}
                  value={settingsDraft.responsible_id}
                  onChange={e => setSettingsDraft(d => ({ ...d, responsible_id: e.target.value }))}
                >
                  <option value="">ללא</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.first_name}</option>
                  ))}
                </select>
              </div>

              {/* 3. קישור קבוצת WhatsApp */}
              <div style={pdSettingsRow}>
                <label className="modal-label">קישור קבוצת WhatsApp</label>
                <input
                  type="text"
                  className="modal-input"
                  style={pdInputBorder}
                  value={settingsDraft.whatsapp_group_url}
                  onChange={e => setSettingsDraft(d => ({ ...d, whatsapp_group_url: e.target.value }))}
                  placeholder="קישור הזמנה לקבוצת וואטסאפ של הפרויקט"
                  dir="rtl"
                />
              </div>

              <div style={pdGroupDivider} />

              {/* ── Group B: toggles / markers ───────────────────────── */}

              {/* 4. מועדפים — frameless star + text, clickable as one unit.
                  No checkbox. Star icon matches the CURRENT draft state
                  (★ filled when true, ☆ outline when false). */}
              <div style={pdSettingsRow}>
                <button
                  type="button"
                  onClick={() => setSettingsDraft(d => ({ ...d, is_favorite: !d.is_favorite }))}
                  aria-pressed={settingsDraft.is_favorite}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: 'none', border: 'none', padding: 0,
                    fontFamily: 'inherit', fontSize: 14,
                    color: '#1a1a2e', cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 18, lineHeight: 1, color: settingsDraft.is_favorite ? '#f5a623' : '#9ca3af' }}>
                    {settingsDraft.is_favorite ? '★' : '☆'}
                  </span>
                  <span>{settingsDraft.is_favorite ? 'פרויקט מועדף' : 'לא מועדף'}</span>
                </button>
              </div>

              {/* 5. פרויקט בן — independent (its own two-step parentConfirm
                  flow). Hidden in parent view and on projects that already
                  have children. The picker opens parentConfirm; that
                  handler closes this modal entirely on success. */}
              {!parentId && !(childCounts[settingsTarget.id] > 0) && (
                <div style={pdSettingsRow}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0, fontSize: 14, color: '#1a1a2e' }}>
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
                      style={{ cursor: 'pointer' }}
                    />
                    <span>הפוך לפרויקט בן</span>
                  </label>
                  {!settingsTarget.parent_project_id && ctxChildPickerOpen && (
                    <select
                      className="modal-input"
                      style={{ ...pdInputBorder, marginTop: 8 }}
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

              <div style={pdGroupDivider} />

              {/* ── Group C: read-only ───────────────────────────────── */}

              {/* 6. קוד הרשאה — read-only chip + green WhatsApp button
                  that opens the welcome-message popup composer. */}
              <div style={pdSettingsRow}>
                <label className="modal-label">קוד הרשאה לחיבור ראשוני</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, padding: '10px 12px', background: '#F3F4F6', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, color: '#1a1a2e', letterSpacing: '0.5px', fontFamily: 'inherit', boxSizing: 'border-box' }}>
                    {settingsTarget.auth_code || '—'}
                  </span>
                  <button
                    type="button"
                    className="context-menu-whatsapp-btn"
                    onClick={handleOpenWelcomeMessage}
                    title="הכנת הודעת ברוכים הבאים"
                    aria-label="הכנת הודעת ברוכים הבאים"
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="#25D366" stroke="none" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                      <path d="M11.999 2C6.477 2 2 6.477 2 12c0 1.936.526 3.745 1.438 5.291L2 22l4.842-1.417A9.956 9.956 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 11.999 2zm0 18a7.958 7.958 0 0 1-4.28-1.244l-.307-.182-3.18.93.972-3.093-.2-.317A7.958 7.958 0 0 1 4 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* 6b. Programming-questionnaire visibility toggle.
                     Client-only: flips whether the שאלון פרוגרמה tile
                     shows in the portal for this project. Admin/meeting
                     split-view stays available regardless. */}
              <div style={pdSettingsRow}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 14,
                    color: '#1a1a2e',
                    cursor: 'pointer',
                    userSelect: 'none',
                    direction: 'rtl',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={!!settingsDraft.show_programming_questionnaire}
                    onChange={(e) => setSettingsDraft(d => ({
                      ...d,
                      show_programming_questionnaire: e.target.checked,
                    }))}
                    style={{ width: 16, height: 16, accentColor: '#7a9478', cursor: 'pointer' }}
                  />
                  חשוף שאלון פרוגרמה ללקוח
                </label>
              </div>

              {/* ── Group D: destructive (admin-only) ────────────────── */}

              {isAdmin && (
                <>
                  <div style={pdGroupDivider} />
                  {/* 7. העבר לארכיון — opens the existing two-step archive
                      confirm flow. Small archive glyph next to the label. */}
                  <button
                    className="context-menu-archive-btn"
                    style={{ width: '100%', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={() => startArchiveFlow(settingsTarget)}
                  >
                    <IconArchive size={14} />
                    <span>העבר לארכיון</span>
                  </button>
                </>
              )}

              {/* ── Footer ──────────────────────────────────────────────
                  Two frameless icon buttons. שמור is a Feather floppy-disk
                  glyph; ביטול is a red X. Overlay-click also cancels. ── */}
              <div className="modal-actions" style={{ marginTop: 18 }}>
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
        )
      })()}

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
