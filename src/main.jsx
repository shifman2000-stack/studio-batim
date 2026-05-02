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
import AuthCallback from './pages/AuthCallback'
import ClientPortal from './pages/ClientPortal'
import NoAccess from './pages/NoAccess'
import InquiryForm from './pages/InquiryForm'
import QuotePrintView from './pages/QuotePrintView'
import QuotePrintSigned from './pages/QuotePrintSigned'
import QuotePublic from './pages/QuotePublic'

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
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/client" element={<ClientPortal />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="/inquiry-form/:token" element={<InquiryForm />} />
        <Route path="/quote-print/:quoteId" element={<QuotePrintView />} />
        <Route path="/quote-print-signed/:token" element={<QuotePrintSigned />} />
        <Route path="/quote/:token" element={<QuotePublic />} />
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
