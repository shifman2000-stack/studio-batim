import { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase } from './supabaseClient'
import ProfessionalModal from './components/professionals/ProfessionalModal'
import InlineField from './components/InlineField'
import DocumentsTab from './components/documents/DocumentsTab'
import SharedFilesTab from './components/sharedfiles/SharedFilesTab'
import TasksTab from './components/tasks/TasksTab'
import FinishingTab from './components/finishing/FinishingTab'
import QuantitiesTab from './components/quantities/QuantitiesTab'
import ContractorSpecTab from './components/contractorspec/ContractorSpecTab'
import MeetingSummariesTab, { MEETINGS_TAB_ID, buildMeetingDeepLink } from './components/meetings/MeetingSummariesTab'
import ChildInquiriesTab from './components/childinquiries/ChildInquiriesTab'
import ParentModelsPanel from './components/parentmodels/ParentModelsPanel'
import TaskStatusControl from './components/tasks/TaskStatusControl'
import NewTaskModal from './NewTaskModal'
import ProjectGantt from './components/ProjectGantt'
import {
  CONTROLLABLE_TABS,
  DEFAULT_CLIENT_TAB_VISIBILITY,
  isClientTabVisible,
} from './lib/clientTabVisibility'
import './ProjectDetail.css'

/* Lookup: manager tab id → CONTROLLABLE_TABS entry (or undefined). Used
   in the tab bar to know whether a given tab gets the person icon + the
   right-click "הצג ללקוח" menu, or is non-controllable. */
const CONTROLLABLE_BY_MANAGER_ID = Object.fromEntries(
  CONTROLLABLE_TABS.map(t => [t.managerTabId, t])
)

/* Small Feather-style person icon used in the tab-bar visibility
   affordance. Rendered ONLY when the controllable tab is currently
   visible to the client. Hidden tabs show nothing (no off-variant). */
const IconUser = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

const STAGE_COLORS = {
  'קליטת פרויקט':  { bg: '#f0f0f0', text: '#000' },
  'סקיצות':        { bg: '#e8e197', text: '#000' },   /* TODO(stage-rename): drop after migration */
  'סקיצות והדמיות': { bg: '#e8e197', text: '#000' },
  'הדמיה':         { bg: '#cbc9a2', text: '#000' },   /* TODO(stage-rename): drop after migration */
  'גרמושקה':       { bg: '#73946e', text: '#fff' },
  'רישוי':         { bg: '#7bc1b5', text: '#000' },
  'תכניות עבודה':  { bg: '#676977', text: '#fff' },
  'בניה':          { bg: '#89748b', text: '#fff' },
  'גמר':           { bg: '#87526d', text: '#fff' },
  'השהייה':        { bg: '#bcaaae', text: '#000' },
}

const PdIconTrash2 = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
)

/* ── Notes cell ──
   Two separate things share this cell:

     1. A DERIVED link back to the meeting summary, shown whenever the
        task carries meeting_summary_id. The FK is the source of truth —
        nothing is stored in `notes`, so the column stays free for real
        notes and the href can never go stale.
     2. Whatever text the user typed, rendered below it.

   The whole <td> is an edit trigger (PdEditCell's onClick), so every
   anchor MUST stopPropagation — otherwise clicking one opens the inline
   editor instead of navigating. Internal paths go through the router,
   not a raw href, so there is no full page reload. Clicking anywhere
   else in the cell still starts editing, exactly as before. */

/* A link inside typed text: a full http(s) URL, or an app-relative path
   starting with "/". The path form only counts at the start of a token,
   otherwise plain text like "24/7" or "1/2 מהתקציב" would linkify its
   tail. */
const PD_LINK_RE = /(https?:\/\/\S+|\/\S+)/g

function pdSplitNotes(value) {
  const out = []
  let last = 0
  for (const m of value.matchAll(PD_LINK_RE)) {
    const start = m.index
    const before = start === 0 ? '' : value[start - 1]
    /* "/..." only starts a link at a token boundary. */
    if (m[0][0] === '/' && before !== '' && !/\s/.test(before)) continue
    if (start > last) out.push({ text: value.slice(last, start), link: false })
    out.push({ text: m[0], link: true })
    last = start + m[0].length
  }
  if (last < value.length) out.push({ text: value.slice(last), link: false })
  return out
}

