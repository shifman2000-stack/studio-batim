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
import ProjectHoursReport from './pages/reports/ProjectHoursReport'
import ClientUsabilityReport from './pages/reports/ClientUsabilityReport'
import InquiriesReport from './pages/reports/InquiriesReport'
import HouseBuilderConfigReport from './pages/reports/HouseBuilderConfigReport'
import SiteHealthReport from './pages/reports/SiteHealthReport'
import ParentProjectModelsReport from './pages/reports/ParentProjectModelsReport'
import AuthCallback from './pages/AuthCallback'
import ClientPortal from './pages/ClientPortal'
import ClientRoute from './components/ClientRoute'
import ContractorPortal from './pages/ContractorPortal'
import ContractorRoute from './components/ContractorRoute'
import StaffViewPicker from './pages/staffview/StaffViewPicker'
import StaffClientViewMount from './components/StaffClientViewMount'
import NoAccess from './pages/NoAccess'
import InquiryForm from './pages/InquiryForm'
import ChildInquiryForm from './pages/ChildInquiryForm'
import QuotePrintView from './pages/QuotePrintView'
import QuotePrintSigned from './pages/QuotePrintSigned'
import FinishingPrintView from './pages/FinishingPrintView'
import QuantitiesPrintView from './pages/QuantitiesPrintView'
import ContractorSpecPrintView from './pages/ContractorSpecPrintView'
import QuotePublic from './pages/QuotePublic'
import ResetPassword from './pages/ResetPassword'
import QuoteBuilderPage from './pages/QuoteBuilderPage'

function Layout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  )
}

/* ── Service worker ──────────────────────────────────────────────
   Registered after `load` so it never competes with the first paint for
   bandwidth. Failure is non-fatal by design: the app must work exactly
   the same with no service worker at all — the SW only adds
   installability and asset caching, never behaviour. */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('service worker registration failed:', err)
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/client" element={<ClientRoute><ClientPortal /></ClientRoute>} />
        {/* Contractor portal — OUTSIDE <Layout>, exactly as /client is, so
            the manager Header/sidebar never renders for a contractor.
            Nothing on the staff desktop changes. */}
        <Route path="/contractor" element={<ContractorRoute><ContractorPortal /></ContractorRoute>} />
        <Route path="/contractor/:projectId" element={<ContractorRoute><ContractorPortal /></ContractorRoute>} />
        {/* Admin mobile "client view" — a real staff session rendering the
            client portal for real writes, not the desktop-only read-only
            "תצוגת לקוח" preview (that one lives inside ProjectsKanban.jsx
            and never leaves the desktop app). Top-level routes, same as
            /client itself — full phone screen, no manager Header/sidebar. */}
        <Route path="/staff-view" element={<StaffViewPicker />} />
        <Route path="/staff-view/:projectId" element={<StaffClientViewMount />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="/inquiry-form/:token" element={<InquiryForm />} />
        <Route path="/child-inquiry/:token" element={<ChildInquiryForm />} />
        <Route path="/quote-print/:quoteId" element={<QuotePrintView />} />
        <Route path="/quote-print-signed/:token" element={<QuotePrintSigned />} />
        <Route path="/finishing-print/:projectId" element={<FinishingPrintView />} />
        <Route path="/quantities-print/:projectId" element={<QuantitiesPrintView />} />
        <Route path="/contractor-spec-print/:projectId" element={<ContractorSpecPrintView />} />
        <Route path="/quote/:token" element={<QuotePublic />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/hours" element={<Hours />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/פרויקטים" element={<ProjectsKanban />} />
          <Route path="/פרויקטים/אב/:parentId" element={<ProjectsKanban />} />
          <Route path="/professionals" element={<Professionals />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/project-stages" element={<ProjectStagesReport />} />
          <Route path="/reports/hours" element={<HoursReport />} />
          <Route path="/reports/project-hours" element={<ProjectHoursReport />} />
          <Route path="/reports/client-usability" element={<ClientUsabilityReport />} />
          <Route path="/inquiries" element={<Inquiries />} />
          <Route path="/reports/inquiries" element={<InquiriesReport />} />
          <Route path="/reports/house-builder-config" element={<HouseBuilderConfigReport />} />
          <Route path="/reports/parent-project-models" element={<ParentProjectModelsReport />} />
          <Route path="/reports/site-health" element={<SiteHealthReport />} />
          <Route path="/quote-builder/:inquiryId" element={<QuoteBuilderPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
