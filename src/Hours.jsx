import { useState } from 'react'
import Header from './Header'
import './Hours.css'

function Hours() {
  const [activeTab, setActiveTab] = useState('daily')

  return (
    <div className="hours-page">
      <Header />

      <div className="hours-tabs" dir="rtl">
        <button
          className={`tab-btn ${activeTab === 'daily' ? 'active' : ''}`}
          onClick={() => setActiveTab('daily')}
        >
          נוכחות יומית
        </button>
        <button
          className={`tab-btn ${activeTab === 'project' ? 'active' : ''}`}
          onClick={() => setActiveTab('project')}
        >
          שעות לפי פרויקט
        </button>
      </div>

      <div className="hours-content">
        {/* content coming soon */}
      </div>
    </div>
  )
}

export default Hours