function PdNotesText({ text, navigate }) {
  const value = text || ''
  if (!value) return null
  return (
    <span className="tasks-cell-value">
      {pdSplitNotes(value).map((part, i) => {
        if (!part.link) return <span key={i}>{part.text}</span>
        const internal = part.text.startsWith('/')
        return (
          <a
            key={i}
            className="tasks-cell-link"
            href={part.text}
            onClick={(e) => {
              /* Keep the click off the cell's edit trigger. */
              e.stopPropagation()
              if (internal) {
                e.preventDefault()
                navigate(part.text)
              }
            }}
            {...(internal ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
          >
            {part.text}
          </a>
        )
      })}
    </span>
  )
}

/* The cell itself. A task with no meeting_summary_id renders exactly
   what it rendered before — just the notes text, no link, no extra
   wrapper. Exported so the general /tasks table (Tasks.jsx) can reuse
   the exact same rendering for the same notes column, instead of a
   second, drifting implementation. */
export function PdNotesCell({ task, navigate }) {
  const summaryId = task.meeting_summary_id
  if (!summaryId) return <PdNotesText text={task.notes} navigate={navigate} />

  const href = buildMeetingDeepLink(task.project_id, summaryId)
  return (
    <span className="tasks-cell-value tasks-cell-stack">
      <a
        className="tasks-cell-link tasks-meeting-link"
        href={href}
        onClick={(e) => {
          /* Keep the click off the cell's edit trigger. */
          e.stopPropagation()
          e.preventDefault()
          navigate(href)
        }}
      >
        למעבר לסיכום הפגישה לחץ כאן
      </a>
      <PdNotesText text={task.notes} navigate={navigate} />
    </span>
  )
}

// ── Tasks tab inline edit cell ──
// At module scope to prevent cursor-jump bug (inner function definition
// caused remount + autoFocus on every keystroke).
function PdEditCell({ task, field, className, children,
  pdEditingCell, pdEditValue, setPdEditValue,
  pdSaveEdit, pdHandleEditKey, pdTaskStages, pdUsers, pdStartEdit }) {
  const isEditing = pdEditingCell?.taskId === task.id && pdEditingCell?.field === field
  if (isEditing) {
    if (field === 'stage_id') {
      return (
        <td className={className}>
          <select className="tasks-cell-input" value={pdEditValue}
            onChange={e => setPdEditValue(e.target.value)}
            onBlur={pdSaveEdit} onKeyDown={pdHandleEditKey} autoFocus>
            <option value="">—</option>
            {pdTaskStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </td>
      )
    }
    if (field === 'responsible_id') {
      return (
        <td className={className}>
          <select className="tasks-cell-input" value={pdEditValue}
            onChange={e => setPdEditValue(e.target.value)}
            onBlur={pdSaveEdit} onKeyDown={pdHandleEditKey} autoFocus>
            <option value="">—</option>
            {pdUsers.map(u => (
              <option key={u.id} value={u.id}>{u.first_name}</option>
            ))}
          </select>
        </td>
      )
    }
    if (field === 'due_date') {
      return (
        <td className={className}>
          <input type="date" className="tasks-cell-input" value={pdEditValue || ''}
            onChange={e => setPdEditValue(e.target.value)}
            onBlur={pdSaveEdit} onKeyDown={pdHandleEditKey} autoFocus />
        </td>
      )
    }
    return (
      <td className={className}>
        <input className="tasks-cell-input" value={pdEditValue}
          onChange={e => setPdEditValue(e.target.value)}
          onBlur={pdSaveEdit} onKeyDown={pdHandleEditKey} autoFocus />
      </td>
    )
  }
  const editInitValue = field === 'stage_id' ? (task.stage_id ?? '') : (task[field] ?? '')
  return (
    <td className={className} onClick={() => pdStartEdit(task.id, field, editInitValue)}>
      {children}
    </td>
  )
}

/* Fixed id for the parent-projects-only "פרויקטי בנים" tab — appended
   to TABS conditionally at render time (see visibleTabs below), never
   part of the static TABS array since it must only show for projects
   flagged is_parent_project. */
const CHILD_INQUIRIES_TAB_ID = 12
const MODELS_TAB_ID = 13

const TABS = [
  { id: 5, label: 'משימות' },
  { id: 1, label: 'פרטי תיק' },
  { id: 3, label: 'מעקב פרויקט' },
  /* Id comes from the meetings module so the deep links it builds
     (?tab=…) can never drift from the tab they're meant to open. */
  { id: MEETINGS_TAB_ID, label: 'סיכומי פגישות' },
  { id: 2, label: 'מעקב מסמכים' },
  { id: 6, label: 'כתב כמויות' },
  { id: 7, label: 'חומרי גמר' },
  { id: 9, label: 'מפרט לקבלן' },
  { id: 10, label: 'מרחב משותף' },
  { id: 8, label: 'שלבי התקדמות' },
]

/* Tabs hidden entirely for parent projects — construction-detail tabs
   that don't apply to a project whose only "content" is its models and
   child inquiries. Gated on is_parent_project alone (never on
   parent_project_id — a project can in theory be both). */
const PARENT_HIDDEN_TAB_IDS = [10, 8, 6, 9, 7] // מרחב משותף, שלבי התקדמות, כתב כמויות, מפרט לקבלן, חומרי גמר

/* ── Professional roles (card 3) ── */
const PROF_ROLES = [
  { label: 'אחראית פרויקט',   profession: 'אחראית פרויקט',   idField: 'project_manager_id', source: 'employees' },
  { label: 'מודד',             profession: 'מודד',             idField: 'surveyor_id' },
  { label: 'קונסטרוקטור',      profession: 'קונסטרוקטור',      idField: 'constructor_id' },
  { label: 'מהנדס אינסטלציה',  profession: 'מהנדס אינסטלציה',  idField: 'plumbing_engineer_id' },
  { label: 'יועץ קרקע',        profession: 'יועץ קרקע',        idField: 'soil_consultant_id' },
  { label: 'קבלן',             profession: 'קבלן',             idField: 'contractor_id' },
  { label: 'מפקח',             profession: 'מפקח',             idField: 'supervisor_id' },
]

/* InlineField moved to src/components/InlineField.jsx so the project-
   settings modal can use the same control. Pure move — every call site
   below passes exactly what it always did, and the component's defaults
   match the behaviour that lived here. */

/* ── Main component ── */
function ProjectDetail() {
  const { id }      = useParams()
  const navigate    = useNavigate()
  const location    = useLocation()
  const fromTasks   = location.state?.from === 'tasks'
  const fromArchive = location.state?.fromArchive === true

  /* ── Deep-link params (READ-ONLY) ──
     `?tab=<id>&summary=<uuid>` opens this page straight on a tab with
     one meeting summary expanded — that is what the משימות tab's
     "למעבר לסיכום הפגישה" link points at.

     Read-only in one direction only: we never WRITE the URL when the
     user switches tabs by hand, so the back-navigation flows that
     depend on location.state (fromTasks / fromArchive) are untouched.
     An absent or unknown tab id falls back to today's default (1). */
  const deepLink = (() => {
    const params  = new URLSearchParams(location.search)
    const rawTab  = Number(params.get('tab'))
    const validTab = TABS.some(t => t.id === rawTab) ? rawTab : null
    return { tab: validTab, summaryId: params.get('summary') || null }
  })()

  const [project, setProject]       = useState(null)
  const [userRole, setUserRole]     = useState(null)
  const [activeTab, setActiveTab]   = useState(deepLink.tab ?? 1)
  /* The useState above only runs on MOUNT, and the notes-cell link
     points at the project we are usually already on, so React Router
     reuses this component and never remounts it. This effect is what
     makes the link work at all.

     Keyed on location.KEY, not on location.search. The tasks link below
     switches tab in component state and deliberately leaves the URL
     alone, so after the first meeting link the address bar keeps
     ?tab=11&summary=… forever. Clicking the meeting link again then
     navigates to a byte-identical URL — search never changes, and a
     search-keyed effect would never fire again. location.key is a fresh
     token per navigation even when the URL is unchanged, so it tracks
     the navigation itself rather than the string.

     Manual tab switches perform NO navigation, so they mint no new key
     and are still never overridden.

     Falls back to today's default (1, פרטי תיק) rather than only acting
     when deepLink.tab is set — otherwise a navigation with no ?tab=
     param (e.g. double-clicking a converted row in "פרויקטי בנים", or
     the "פרויקט בן של X" parent link) would leave activeTab at whatever
     tab id happened to be active on the PREVIOUS project, which may not
     even exist as a tab here (e.g. a parent-only tab id on a non-parent
     project) and render nothing at all. */
  useEffect(() => {
    setActiveTab(deepLink.tab ?? 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])
  /* Sub-header collapse — hides the parent/child subtitle line, the
     stage/archive badge, and the favorite star to free vertical space
     while writing a summary. Project name + back link stay visible.
     Default EXPANDED; local state only, not persisted. */
  const [subHeaderCollapsed, setSubHeaderCollapsed] = useState(false)
  const [contacts, setContacts]     = useState([])
  const [clientInfo, setClientInfo] = useState(null)

  /* Per-project client drawer visibility. jsonb on projects, fallback to
     DEFAULT_CLIENT_TAB_VISIBILITY (see src/lib/clientTabVisibility.js).
     Toggled via right-click on a controllable tab — saved immediately. */
  const [clientVisibleTabs, setClientVisibleTabs] = useState(null)

  /* Tab right-click context menu state — { x, y, clientKey } when open. */
  const [tabContextMenu, setTabContextMenu] = useState(null)
  const tabMenuRef = useRef(null)

  /* professionals list */
  const [profList, setProfList] = useState([])

  /* shared professional modal */
  const [profModalOpen, setProfModalOpen]       = useState(false)
  const [profModalEditRow, setProfModalEditRow] = useState(null)

  /* selection popover */
  const [selectionPopover, setSelectionPopover] = useState(null)

  // ── Tasks tab state ──
  const [pdTasks,        setPdTasks]        = useState([])
  const [pdUsers,        setPdUsers]        = useState([])
  const [pdTaskStages,   setPdTaskStages]   = useState([])
  const [pdTaskStatuses, setPdTaskStatuses] = useState([])
  const [pdLoading,      setPdLoading]      = useState(false)

  const [pdFilterAssignee, setPdFilterAssignee] = useState('')
  const [pdFilterStage,    setPdFilterStage]    = useState('')
  const [pdFilterStatus,   setPdFilterStatus]   = useState('')
  const [pdEditingCell, setPdEditingCell] = useState(null)
  const [pdEditValue,   setPdEditValue]   = useState('')
  const [pdConfirmDeleteId,  setPdConfirmDeleteId]  = useState(null)
  const [pdDeletePopoverPos, setPdDeletePopoverPos] = useState({ top: 0, left: 0 })
  const pdDeletePopoverRef = useRef(null)
  const [pdShowNewTask, setPdShowNewTask] = useState(false)
  const [pdTaskToast,   setPdTaskToast]   = useState(false)

  /* ── Tab right-click menu — click-outside dismisses, mirrors the
     pattern used by ProjectsKanban's card context menu. ── */
  useEffect(() => {
    if (!tabContextMenu) return
    const handleClickOutside = (e) => {
      if (tabMenuRef.current && !tabMenuRef.current.contains(e.target)) {
        setTabContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [tabContextMenu])

  /* Open the right-click menu next to the clicked tab. Only fires on
     controllable tabs (the caller already filters). Edge-aware: nudges
     the menu in-bounds at the right/bottom of the viewport. */
  const handleTabContextMenu = (e, clientKey) => {
    e.preventDefault()
    const menuW = 200, menuH = 60
    const x = e.clientX + menuW > window.innerWidth  ? e.clientX - menuW : e.clientX
    const y = e.clientY + menuH > window.innerHeight ? e.clientY - menuH : e.clientY
    setTabContextMenu({ x, y, clientKey })
  }

  /* Toggle a single controllable tab's client visibility. Builds the
     next jsonb object by merging DEFAULTS with the live state and
     overriding just the clicked key, then writes it. Optimistic UI: the
     icon flips immediately; on DB failure we revert. */
  const handleToggleClientTab = async (clientKey, nextValue) => {
    const prev = clientVisibleTabs
    const merged = { ...DEFAULT_CLIENT_TAB_VISIBILITY, ...(clientVisibleTabs || {}) }
    const nextObj = { ...merged, [clientKey]: nextValue }
    setClientVisibleTabs(nextObj)
    try {
      const { error } = await supabase
        .from('projects')
        .update({ client_visible_tabs: nextObj })
        .eq('id', id)
      if (error) throw error
    } catch (err) {
      console.error('ProjectDetail — client_visible_tabs save failed:', err)
      setClientVisibleTabs(prev)   /* revert on failure */
    }
  }

  /* ── fetch project ── */
  useEffect(() => {
    const fetchProject = async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, stage_id, stages!stage_id(name), is_favorite, gantt_state, responsible_id, parent_project_id, is_parent_project, client_visible_tabs, selected_model_id')
        .eq('id', id)
        .single()
      if (data) {
        setProject(data)
        setClientVisibleTabs(data.client_visible_tabs || null)
      }
    }
    fetchProject()
  }, [id])

  /* ── Parent / child relationship (2-level rule, mutually exclusive).
     parentInfo: { id, name } when THIS project is a child.
     childCount: real, live count of non-archived children — still always
     computed the same way regardless of is_parent_project, since a
     boolean flag can't supply a count. The subtitle line's VISIBILITY,
     though, now reads project.is_parent_project directly (see below)
     rather than childCount > 0, so a flagged parent with zero children
     still shows "פרויקט אב של 0 פרויקטים" instead of nothing. ── */
  const [parentInfo, setParentInfo] = useState(null)
  const [childCount, setChildCount] = useState(0)
  useEffect(() => {
    if (!project) return
    let cancelled = false
    const run = async () => {
      if (project.parent_project_id) {
        const { data } = await supabase
          .from('projects')
          .select('id, name')
          .eq('id', project.parent_project_id)
          .single()
        if (!cancelled) {
          setParentInfo(data || null)
          setChildCount(0)
        }
      } else {
        const { count } = await supabase
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .eq('parent_project_id', project.id)
          .eq('archived', false)
        if (!cancelled) {
          setParentInfo(null)
          setChildCount(count || 0)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [project])

  /* ── פרטי דגם: models belonging to THIS project's parent, only
     relevant when this project is a child. Scoped strictly to
     parent_project_id — never this project's own id. ── */
  const [parentModels, setParentModels] = useState([])
  useEffect(() => {
    if (!project?.parent_project_id) { setParentModels([]); return }
    let cancelled = false
    const loadParentModels = async () => {
      const { data } = await supabase
        .from('project_models')
        .select('id, name')
        .eq('project_id', project.parent_project_id)
        .order('created_at', { ascending: true })
      if (!cancelled) setParentModels(data || [])
    }
    loadParentModels()
    return () => { cancelled = true }
  }, [project?.parent_project_id])

  /* ── fetch employees (for "אחראית פרויקט") ── */
  const [employees, setEmployees] = useState([])
  useEffect(() => {
    const fetchEmployees = async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, first_name, last_name')
        .in('role', ['admin', 'employee'])
        .order('first_name')
      if (data) setEmployees(data)
    }
    fetchEmployees()
  }, [])

  /* ── fetch current user role ── */
  useEffect(() => {
    const fetchRole = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (profile) setUserRole(profile.role)
    }
    fetchRole()
  }, [])

  /* ── fetch tab-1 data ── */
  useEffect(() => {
    const fetchTabData = async () => {
      const [{ data: c }, { data: ci }] = await Promise.all([
        supabase.from('project_contacts').select('*').eq('project_id', id).order('created_at'),
        supabase.from('client_info').select('*').eq('project_id', id).maybeSingle(),
      ])
      if (c)  setContacts(c)
      if (ci) setClientInfo(ci)
    }
    fetchTabData()
  }, [id])

  /* ── fetch professionals list ── */
  useEffect(() => {
    const fetchProfessionals = async () => {
      const { data } = await supabase
        .from('professionals')
        .select('id, first_name, last_name, profession')
        .order('first_name')
      if (data) setProfList(data)
    }
    fetchProfessionals()
  }, [])

  /* ── delete popover click-outside ── */
  useEffect(() => {
    if (!pdConfirmDeleteId) return
    function handler(e) {
      if (pdDeletePopoverRef.current && !pdDeletePopoverRef.current.contains(e.target)) {
        setPdConfirmDeleteId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pdConfirmDeleteId])

  /* ── tasks tab fetch ── */
  useEffect(() => {
    if (activeTab !== 5) return
    const load = async () => {
      setPdLoading(true)
      const [{ data: t }, { data: u }, { data: stg }, { data: sts }] = await Promise.all([
        supabase
          .from('tasks')
          .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name), task_statuses!status_id(id, name, color)')
          .eq('project_id', id)
          .or('archived.eq.false,archived.is.null')
          .order('created_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, first_name')
          .in('role', ['admin', 'employee'])
          .order('first_name'),
        supabase.from('stages').select('id, name').order('order_index'),
        supabase.from('task_statuses').select('id, name, color').order('id'),
      ])
      setPdTasks(t || [])
      setPdUsers(u || [])
      setPdTaskStages((stg || []).filter(s => s.id !== 9))
      setPdTaskStatuses(sts || [])
      setPdLoading(false)
    }
    load()
  }, [activeTab, id])

  /* ── Contact helpers ── */
  /* Writes the field, then mirrors it into `contacts` — the same
     write-then-patch-local-state shape every other handler here uses.

     The local update is not cosmetic. Tab 1's data lives on THIS
     component, which stays mounted while the tab content itself is
     unmounted and remounted by the `activeTab === 1` switch, and the
     fetch that would refresh it is keyed on [id] so it doesn't re-run
     on a tab change. Without this line the saved value reached the DB
     but never the state, so coming back to the tab re-seeded the field
     from the pre-save value and the edit looked lost until a refresh. */
  const saveContact = async (contactId, field, val) => {
    const { error } = await supabase
      .from('project_contacts')
      .update({ [field]: val })
      .eq('id', contactId)
    if (error) {
      console.error('ProjectDetail — contact save failed:', error)
      return
    }
    setContacts(prev => prev.map(c => (c.id === contactId ? { ...c, [field]: val } : c)))
  }

  const addContact = async () => {
    const { data } = await supabase
      .from('project_contacts')
      .insert([{ project_id: id, first_name: '', last_name: '', id_number: '', phone: '', email: '' }])
      .select()
      .single()
    if (data) setContacts(prev => [...prev, data])
  }

  const deleteContact = async (contactId) => {
    await supabase.from('project_contacts').delete().eq('id', contactId)
    setContacts(prev => prev.filter(c => c.id !== contactId))
  }

  /* ── Project responsible helper (אחראית פרויקט) ── */
  const saveResponsible = async (newId) => {
    const value = newId || null
    await supabase.from('projects').update({ responsible_id: value }).eq('id', id)
    setProject(prev => prev ? { ...prev, responsible_id: value } : prev)
  }

  /* ── פרטי דגם: save this (child) project's chosen model ── */
  const saveSelectedModel = async (newId) => {
    const value = newId || null
    await supabase.from('projects').update({ selected_model_id: value }).eq('id', id)
    setProject(prev => prev ? { ...prev, selected_model_id: value } : prev)
  }

  /* ── Client info helper ── */
  const saveClientInfo = async (field, val) => {
    const value = val === '' ? null : val
    if (clientInfo?.id) {
      await supabase.from('client_info').update({ [field]: value }).eq('id', clientInfo.id)
      setClientInfo(prev => ({ ...prev, [field]: value }))
    } else {
      const { data } = await supabase
        .from('client_info')
        .insert([{ project_id: id, [field]: value }])
        .select()
        .single()
      if (data) setClientInfo(data)
    }
  }

  /* ── Professional modal helpers ── */
  const openProfNew = () => {
    setProfModalEditRow(null)
    setProfModalOpen(true)
  }

  const openProfEdit = async (profId) => {
    const { data } = await supabase.from('professionals').select('*').eq('id', profId).single()
    if (data) {
      setProfModalEditRow(data)
      setProfModalOpen(true)
    }
  }

  const closeProfModal = () => {
    setProfModalOpen(false)
    setProfModalEditRow(null)
  }

  const handleProfSaved = async (row, isNew) => {
    const slim = { id: row.id, first_name: row.first_name, last_name: row.last_name, profession: row.profession }
    if (isNew) {
      setProfList(prev => [...prev, slim])
      const role = PROF_ROLES.find(r => r.profession === row.profession)
      if (role && !clientInfo?.[role.idField]) {
        await saveClientInfo(role.idField, row.id)
      }
    } else {
      setProfList(prev => prev.map(p => p.id === row.id ? slim : p))
    }
    closeProfModal()
  }

  const handleProfDeleted = async (profId) => {
    setProfList(prev => prev.filter(p => p.id !== profId))
    const clearedFields = {}
    PROF_ROLES.forEach(role => {
      if (clientInfo?.[role.idField] === profId) clearedFields[role.idField] = null
    })
    if (Object.keys(clearedFields).length > 0 && clientInfo?.id) {
      await supabase.from('client_info').update(clearedFields).eq('id', clientInfo.id)
      setClientInfo(prev => ({ ...prev, ...clearedFields }))
    }
    closeProfModal()
  }

  /* ── Tasks tab handlers ── */
  async function handlePdStatusChange(taskId, newStatusId, newStatusName) {
    const { error } = await supabase.from('tasks').update({ status_id: newStatusId }).eq('id', taskId)
    if (!error) setPdTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, status_id: newStatusId, task_statuses: { id: newStatusId, name: newStatusName } }
        : t
    ))
  }

  function pdStartEdit(taskId, field, current) {
    setPdEditingCell({ taskId, field })
    setPdEditValue(current ?? '')
  }

  async function pdSaveEdit() {
    if (!pdEditingCell) return
    const { taskId, field } = pdEditingCell
    const value = pdEditValue === '' ? null : pdEditValue

    if (field === 'stage_id') {
      const stageId = value ? Number(value) : null
      const { error } = await supabase.from('tasks').update({ stage_id: stageId }).eq('id', taskId)
      if (!error) {
        const stageObj = pdTaskStages.find(s => s.id === stageId)
        setPdTasks(prev => prev.map(t => t.id === taskId
          ? { ...t, stage_id: stageId, stages: stageObj ? { id: stageObj.id, name: stageObj.name } : null }
          : t
        ))
      }
    } else if (field === 'responsible_id') {
      const { error } = await supabase.from('tasks').update({ responsible_id: value }).eq('id', taskId)
      if (!error) {
        const user = pdUsers.find(u => u.id === value)
        setPdTasks(prev => prev.map(t => t.id === taskId
          ? { ...t, responsible_id: value, profiles: user ? { first_name: user.first_name } : null }
          : t
        ))
      }
    } else {
      const { error } = await supabase.from('tasks').update({ [field]: value }).eq('id', taskId)
      if (!error) setPdTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t))
    }
    setPdEditingCell(null)
    setPdEditValue('')
  }

  function pdHandleEditKey(e) {
    if (e.key === 'Enter')  pdSaveEdit()
    if (e.key === 'Escape') { setPdEditingCell(null); setPdEditValue('') }
  }

  async function pdDoDelete(taskId) {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId)
    if (!error) setPdTasks(prev => prev.filter(t => t.id !== taskId))
    setPdConfirmDeleteId(null)
  }

  function pdHandleTaskSaved() {
    setPdTaskToast(true)
    setTimeout(() => setPdTaskToast(false), 2500)
    supabase
      .from('tasks')
      .select('*, profiles!responsible_id(first_name, last_name), stages!stage_id(id, name), task_statuses!status_id(id, name, color)')
      .eq('project_id', id)
      .or('archived.eq.false,archived.is.null')
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (data) setPdTasks(data) })
  }

  function pdFormatDate(d) {
    if (!d) return ''
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  /* ── Favorite toggle ── */
  const toggleFavorite = async () => {
    const next = !project?.is_favorite
    setProject(prev => ({ ...prev, is_favorite: next }))
    await supabase.from('projects').update({ is_favorite: next }).eq('id', id)
  }

  /* Read through stage_id, not the drifting current_stage copy. */
  const stageName  = project?.stages?.name || null
  const stageColor = stageName
    ? STAGE_COLORS[stageName] || { bg: '#e0e0e0', text: '#000' }
    : null

  /* Parent projects: hide the construction-detail tabs that don't apply,
     and append the two parent-only tabs (models, then the inquiries that
     reference them) — kept out of the static TABS array since both only
     show for projects flagged is_parent_project. */
  const visibleTabs = project?.is_parent_project
    ? [
        ...TABS.filter(t => !PARENT_HIDDEN_TAB_IDS.includes(t.id)),
        { id: MODELS_TAB_ID, label: 'דגמים' },
        { id: CHILD_INQUIRIES_TAB_ID, label: 'פרויקטי בנים' },
      ]
    : TABS

  /* ── Committee fields ── */
  const committeeFields = [
    { label: 'ועדה',                      field: 'committee' },
    { label: 'בודקת',                     field: 'checker' },
    { label: 'תיק מידע רישוי זמין',       field: 'info_license_file' },
    { label: 'תיק בניין',                 field: 'building_file' },
    { label: 'מספר בקשה פנימי/ועדה',      field: 'internal_request_num' },
    { label: 'מספר בקשה רישוי זמין',      field: 'available_license_num' },
    { label: 'תיק הג"א',                  field: 'civil_defense_file' },
    { label: 'מהות הבקשה',               field: 'request_essence', multiline: true },
  ]

  // ── Tasks tab computed values ──
  const pdDistinctResponsibles = Object.values(
    pdTasks.reduce((acc, t) => {
      if (t.responsible_id && t.profiles?.first_name && !acc[t.responsible_id]) {
        acc[t.responsible_id] = { id: t.responsible_id, firstName: t.profiles.first_name }
      }
      return acc
    }, {})
  ).sort((a, b) => a.firstName.localeCompare(b.firstName))

  const pdFiltered = pdTasks.filter(t => {
    if (pdFilterAssignee && t.responsible_id !== pdFilterAssignee) return false
    if (pdFilterStage    && String(t.stage_id) !== pdFilterStage) return false
    if (pdFilterStatus   && String(t.status_id) !== pdFilterStatus) return false
    return true
  })

  const pdAnyFilter = !!(pdFilterAssignee || pdFilterStage || pdFilterStatus)

  // Props forwarded to the module-scope PdEditCell component
  const pdEditCellProps = {
    pdEditingCell, pdEditValue, setPdEditValue,
    pdSaveEdit, pdHandleEditKey, pdTaskStages, pdUsers, pdStartEdit,
  }

  return (
    <div className="pd-page" dir="rtl">

      {/* ── Header ── */}
      <div className={'pd-header' + (subHeaderCollapsed ? ' pd-header--collapsed' : '')}>
        <div className="pd-header-left">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            {/* Title row — chevron toggle + project name. In this RTL
                flex row, the FIRST child lands on the visual-RIGHT, so
                putting the chevron first makes it sit to the right of
                the name (start-of-line in Hebrew reading order). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={() => setSubHeaderCollapsed(v => !v)}
                title={subHeaderCollapsed ? 'הרחב פרטי פרויקט' : 'כווץ פרטי פרויקט'}
                aria-expanded={!subHeaderCollapsed}
                aria-label={subHeaderCollapsed ? 'הרחב פרטי פרויקט' : 'כווץ פרטי פרויקט'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 4,
                  cursor: 'pointer',
                  color: '#7a9478',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width="16" height="16" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round"
                  style={{
                    transform: subHeaderCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                  }}
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <h1 className="pd-title" style={{ margin: 0 }}>{project ? project.name : '…'}</h1>
            </div>
            {!subHeaderCollapsed && parentInfo && (
              <span
                onClick={() => navigate(`/projects/${project.parent_project_id}`)}
                style={{
                  color: '#8a8680',
                  fontSize: 13,
                  cursor: 'pointer',
                  marginTop: 2,
                  textDecoration: 'none',
                }}
                onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
              >
                פרויקט בן של {parentInfo.name}
              </span>
            )}
            {!subHeaderCollapsed && !parentInfo && project?.is_parent_project && (
              <span
                onClick={() => navigate(`/פרויקטים/אב/${id}`)}
                style={{
                  color: '#8a8680',
                  fontSize: 13,
                  cursor: 'pointer',
                  marginTop: 2,
                  textDecoration: 'none',
                }}
                onMouseEnter={e => { e.currentTarget.style.textDecoration = 'underline' }}
                onMouseLeave={e => { e.currentTarget.style.textDecoration = 'none' }}
              >
                פרויקט אב של {childCount} פרויקטים
              </span>
            )}
          </div>
          {!subHeaderCollapsed && project && !fromArchive && (
            <button className="pd-star-btn" onClick={toggleFavorite} title={project.is_favorite ? 'הסר מהמועדפים' : 'הוסף למועדפים'}>
              {project.is_favorite ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#F6BF26" stroke="#F6BF26" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              )}
            </button>
          )}
          {!subHeaderCollapsed && (fromArchive ? (
            <span className="pd-stage-badge" style={{ background: '#E24B4A', color: '#fff' }}>
              ארכיון
            </span>
          ) : (
            stageName && stageColor && (
              <span className="pd-stage-badge" style={{ background: stageColor.bg, color: stageColor.text }}>
                {stageName}
              </span>
            )
          ))}
        </div>
        {fromArchive ? (
          <button className="pd-back-btn" onClick={() => navigate('/פרויקטים', { state: { showArchive: true } })}>
            ← חזור לארכיון
          </button>
        ) : fromTasks ? (
          <button className="pd-back-btn" onClick={() => navigate('/tasks')}>
            ← חזור לניהול משימות
          </button>
        ) : (
          <button
            className="pd-back-btn"
            onClick={() => navigate(
              project?.parent_project_id
                ? `/פרויקטים/אב/${project.parent_project_id}`
                : '/פרויקטים'
            )}
          >
            → חזרה לפרויקטים
          </button>
        )}
      </div>

      {/* ── Archive read-only banner ── */}
      {fromArchive && (
        <div className="pd-archive-banner">
          פרויקט בארכיון — מצב קריאה בלבד
        </div>
      )}

      {/* ── Tabs bar ── */}
      <div className="pd-tabs-bar">
        {visibleTabs.map(tab => {
          const ctrl    = CONTROLLABLE_BY_MANAGER_ID[tab.id]
          const visible = ctrl ? isClientTabVisible(ctrl.clientKey, clientVisibleTabs) : null
          return (
            <button
              key={tab.id}
              className={
                'pd-tab' +
                (activeTab === tab.id ? ' pd-tab--active' : '') +
                (tab.disabled ? ' pd-tab--disabled' : '')
              }
              onClick={() => { if (!tab.disabled) setActiveTab(tab.id) }}
              onContextMenu={ctrl ? (e) => handleTabContextMenu(e, ctrl.clientKey) : undefined}
              disabled={tab.disabled}
            >
              {tab.label}
              {ctrl && visible && (
                <span
                  className="pd-tab-vis-icon"
                  title="מוצג ללקוח (קליק-ימני לשינוי)"
                >
                  <IconUser size={13} />
                </span>
              )}
              {tab.disabled && <span className="pd-tab-soon">בקרוב</span>}
            </button>
          )
        })}
      </div>

      {/* ── Tab right-click context menu — "הצג ללקוח" toggle. ── */}
      {tabContextMenu && (() => {
        const visible = isClientTabVisible(tabContextMenu.clientKey, clientVisibleTabs)
        return (
          <div
            ref={tabMenuRef}
            className="pd-tab-context-menu"
            style={{ top: tabContextMenu.y, left: tabContextMenu.x }}
          >
            <label className="pd-tab-context-row">
              <input
                type="checkbox"
                checked={visible}
                onChange={async (e) => {
                  const next = e.target.checked
                  setTabContextMenu(null)
                  await handleToggleClientTab(tabContextMenu.clientKey, next)
                }}
              />
              <span>הצג ללקוח</span>
            </label>
          </div>
        )
      })()}

      {/* ── Tab content ── */}
      <div className={`pd-tab-content${activeTab === 5 ? ' pd-tab-content--tasks' : ''}`}>

        {/* ── Tab 5 — משימות ── */}
        {activeTab === 5 && (
          <div className="pd-tasks-tab">
            <div className="tasks-filter-bar">
              <div className="tasks-filter-selects">
                <div className="tasks-filter-group">
                  <span className="tasks-filter-label">אחראית</span>
                  <select className="tasks-filter-select" value={pdFilterAssignee} onChange={e => setPdFilterAssignee(e.target.value)}>
                    <option value="">הכל</option>
                    {pdDistinctResponsibles.map(r => <option key={r.id} value={r.id}>{r.firstName}</option>)}
                  </select>
                </div>
                <div className="tasks-filter-group">
                  <span className="tasks-filter-label">שלב</span>
                  <select className="tasks-filter-select" value={pdFilterStage} onChange={e => setPdFilterStage(e.target.value)}>
                    <option value="">הכל</option>
                    {pdTaskStages.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                  </select>
                </div>
                <div className="tasks-filter-group">
                  <span className="tasks-filter-label">סטטוס</span>
                  <select className="tasks-filter-select" value={pdFilterStatus} onChange={e => setPdFilterStatus(e.target.value)}>
                    <option value="">הכל</option>
                    {pdTaskStatuses.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                  </select>
                </div>
                <div className="tasks-filter-group tasks-filter-group--reset">
                  <button
                    className="tasks-filter-reset"
                    onClick={() => { setPdFilterAssignee(''); setPdFilterStage(''); setPdFilterStatus('') }}
                    disabled={!pdAnyFilter}
                  >
                    בטל סינונים
                  </button>
                </div>
              </div>
              <div className="tasks-filter-actions">
                <button className="tasks-new-btn" onClick={() => setPdShowNewTask(true)}>
                  <span className="tasks-new-btn-icon">+</span>
                  משימה חדשה
                </button>
              </div>
            </div>

            <div className="tasks-table-card">
              <div className="tasks-table-scroll">
                <table className="tasks-table">
                  <thead>
                    <tr>
                      <th className="tasks-col-status"></th>
                      <th className="tasks-col-stage">שלב</th>
                      <th className="tasks-col-desc">תיאור</th>
                      <th className="tasks-col-assignee">אחראית</th>
                      <th className="tasks-col-date">תאריך יעד</th>
                      <th className="tasks-col-notes">הערות</th>
                      <th className="tasks-col-delete"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pdLoading ? (
                      <tr><td colSpan={7} style={{ display: 'block' }}><p className="tasks-empty">טוען...</p></td></tr>
                    ) : pdFiltered.length === 0 ? (
                      <tr><td colSpan={7} style={{ display: 'block' }}><p className="tasks-empty">אין משימות להצגה</p></td></tr>
                    ) : pdFiltered.map(task => {
                      const taskStatusName = task.task_statuses?.name || task.status || 'פעיל'
                      const isUrgent = taskStatusName === 'דחוף'
                      return (
                        <tr key={task.id} className={`tasks-row${isUrgent ? ' tasks-row--urgent' : ''}`}>
                          <td className="tasks-col-status" onClick={e => e.stopPropagation()}>
                            <TaskStatusControl
                              statusId={task.status_id}
                              statusName={taskStatusName}
                              options={pdTaskStatuses}
                              onSelect={(id, name) => handlePdStatusChange(task.id, id, name)}
                            />
                          </td>
                          <PdEditCell {...pdEditCellProps} task={task} field="stage_id" className="tasks-col-stage">
                            <span className="tasks-cell-value">{task.stages?.name || task.stage || ''}</span>
                          </PdEditCell>
                          <PdEditCell {...pdEditCellProps} task={task} field="description" className="tasks-col-desc">
                            <span className="tasks-cell-value">{task.description || ''}</span>
                          </PdEditCell>
                          <PdEditCell {...pdEditCellProps} task={task} field="responsible_id" className="tasks-col-assignee">
                            <span className="tasks-cell-value">{task.profiles?.first_name || ''}</span>
                          </PdEditCell>
                          <PdEditCell {...pdEditCellProps} task={task} field="due_date" className="tasks-col-date">
                            <span className="tasks-cell-value">{pdFormatDate(task.due_date)}</span>
                          </PdEditCell>
                          <PdEditCell {...pdEditCellProps} task={task} field="notes" className="tasks-col-notes">
                            <PdNotesCell task={task} navigate={navigate} />
                          </PdEditCell>
                          <td className="tasks-col-delete" onClick={e => e.stopPropagation()}>
                            <button
                              className="tasks-delete-btn"
                              onClick={e => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                setPdDeletePopoverPos({ top: rect.bottom + 4, left: rect.left })
                                setPdConfirmDeleteId(task.id)
                              }}
                            >
                              <PdIconTrash2 />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 1 — פרטי תיק ── */}
        {activeTab === 1 && (
          <div className="pd-tab1-grid">

            <div className="pd-info-cards-row">

              {/* Right 50%: פרטים אישיים, with פרטי דגם stacked directly below it */}
              <div className="pd-info-col">
              <div className="pd-info-card">
                <div className="pd-card-title">פרטים אישיים</div>

                {contacts.length > 0 && (
                  <div className="pd-contact-header">
                    <span className="pd-contact-col-label">שם פרטי</span>
                    <span className="pd-contact-col-label">שם משפחה</span>
                    <span className="pd-contact-col-label">ת.ז</span>
                    <span className="pd-contact-col-label">טלפון</span>
                    <span className="pd-contact-col-label">מייל</span>
                    <span />
                  </div>
                )}

                {contacts.map(contact => (
                  <div key={contact.id} className="pd-contact-row">
                    <InlineField value={contact.first_name} placeholder="שם פרטי" onSave={val => saveContact(contact.id, 'first_name', val)} readOnly={fromArchive} />
                    <InlineField value={contact.last_name} placeholder="שם משפחה" onSave={val => saveContact(contact.id, 'last_name', val)} readOnly={fromArchive} />
                    <InlineField value={contact.id_number} placeholder="ת.ז" onSave={val => saveContact(contact.id, 'id_number', val)} readOnly={fromArchive} />
                    <InlineField value={contact.phone} placeholder="טלפון" type="tel" onSave={val => saveContact(contact.id, 'phone', val)} readOnly={fromArchive} />
                    <InlineField value={contact.email} placeholder="מייל" type="email" onSave={val => saveContact(contact.id, 'email', val)} readOnly={fromArchive} />
                    {!fromArchive && (
                      <button className="pd-delete-btn" onClick={() => deleteContact(contact.id)} title="מחק איש קשר">×</button>
                    )}
                  </div>
                ))}

                {!fromArchive && (
                  <button className="pd-add-btn" onClick={addContact}>+ הוסף איש קשר</button>
                )}
              </div>

              {/* פרטי דגם — only for child projects (non-null parent_project_id),
                  stacked directly below פרטים אישיים in the same column.
                  Dropdown scoped strictly to the PARENT's project_models. */}
              {project?.parent_project_id && (
                <div className="pd-info-card">
                  <div className="pd-card-title">פרטי דגם</div>
                  {parentModels.length === 0 ? (
                    <span className="pd-field-value pd-field-empty" style={{ cursor: 'default', display: 'inline-block' }}>
                      לפרויקט האב אין עדיין דגמים מוגדרים
                    </span>
                  ) : (
                    <div className="pd-field-row">
                      <span className="pd-field-label">דגם</span>
                      <div className="pd-field-cell">
                        <select
                          className="pd-field-input"
                          value={project.selected_model_id || ''}
                          onChange={e => saveSelectedModel(e.target.value)}
                          disabled={fromArchive}
                        >
                          <option value="">— בחר דגם —</option>
                          {parentModels.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>{/* end pd-info-col */}

              {/* Middle 25%: פרטי מגרש */}
              <div className="pd-info-card">
                <div className="pd-card-title">פרטי מגרש</div>
                {[
                  { label: 'ישוב',               field: 'city' },
                  { label: 'גוש',                field: 'gush' },
                  { label: 'חלקה',               field: 'helka' },
                  { label: 'מגרש',               field: 'migrash' },
                  { label: 'שטח המגרש',          field: 'area' },
                  { label: 'תוכניות חלות במקום', field: 'active_plans', multiline: true },
                ].map(({ label, field, multiline }) => (
                  <div key={field} className="pd-field-row">
                    <span className="pd-field-label">{label}</span>
                    <div className="pd-field-cell">
                      <InlineField value={clientInfo?.[field]} placeholder="—" multiline={multiline} onSave={val => saveClientInfo(field, val)} readOnly={fromArchive} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Left 25%: בעלי מקצוע */}
              <div className="pd-info-card">
                <div className="pd-card-title">בעלי מקצוע</div>
                {PROF_ROLES.map(({ label, profession, idField, source }) => {
                  const isEmp        = source === 'employees'
                  const options      = isEmp ? employees : profList.filter(p => p.profession === profession)
                  const selectedId   = isEmp ? (project?.responsible_id ?? '') : (clientInfo?.[idField] ?? '')
                  const selectedRow  = options.find(p => p.id === selectedId)
                  const fullName     = selectedRow
                    ? `${selectedRow.first_name ?? ''} ${selectedRow.last_name ?? ''}`.trim()
                    : ''
                  return (
                    <div key={idField} className="pd-prof-row">
                      <span className="pd-prof-label">{label}</span>
                      <div className="pd-prof-value-wrap">
                        {selectedId && fullName ? (
                          isEmp ? (
                            <span className="pd-prof-name-btn" style={{ cursor: 'default' }}>{fullName}</span>
                          ) : (
                            <button type="button" className="pd-prof-name-btn" onClick={() => openProfEdit(selectedId)} title="ערוך פרטי בעל מקצוע">
                              {fullName}
                            </button>
                          )
                        ) : (
                          <span className="pd-prof-empty">—</span>
                        )}
                        {selectedId && !fromArchive && (
                          <button type="button" className="pd-prof-clear-btn"
                            onClick={() => isEmp ? saveResponsible(null) : saveClientInfo(idField, '')}
                            title="הסר בחירה">
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              <line x1="10" y1="11" x2="10" y2="17"/>
                              <line x1="14" y1="11" x2="14" y2="17"/>
                            </svg>
                          </button>
                        )}
                        {!fromArchive && <div className="pd-prof-popover-wrap">
                          <button type="button" className="pd-prof-pick-btn" onClick={() => setSelectionPopover(selectionPopover === idField ? null : idField)} title="בחר בעל מקצוע">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/>
                              <line x1="12" y1="8" x2="12" y2="16"/>
                              <line x1="8" y1="12" x2="16" y2="12"/>
                            </svg>
                          </button>
                          {selectionPopover === idField && (
                            <div className="pd-prof-popover">
                              {options.length === 0 ? (
                                <div className="pd-prof-popover-empty">אין בעלי מקצוע במקצוע זה</div>
                              ) : (
                                options.map(p => (
                                  <button key={p.id} type="button" className="pd-prof-popover-item"
                                    onClick={() => {
                                      if (isEmp) saveResponsible(p.id)
                                      else saveClientInfo(idField, p.id)
                                      setSelectionPopover(null)
                                    }}>
                                    {`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || '—'}
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>}
                      </div>
                    </div>
                  )
                })}
                {!fromArchive && (
                  <button type="button" className="pd-add-btn" onClick={openProfNew}>+ הוסף בעל מקצוע חדש</button>
                )}
              </div>

            </div>{/* end pd-info-cards-row */}

            {/* Bottom row: פרטי רישוי full width */}
            <div className="pd-info-card pd-info-card--wide">
              <div className="pd-card-title">פרטי רישוי</div>
              <div className="pd-committee-grid">
                <div className="pd-committee-col">
                  {committeeFields.slice(0, 4).map(({ label, field, multiline }) => (
                    <div key={field} className="pd-field-row">
                      <span className="pd-field-label">{label}</span>
                      <div className="pd-field-cell">
                        <InlineField value={clientInfo?.[field]} placeholder="—" multiline={multiline} onSave={val => saveClientInfo(field, val)} readOnly={fromArchive} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="pd-committee-col">
                  {committeeFields.slice(4).map(({ label, field, multiline }) => (
                    <div key={field} className="pd-field-row">
                      <span className="pd-field-label">{label}</span>
                      <div className="pd-field-cell">
                        <InlineField value={clientInfo?.[field]} placeholder="—" multiline={multiline} onSave={val => saveClientInfo(field, val)} readOnly={fromArchive} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── Tab 2 — מעקב מסמכים ── */}
        {activeTab === 2 && (
          <DocumentsTab projectId={id} isParentProject={!!project?.is_parent_project} />
        )}

        {/* ── Tab 3 — מעקב שלבי התקדמות ── */}
        {activeTab === 3 && (
          <TasksTab projectId={id} />
        )}

        {/* ── Tab 11 — סיכומי פגישות ── */}
        {activeTab === 11 && (
          <MeetingSummariesTab
            projectId={id}
            /* Opens this summary once the list loads (see the
               seeding effect inside the tab). Null when absent. */
            initialOpenSummaryId={deepLink.summaryId}
            /* Fresh per navigation, unchanged by re-renders. Lets the
               accordion tell "the user clicked the link again" apart
               from "React re-rendered", even when the target summary is
               the one already named in the URL. */
            navToken={location.key}
            /* The studio-tasks status is changed in the משימות tab, so
               that block links here. Switches tab in place rather than
               through the URL — the URL is read, never written. */
            onOpenTasksTab={() => setActiveTab(5)}
          />
        )}

        {/* ── Tab 6 — כתב כמויות ── */}
        {activeTab === 6 && (
          <QuantitiesTab projectId={id} />
        )}

        {/* ── Tab 9 — מפרט לקבלן ── */}
        {activeTab === 9 && (
          <ContractorSpecTab projectId={id} />
        )}

        {/* ── Tab 10 — מרחב משותף ── */}
        {activeTab === 10 && (
          <SharedFilesTab projectId={id} />
        )}

        {/* ── Tab 7 — חומרי גמר ── */}
        {activeTab === 7 && (
          <FinishingTab projectId={id} />
        )}

        {/* ── Tab 8 — גאנט ── */}
        {activeTab === 8 && (
          <ProjectGantt
            project={project}
            isAdmin={userRole === 'admin'}
            onStateChange={async (stageId, newStatus) => {
              const newState = { ...project.gantt_state, [stageId]: newStatus }
              await supabase.from('projects').update({ gantt_state: newState }).eq('id', project.id)
              setProject(prev => ({ ...prev, gantt_state: newState }))
            }}
          />
        )}

        {/* ── Tab 13 — דגמים (parent projects only) ── */}
        {activeTab === MODELS_TAB_ID && project?.is_parent_project && (
          <ParentModelsPanel projectId={id} projectName={project?.name} />
        )}

        {/* ── Tab 12 — פרויקטי בנים (parent projects only) ── */}
        {activeTab === CHILD_INQUIRIES_TAB_ID && project?.is_parent_project && (
          <ChildInquiriesTab projectId={id} />
        )}

      </div>{/* end pd-tab-content */}

      {/* ── Popover backdrop ── */}
      {selectionPopover && (
        <div className="pd-prof-backdrop" onClick={() => setSelectionPopover(null)} />
      )}

      {/* ── Professional modal ── */}
      {profModalOpen && (
        <ProfessionalModal
          key={profModalEditRow?.id ?? 'new'}
          editRow={profModalEditRow}
          onClose={closeProfModal}
          onSaved={handleProfSaved}
          onDeleted={handleProfDeleted}
        />
      )}

      {/* ── Tasks tab: delete confirm popover ── */}
      {pdConfirmDeleteId && createPortal(
        <div
          ref={pdDeletePopoverRef}
          className="tasks-delete-popover"
          style={{ position: 'fixed', top: pdDeletePopoverPos.top, left: pdDeletePopoverPos.left, zIndex: 9999 }}
          dir="rtl"
        >
          <span className="tasks-delete-popover-text">מחק משימה?</span>
          <button className="tasks-delete-yes" onClick={() => pdDoDelete(pdConfirmDeleteId)}>מחק</button>
          <button className="tasks-delete-no" onClick={() => setPdConfirmDeleteId(null)}>ביטול</button>
        </div>,
        document.body
      )}

      {/* ── Tasks tab: new task modal ── */}
      {pdShowNewTask && project && (
        <NewTaskModal
          project={project}
          onClose={() => setPdShowNewTask(false)}
          onSaved={pdHandleTaskSaved}
        />
      )}

      {pdTaskToast && (
        <div className="ktm-toast">המשימה נשמרה ✓</div>
      )}


    </div>
  )
}

export default ProjectDetail
