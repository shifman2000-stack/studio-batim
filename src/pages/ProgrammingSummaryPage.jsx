// src/pages/ProgrammingSummaryPage.jsx
//
// Route /programming-summary/:projectId — the read-only "סיכום פרוגרמה"
// document for one project. Outside <Layout />, like
// /staff-questionnaire/:projectId, and opened in a new browser tab from the
// project settings screen and the meetings toolbar.
//
// This file only gates, loads and hands off:
//   · the gate      → identical to StaffQuestionnaireView (below)
//   · the data      → project, its contacts, its programming_questionnaires
//                     row, and the active house-builder config through the
//                     existing loadHouseBuilderConfig()
//   · the mapping   → lib/programmingSummary.js (pure)
//   · the drawing   → ProgrammingSummaryDocument.jsx (presentational)
//
// ── ACCESS ────────────────────────────────────────────────────────────────
// The SAME gate as StaffQuestionnaireView, copied rather than reinvented:
// any user with a profiles row — admin or employee — and the same rejection
// treatment (no session → "/", no profile → "/no-access", missing or
// unknown project → the projects board). Every read below is already
// permitted to that population by existing RLS; this page adds no policy.

import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { loadHouseBuilderConfig } from '../lib/houseBuilderConfigSource'
import { buildProgrammingSummary, SUMMARY_TITLE, LOAD_ERROR_LABEL } from '../lib/programmingSummary'
import ProgrammingSummaryDocument from './ProgrammingSummaryDocument'

/* Same full-viewport status pane StaffQuestionnaireView uses. */
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

export default function ProgrammingSummaryPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()

  const [status, setStatus] = useState('loading')  // loading | ready | error
  const [model, setModel]   = useState(null)

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      /* ── The gate — identical to StaffQuestionnaireView ── */
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }

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

      /* ── The data ── */
      const [contactsRes, rowRes, config] = await Promise.all([
        supabase
          .from('project_contacts')
          .select('first_name, last_name')
          .eq('project_id', projectId)
          .order('id'),
        supabase
          .from('programming_questionnaires')
          .select('answers, updated_at')
          .eq('project_id', projectId)
          .maybeSingle(),
        /* The existing loader: the active config row, adapted, with the
           in-code config as fallback. Never throws. */
        loadHouseBuilderConfig(),
      ])

      if (cancelled) return
      if (rowRes.error) {
        console.error('programming summary: questionnaire load failed', rowRes.error)
        setStatus('error')
        return
      }
      /* Contacts only feed the header names; a failure there costs the
         names, not the document. */
      if (contactsRes.error) {
        console.warn('programming summary: contacts load failed', contactsRes.error)
      }

      setModel(buildProgrammingSummary({
        projectName: project.name || '',
        contacts:    contactsRes.data || [],
        row:         rowRes.data || null,
        config,
      }))
      setStatus('ready')
    }

    init()
    return () => { cancelled = true }
  }, [projectId, navigate])

  /* The browser tab names the document, since it opens in a tab of its own. */
  useEffect(() => {
    if (!model) return
    const previous = document.title
    document.title = model.projectName ? `${SUMMARY_TITLE} — ${model.projectName}` : SUMMARY_TITLE
    return () => { document.title = previous }
  }, [model])

  if (status === 'error') return <Pane text={LOAD_ERROR_LABEL} />
  if (status !== 'ready' || !model) return <Pane text="טוען..." />

  return <ProgrammingSummaryDocument model={model} />
}
