import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import '../pages/Reports.css'
export default function Reports() {
  const [role, setRole] = useState(null)
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
      {/* Section 1 — the existing reports, unchanged: same cards, same
          links, same behavior, just grouped under an explicit header. */}
      <section className="reports-section">
        <h2 className="reports-section-title">דוחות</h2>
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
          <div className="report-card" onClick={() => navigate('/reports/project-hours')}>
            <div className="report-card-icon">📅</div>
            <div className="report-card-title">דוח שעות לפי פרויקט</div>
            <div className="report-card-desc">חיפוש פרויקט וטווח תאריכים לצפייה בשעות העבודה שדווחו עבורו</div>
          </div>
          <div className="report-card" onClick={() => navigate('/reports/inquiries')}>
            <div className="report-card-icon">📋</div>
            <div className="report-card-title">דוח פניות</div>
            <div className="report-card-desc">סיכום פניות לפי שנה, אחוז המרה לפרויקטים וגרף חודשי</div>
          </div>
        </div>
      </section>

      {/* Section 2 — administrative tools. "אפיון מערכת בונה הבית" moved
          here verbatim (same card, same onClick, same route) from
          Section 1 above; nothing about it changed except location. */}
      <section className="reports-section">
        <h2 className="reports-section-title">ניהול</h2>
        <div className="reports-grid">
          <div className="report-card" onClick={() => navigate('/reports/house-builder-config')}>
            <div className="report-card-icon">🏠</div>
            <div className="report-card-title">אפיון מערכת בונה הבית</div>
            <div className="report-card-desc">טופס עזר למנהל לעריכת הגדרות מערכת בונה הבית - מפלסים, חללים, מאפיינים ומידות</div>
          </div>
          <div className="report-card" onClick={() => navigate('/reports/parent-project-models')}>
            <div className="report-card-icon">📋</div>
            <div className="report-card-title">רשימת דגמים לפרויקט אב</div>
            <div className="report-card-desc">ניהול רשימת הדגמים (שם, תאור, תמונה, הערות) עבור כל פרויקט אב</div>
          </div>
        </div>
      </section>
    </div>
  )
}
