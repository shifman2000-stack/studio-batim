// src/pages/reports/ParentProjectModelsReport.jsx
//
// Admin-only report under "ניהול": "רשימת דגמים לפרויקט אב"
//
// Step 1: pick a parent project (projects.is_parent_project = true).
// Step 2: manage that project's models + presentations — delegated to
// ParentModelsPanel, the reusable piece also used (with a directly-known
// project id, no picker) by ProjectDetail.jsx's "דגמים" tab.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import ParentModelsPanel from '../../components/parentmodels/ParentModelsPanel'
import '../ReportTable.css'

export default function ParentProjectModelsReport() {
  const navigate = useNavigate()
  const [role, setRole] = useState(null)

  /* ── Step 1: parent project list + selection ── */
  const [parents, setParents]         = useState([])
  const [selectedId, setSelectedId]   = useState('')

  /* ── Admin guard — same pattern as every other report page. */
  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase
        .from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')
      const { data } = await supabase
        .from('projects')
        .select('id, name')
        .eq('is_parent_project', true)
        .eq('archived', false)
        .order('name', { ascending: true })
      setParents(data || [])
    }
    init()
  }, [])

  if (role !== 'admin') return null

  const selectedParent = parents.find(p => p.id === selectedId)

  return (
    <div className="report-table-page" dir="rtl">
      <div className="report-header-row">
        <h1 className="report-page-title">רשימת דגמים לפרויקט אב</h1>
        <button className="report-back-btn" onClick={() => navigate('/reports')}>← חזרה לדוחות</button>
      </div>

      <div className="report-controls">
        <label className="report-select-label">בחר פרויקט אב:</label>
        <select
          className="report-project-select"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
        >
          <option value="">בחר...</option>
          {parents.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {parents.length === 0 && (
        <p className="report-empty">אין עדיין פרויקטי אב במערכת.</p>
      )}

      {selectedId && (
        <ParentModelsPanel projectId={selectedId} projectName={selectedParent?.name} />
      )}
    </div>
  )
}
