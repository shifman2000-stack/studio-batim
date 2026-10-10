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
import StaffQuestionnaireView from './pages/StaffQuestionnaireView'
import ProgrammingSummaryPage from './pages/ProgrammingSummaryPage'
import NoAccess from './pages/NoAccess'
import InquiryForm from './pages/InquiryForm'
import ChildInquiryForm from './pages/ChildInquiryForm'
import QuotePrintView from './pages/QuotePrintView'
import QuotePrintSigned from './pages/QuotePrintSigned'
import FinishingPrintView from './pages/FinishingPrintView'
import QuantitiesPrintView from './pages/QuantitiesPrintView'
import ContractorSpecPrintView from './pages/ContractorSpecPrintView'
import QuotePublic from './pages/QuotePublic'
import QuoteRouter from './pages/QuoteRouter'
import ResetPassword from './pages/ResetPassword'
import QuoteBuilderPage from './pages/QuoteBuilderPage'
import QuoteV2Lab from './pages/lab/QuoteV2Lab'
import QuoteV2PrintLab from './pages/lab/QuoteV2PrintLab'
import QuoteV2New from './pages/lab/QuoteV2New'
import QuoteTowerPrint from './pages/QuoteTowerPrint'
import QuoteEditorV2 from './pages/QuoteEditorV2'
import QuoteV2PreviewFrame from './pages/QuoteV2PreviewFrame'

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
        {/* Staff full page for a project's questionnaire + house builder.
            Outside <Layout /> deliberately — it owns its whole viewport
            and carries its own back control to the project's meetings
            tab. Gates itself on a profiles row, like every other staff
            route here. */}
        <Route path="/staff-questionnaire/:projectId" element={<StaffQuestionnaireView />} />
        {/* Read-only programming summary document. Outside <Layout /> for
            the same reason as the route above, and gated the same way. */}
        <Route path="/programming-summary/:projectId" element={<ProgrammingSummaryPage />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="/inquiry-form/:token" element={<InquiryForm />} />
        <Route path="/child-inquiry/:token" element={<ChildInquiryForm />} />
        <Route path="/quote-print/:quoteId" element={<QuotePrintView />} />
        <Route path="/quote-print-signed/:token" element={<QuotePrintSigned />} />
        <Route path="/finishing-print/:projectId" element={<FinishingPrintView />} />
        <Route path="/quantities-print/:projectId" element={<QuantitiesPrintView />} />
        <Route path="/contractor-spec-print/:projectId" element={<ContractorSpecPrintView />} />
        {/* ⚠️ נקודת ההסתעפות היחידה בין v1 ל-v2. QuoteRouter בודק
            schema ומרנדר את QuotePublic ללא שינוי לכל מה שאינו 2 —
            כולל שגיאה וטוקן שלא נמצא. ראו ההערה בראש הקובץ. */}
        <Route path="/quote/:token" element={<QuoteRouter />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* מעבדה להצעת מחיר v2 — admin בלבד, לא מקושר משום תפריט.
            מחוץ ל-<Layout> בכוונה: המסע תופס את כל המסך, כמו שהלקוח
            יראה אותו בטלפון. קריאה בלבד, בלי קשר להצעות הקיימות. */}
        <Route path="/lab/quote-v2" element={<QuoteV2Lab />} />
        <Route path="/lab/quote-v2/print" element={<QuoteV2PrintLab />} />
        <Route path="/lab/quote-v2/new" element={<QuoteV2New />} />
        {/* עורך ההצעות (שלב E) — admin בלבד, מחוץ ל-<Layout> כי הוא
            תופס את כל המסך. בשלב הזה מגיעים אליו רק דרך המעבדה;
            החיבור למסך הפנייה הוא שלב F. */}
        {/* ⚠️ לפני /quotes-v2/:quoteId — אחרת "preview-frame"
            נבלע כ-quoteId. התצוגה המקדימה של העורך נטענת לכאן
            ב-iframe, כדי שלמסע יהיה viewport אמיתי. */}
        <Route path="/quotes-v2/preview-frame" element={<QuoteV2PreviewFrame />} />
        <Route path="/quotes-v2/:quoteId" element={<QuoteEditorV2 />} />
        {/* הפן הכתוב לפי טוקן — אליו מנווט Puppeteer גם בהורדה
            שלפני החתימה וגם ביצירת ה-PDF החתום. ציבורי, כמו
            /quote-print-signed/:token של היום. */}
        <Route path="/quote-tower-print/:token" element={<QuoteTowerPrint />} />
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
