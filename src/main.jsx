import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Header from './Header'
import Dashboard from './Dashboard.jsx'
import Hours from './Hours.jsx'
import Tasks from './Tasks.jsx'
import Projects from './Projects.jsx'
import ProjectDetail from './ProjectDetail.jsx'
import ProjectsKanban from './ProjectsKanban.jsx'
import Professionals from './Professionals.jsx'
import Reports from './pages/Reports'
import Inquiries from './pages/Inquiries'
import ProjectStagesReport from './pages/reports/ProjectStagesReport'
import HoursReport from './pages/reports/HoursReport'
import InquiriesReport from './pages/reports/InquiriesReport'

function Layout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/hours" element={<Hours />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/פרויקטים" element={<ProjectsKanban />} />
          <Route path="/professionals" element={<Professionals />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/project-stages" element={<ProjectStagesReport />} />
          <Route path="/reports/hours" element={<HoursReport />} />
          <Route path="/inquiries" element={<Inquiries />} />
          <Route path="/reports/inquiries" element={<InquiriesReport />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
