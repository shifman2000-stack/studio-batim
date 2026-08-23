// src/components/StaffClientViewMount.jsx
//
// Mounts the REAL client-portal component tree (ClientPortal.jsx,
// unmodified) for an admin browsing on their phone, for a project they
// picked in StaffViewPicker.jsx. This is the "admin mobile client view"
// feature — NOT the desktop "תצוגת לקוח" read-only preview
// (ClientPreviewOverlay.jsx). It reuses that preview's ONE useful trick
// (supply a synthetic ClientContext value instead of a real client auth
// session) and nothing else:
//   * no device-frame mockup, no fixed 390×844 viewport, no drag, no
//     scale — this is a full-page ROUTE (like /client itself), meant to
//     fill the admin's actual phone screen.
//   * setSupabasePreviewMode(true) is NEVER called here. Writes must
//     execute for real — the admin keeps their own staff session/uid,
//     and Prod RLS was verified by direct execution to already allow
//     staff SELECT/UPDATE/INSERT on every table the portal touches, for
//     any project (see the investigation report this feature is built
//     from). previewMode stays false throughout; isStaffView is a
//     separate, new context flag individual screens check when a write
//     must NOT carry a client-only side effect (see ClientDocuments.jsx).
//
// Identity on writes: the context's `id` field is what every portal
// write call site already uses for uploaded_by / client_completed_by
// (via useClient().id). Setting it to the admin's own profiles.id here
// — rather than any client_users id — means every existing write call
// site attributes correctly with ZERO changes to those call sites: both
// resolveUserNames.js and ClientDocuments.jsx's own nameByUserId lookup
// already check `profiles` before `client_users`, so the admin's real
// name displays wherever an uploader/approver name is shown.
//
// Access control: this route carries no wrapping guard component (same
// as every other staff route in main.jsx — ProjectsKanban, Reports,
// etc. all check profiles.role themselves on mount). This component
// does the same: a live SELECT against profiles, matching the pattern
// already used independently in AuthCallback.jsx, ProjectsKanban.jsx
// and ClientProgrammingQuestionnaire.jsx.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { ClientContext } from './ClientRoute'
import ClientPortal from '../pages/ClientPortal'

function LoadingPane({ text }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#F7F5F2',
      fontFamily: "'Heebo', sans-serif",
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      direction: 'rtl',
    }}>
      <p style={{ color: '#8a8680', fontSize: '16px', fontWeight: 300, margin: 0 }}>
        {text}
      </p>
    </div>
  )
}

export default function StaffClientViewMount() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  // status: 'loading' | 'ready'  — denial/no-project cases navigate away
  // directly rather than rendering their own dead-end screen.
  const [status, setStatus]   = useState('loading')
  const [staff, setStaff]     = useState(null) // { id, first_name }
  const [projectName, setProjectName] = useState('')

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }

      // Live read, same pattern as AuthCallback.jsx / ProjectsKanban.jsx —
      // never trust a cached role from an earlier point in the session.
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('id, role, first_name')
        .eq('id', session.user.id)
        .maybeSingle()

      if (cancelled) return
      if (profileErr || !profile || profile.role !== 'admin') {
        navigate('/no-access')
        return
      }

      if (!projectId) { navigate('/staff-view'); return }

      const { data: project, error: projectErr } = await supabase
        .from('projects')
        .select('id, name')
        .eq('id', projectId)
        .maybeSingle()

      if (cancelled) return
      if (projectErr || !project) {
        // Deleted / bad link / typo'd id — back to the picker rather
        // than a dead end.
        navigate('/staff-view')
        return
      }

      setStaff({ id: profile.id, first_name: profile.first_name || '' })
      setProjectName(project.name || '')
      setStatus('ready')
    }

    init()
    return () => { cancelled = true }
  }, [projectId, navigate])

  if (status !== 'ready') {
    return <LoadingPane text="טוען..." />
  }

  return (
    <ClientContext.Provider
      value={{
        id:              staff.id,          // staff's own profiles.id — flows into every uploaded_by / client_completed_by write
        project_id:      projectId,
        first_name:      staff.first_name,
        previewMode:     false,              // writes execute for real — NEVER true here
        isStaffView:     true,
        staffProjectName: projectName,
      }}
    >
      <ClientPortal />
    </ClientContext.Provider>
  )
}
