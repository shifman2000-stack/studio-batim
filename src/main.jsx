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
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
