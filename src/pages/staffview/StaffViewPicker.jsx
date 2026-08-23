// src/pages/staffview/StaffViewPicker.jsx
//
// Project picker for the admin mobile "client view" mode — the SIBLING
// screen to StaffClientViewMount.jsx, not a screen inside ClientPortal.
// "Switch project" means coming back HERE, not a nav concept threaded
// into ClientPortal's own drawer/nav state (see the persistent staff-view
// bar ClientPortal.jsx renders, whose back control returns to this
// route).
//
// Patterned on the existing client card-list screens (ClientSharedFiles,
// ClientDocuments) — reuses their .cp-page / .cp-container / .cp-card
// chrome from ClientPortal.css rather than inventing new styling.
//
// Access control: same live profiles.role probe used independently by
// AuthCallback.jsx, ProjectsKanban.jsx and StaffClientViewMount.jsx —
// this route carries no wrapping guard component, consistent with every
// other staff route in main.jsx.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import '../ClientPortal.css'
import './StaffViewPicker.css'

export default function StaffViewPicker() {
  const navigate = useNavigate()
  // status: 'checking' | 'ready'  — denial navigates away directly.
  const [status, setStatus]     = useState('checking')
  const [projects, setProjects] = useState([])
  const [loadError, setLoadError] = useState('')
  const [query, setQuery]       = useState('')

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }

      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle()

      if (cancelled) return
      if (profileErr || !profile || profile.role !== 'admin') {
        navigate('/no-access')
        return
      }

      const { data, error } = await supabase
        .from('projects')
        .select('id, name')
        .eq('archived', false)
        .order('name', { ascending: true })

      if (cancelled) return
      if (error) {
        setLoadError('שגיאה בטעינת רשימת הפרויקטים')
      } else {
        setProjects(Array.isArray(data) ? data : [])
      }
      setStatus('ready')
    }

    init()
    return () => { cancelled = true }
  }, [navigate])

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return projects
    return projects.filter(p => (p.name || '').includes(q))
  }, [projects, query])

  if (status !== 'ready') {
    return (
      <div className="cp-loading">
        <p>טוען...</p>
      </div>
    )
  }

  return (
    <div className="cp-page sv-picker-page">
      <div className="cp-container">
        <h1 className="cp-screen-title">בחירת פרויקט</h1>
        <p className="sv-picker-subtitle">
          בחר/י פרויקט כדי להיכנס לפורטל הלקוח שלו — בדיוק כפי שהלקוח רואה אותו.
        </p>

        <input
          type="text"
          className="cp-input sv-picker-search"
          placeholder="חיפוש פרויקט..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        {loadError && (
          <div className="cp-save-error" role="alert">{loadError}</div>
        )}

        {filtered.length === 0 ? (
          <section className="cp-card">
            <p className="cp-empty-card">
              {projects.length === 0 ? 'אין פרויקטים זמינים' : 'לא נמצאו פרויקטים תואמים'}
            </p>
          </section>
        ) : (
          <div className="sv-picker-list">
            {filtered.map(p => (
              <button
                key={p.id}
                type="button"
                className="cp-card sv-picker-row"
                onClick={() => navigate(`/staff-view/${p.id}`)}
              >
                <span className="sv-picker-row-name">{p.name || '—'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
