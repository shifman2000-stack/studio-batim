// src/pages/StaffQuestionnaireView.jsx
//
// The FOURTH render context of ClientProgrammingQuestionnaire, and the
// only full-page one. The other three are the client portal, the
// programme-meeting split screen, and the admin mobile client view
// (which renders the whole portal, so the questionnaire reaches it
// through context #1 rather than as its own call site).
//
// Reached from the "שאלון פרוגרמה" link in a project's סיכומי פגישות
// tab. That link CLEARS NOTHING — it only navigates here. Clearing
// happens one side at a time, when a staff member actually clicks into
// the questionnaire or the house-builder on the hub below.
//
// ── ACCESS ───────────────────────────────────────────────────────────
// Gated on HAVING A profiles ROW — any staff member, admin or employee.
// Deliberately NOT admin-only: employees can already open and fully edit
// this same questionnaire through the programme-meeting split screen in
// the meetings tab, and `staff_full_access` on the underlying tables is
// itself keyed on merely having a profiles row. An admin-only gate here
// would be stricter than both the neighbouring UI and the database, for
// no reason anyone could later reconstruct.
//
// No wrapping guard component, matching every other staff route in
// main.jsx (ProjectsKanban, Reports, StaffClientViewMount) — each checks
// profiles itself on mount, with a live read rather than a cached role.
//
// ── THE BACK CONTROL ─────────────────────────────────────────────────
// useClientNav().goBack is NOT used, and must not be: outside the portal
// its context default is a genuine no-op function, so the arrow would
// render and do nothing. This page navigates to the project's own
// סיכומי פגישות deep link instead — the same ?tab= form the meetings
// module already builds.

import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import ClientProgrammingQuestionnaire from './client/ClientProgrammingQuestionnaire'
import { MEETINGS_TAB_ID } from '../components/meetings/MeetingSummariesTab'
import {
  loadProjectNotifications,
  isQuestionnaireSidePending,
  clearQuestionnaireSide,
} from '../lib/staffNotifications'

function Pane({ text }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#ffffff',
      fontFamily: "'Heebo', sans-serif",
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      direction: 'rtl',
    }}>
      <p style={{ color: '#8a8680', fontSize: 16, fontWeight: 300, margin: 0 }}>{text}</p>
    </div>
  )
}

const IconBack = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)

export default function StaffQuestionnaireView() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  const [status, setStatus] = useState('loading')  // loading | ready
  const [projectName, setProjectName] = useState('')
  const [notifications, setNotifications] = useState([])

  const reloadNotifications = useCallback(async () => {
    if (!projectId) return
    setNotifications(await loadProjectNotifications(projectId))
  }, [projectId])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }

      /* Live read — never trust a role cached earlier in the session.
         Same pattern as AuthCallback / ProjectsKanban / StaffClientViewMount. */
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', session.user.id)
        .maybeSingle()

      if (cancelled) return
      if (profileErr || !profile) { navigate('/no-access'); return }
      if (!projectId) { navigate('/פרויקטים'); return }

      const { data: project, error: projectErr } = await supabase
        .from('projects')
        .select('id, name')
        .eq('id', projectId)
        .maybeSingle()

      if (cancelled) return
      if (projectErr || !project) { navigate('/פרויקטים'); return }

      setProjectName(project.name || '')
      await reloadNotifications()
      if (cancelled) return
      setStatus('ready')
    }

    init()
    return () => { cancelled = true }
  }, [projectId, navigate, reloadNotifications])

  const goBackToMeetings = () =>
    navigate(`/projects/${projectId}?tab=${MEETINGS_TAB_ID}`)

  /* Entering a side clears ONLY that side, then refetches so the dot
     disappears without a reload. A DELETE affecting zero rows is normal
     here — it means that side was not pending — so clearQuestionnaireSide
     deliberately does not check the affected row count. */
  const clearSide = async (action) => {
    await clearQuestionnaireSide(projectId, action)
    await reloadNotifications()
  }

  if (status !== 'ready') return <Pane text="טוען..." />

  return (
    <div style={{ minHeight: '100vh', background: '#F7F5F2', direction: 'rtl' }}>
      {/* Header — project name plus the ONE back control. RTL: the title
          leads at the right, the button sits after it. */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 20px', background: '#ffffff',
        borderBottom: '1px solid #e6e1d8',
        fontFamily: "'Heebo', sans-serif",
      }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#1a1a18', flex: 1 }}>
          שאלון פרוגרמה — {projectName}
        </h1>
        <button
          type="button"
          onClick={goBackToMeetings}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: 'none', border: '1px solid #d8d2c6', borderRadius: 8,
            padding: '6px 12px', cursor: 'pointer',
            fontFamily: "'Heebo', sans-serif", fontSize: 13, color: '#5a5650',
          }}
        >
          <IconBack size={16} />
          חזרה לסיכומי פגישות
        </button>
      </header>

      <ClientProgrammingQuestionnaire
        embeddedProjectId={projectId}
        forceAdminEdit
        embedded={false}
        staffNotifications={{
          questionnairePending: isQuestionnaireSidePending(notifications, 'questionnaire_done'),
          housePending:         isQuestionnaireSidePending(notifications, 'house_done'),
          onEnterQuestionnaire: () => clearSide('questionnaire_done'),
          onEnterHouse:         () => clearSide('house_done'),
        }}
      />
    </div>
  )
}
