// src/pages/ContractorPortal.jsx
//
// Contractor portal SHELL. ONE screen with one conditional — deliberately
// not two screens, which would drift.
//
//   /contractor              → his one project's documents, if he has
//                              exactly one; otherwise the picker
//   /contractor/:projectId   → that project's documents
//
// Most contractors work on a single project, so for them the picker is a
// click that asks nothing: they land straight on the documents and there
// is no "כל הפרויקטים" control, because there is nowhere to go back to.
// With two or more projects the picker appears and the back control comes
// with it.
//
// That choice is made at runtime from the live project count (see
// isSingleProject below) — there is no flag, no setting, and nothing to
// migrate. A contractor who gains a second project next month starts
// seeing the picker on his next load, with no code change.
//
// Projects come from client_info.contractor_id = his professional_id,
// archived excluded — the same chain contractor_project_ids() walks in
// the RLS policies, so the picker cannot list a project whose documents
// he would then be refused.
//
// Visual language: the client portal's, via ClientPortal.css. RTL is
// inherited from .cp-page; nothing here sets a physical side.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useContractor } from '../components/ContractorRoute'
import ContractorDocuments from './contractor/ContractorDocuments'
import './ClientPortal.css'

/* Feather-style chevron pointing the way "onward" reads in RTL — the
   same glyph the client portal's accordions use. */
const IconChevronStart = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

const CARD = {
  background: '#ffffff',
  border: '0.5px solid rgba(26,26,24,0.1)',
  borderRadius: 10,
  padding: '14px 16px',
  marginBottom: 10,
}

const LINK_BTN = {
  background: 'none', border: 'none', padding: 0,
  font: 'inherit', fontSize: 13, fontWeight: 400, color: '#7a9478',
  cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
  direction: 'rtl',
}

export default function ContractorPortal() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { professional_id, displayName, email } = useContractor()

  const [status, setStatus]     = useState('loading') // loading | ready | error
  const [projects, setProjects] = useState([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const { data, error } = await supabase
        .from('client_info')
        .select('project_id, projects ( id, name, archived )')
        .eq('contractor_id', professional_id)

      if (cancelled) return

      if (error) {
        console.error('contractor projects load failed:', error)
        setStatus('error')
        return
      }

      const rows = (data || [])
        .map(r => r.projects)
        .filter(p => p && p.archived !== true)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he'))

      setProjects(rows)
      setStatus('ready')
    }

    load()
    return () => { cancelled = true }
  }, [professional_id])

  /* ── THE decision, made in exactly ONE place ──────────────────────
     Derived from the live project count on every render. Everything
     downstream — whether the picker exists, whether a bare /contractor
     resolves straight to a project, whether the back control renders —
     reads this one boolean. Nothing else recomputes it. */
  const isSingleProject = projects.length === 1

  /* Which project the screen is showing, if any.
       · an explicit :projectId always wins, and resolves to null when it
         is not one of his — that renders the "unavailable" card rather
         than silently showing him a different project
       · a bare /contractor resolves to his only project when he has
         exactly one, and to null (→ picker) when he has several */
  const activeProject = useMemo(() => {
    if (projectId) return projects.find(p => p.id === projectId) || null
    return isSingleProject ? projects[0] : null
  }, [projectId, projects, isSingleProject])

  /* Back exists only when there is a list to go back to. */
  const showBack = !!activeProject && !isSingleProject

  const heading = (displayName || '').trim() || email || ''

  return (
    <div className="cp-page">
      <div className="cp-container">

        {/* ── Greeting — unchanged ── */}
        <header style={{ margin: '4px 0 22px' }}>
          <p style={{ margin: 0, color: '#8a8680', fontSize: 14, fontWeight: 300 }}>שלום</p>
          <h1 style={{ margin: '2px 0 0', color: '#1a1a18', fontSize: 24, fontWeight: 500, lineHeight: 1.25 }}>
            {heading}
          </h1>
        </header>

        {status === 'loading' && (
          <p className="cp-doc-meta" style={{ margin: 0 }}>טוען...</p>
        )}

        {status === 'error' && (
          <div className="cp-doc-error" role="alert">
            לא ניתן לטעון את רשימת הפרויקטים כרגע. נא לנסות שוב מאוחר יותר.
          </div>
        )}

        {/* ── Zero projects — unchanged, and checked BEFORE :projectId so
            a stale link cannot replace this with the "unavailable" card. ── */}
        {status === 'ready' && projects.length === 0 && (
          <div style={{ ...CARD, marginBottom: 0 }}>
            <p style={{ margin: 0, color: '#1a1a18', fontSize: 15, fontWeight: 400 }}>
              עדיין לא שויכת לפרויקט
            </p>
            <p style={{ margin: '6px 0 0', color: '#8a8680', fontSize: 14, fontWeight: 300, lineHeight: 1.5 }}>
              כשהסטודיו ישייך אותך לפרויקט, הוא יופיע כאן.
            </p>
          </div>
        )}

        {/* ── Picker — only reachable with two or more projects, because
            with exactly one activeProject is already resolved above. ── */}
        {status === 'ready' && projects.length > 0 && !activeProject && !projectId && (
          <>
            <h2 className="cp-screen-title">הפרויקטים שלי</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {projects.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/contractor/${p.id}`)}
                    style={{
                      ...CARD,
                      width: '100%', display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', gap: 10,
                      font: 'inherit', fontSize: 15, color: '#1a1a18',
                      textAlign: 'right', cursor: 'pointer', direction: 'rtl',
                    }}
                  >
                    <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{p.name}</span>
                    <span style={{ flexShrink: 0, color: '#8a8680', display: 'inline-flex' }}>
                      <IconChevronStart />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {/* ── Documents ── */}
        {status === 'ready' && activeProject && (
          <>
            {showBack && (
              <button
                type="button"
                onClick={() => navigate('/contractor')}
                style={{ ...LINK_BTN, margin: '0 0 10px' }}
              >
                <IconChevronStart />
                <span>כל הפרויקטים</span>
              </button>
            )}

            <h2 className="cp-screen-title" style={{ marginTop: 0 }}>
              {`תוכניות לביצוע עבור ${activeProject.name}`}
            </h2>

            <ContractorDocuments projectId={activeProject.id} />
          </>
        )}

        {/* ── A :projectId that is not one of his — a stale link, or a
            project he is no longer assigned to. Not an error page. The
            way out depends on whether he has a list to return to. ── */}
        {status === 'ready' && projects.length > 0 && projectId && !activeProject && (
          <div style={{ ...CARD, marginBottom: 0 }}>
            <p style={{ margin: 0, color: '#1a1a18', fontSize: 15, fontWeight: 400 }}>
              הפרויקט הזה אינו זמין עבורך
            </p>
            <button
              type="button"
              onClick={() => navigate('/contractor')}
              style={{ ...LINK_BTN, marginTop: 8 }}
            >
              {isSingleProject ? 'מעבר לפרויקט שלי' : 'חזרה לרשימת הפרויקטים'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
