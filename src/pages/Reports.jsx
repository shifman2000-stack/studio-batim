import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import '../pages/Reports.css'
import FolderOrganizerDialog from '../components/FolderOrganizerDialog'

export default function Reports() {
  const [role, setRole] = useState(null)
  const [folderOrganizerOpen, setFolderOrganizerOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/'); return }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (!profile || profile.role !== 'admin') { navigate('/dashboard'); return }
      setRole('admin')
    }
    init()
  }, [])

  if (role !== 'admin') return null

  return (
    <div className="reports-page" dir="rtl">
      <h1 className="reports-title">דוחות</h1>
      <div className="reports-grid">
        <div className="report-card" onClick={() => navigate('/reports/project-stages')}>
          <div className="report-card-icon">📊</div>
          <div className="report-card-title">שלבי פרויקט</div>
          <div className="report-card-desc">צפייה בשעות ובמשך הזמן לפי שלב עבור כל פרויקט</div>
        </div>
        <div className="report-card" onClick={() => navigate('/reports/hours')}>
          <div className="report-card-icon">🕐</div>
          <div className="report-card-title">דוח שעות עבודה</div>
          <div className="report-card-desc">דוח חודשי של שעות עבודה, ימי חופש ומחלה לפי עובד</div>
        </div>
        <div className="report-card" onClick={() => navigate('/reports/inquiries')}>
          <div className="report-card-icon">📋</div>
          <div className="report-card-title">דוח פניות</div>
          <div className="report-card-desc">סיכום פניות לפי שנה, אחוז המרה לפרויקטים וגרף חודשי</div>
        </div>
        <div className="report-card" onClick={() => setFolderOrganizerOpen(true)}>
          <div className="report-card-icon">📁</div>
          <div className="report-card-title">סידור תיקיות פרויקט</div>
          <div className="report-card-desc">המלצות AI לסידור תיקיות פרויקט ב-Google Drive</div>
        </div>
      </div>

      <FolderOrganizerDialog
        isOpen={folderOrganizerOpen}
        onClose={() => setFolderOrganizerOpen(false)}
      />
    </div>
  )
}
