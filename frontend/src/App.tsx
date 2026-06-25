import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './store/auth'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import StoragePage from './pages/admin/StoragePage'
import TemplatesPage from './pages/admin/TemplatesPage'
import StructuresPage from './pages/admin/StructuresPage'
import UsersPage from './pages/admin/UsersPage'
import StatsPage from './pages/admin/StatsPage'
import DocsPage from './pages/user/DocsPage'
import DocEditorPage from './pages/user/DocEditorPage'
import ProfilePage from './pages/user/ProfilePage'

function PrivateRoute({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { token, user } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  if (adminOnly && user && user.role !== 'admin') return <Navigate to="/docs" replace />
  return <>{children}</>
}

export default function App() {
  const { token, loadMe } = useAuth()
  useEffect(() => { if (token) loadMe() }, [token])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
          <Route index element={<Navigate to="/docs" replace />} />
          <Route path="docs"         element={<DocsPage />} />
          <Route path="docs/editor"  element={<DocEditorPage />} />
          <Route path="profile"      element={<ProfilePage />} />
          <Route path="admin/gosts" element={<Navigate to="/admin/storage" replace />} />
          <Route path="admin/storage"  element={<PrivateRoute adminOnly><StoragePage /></PrivateRoute>} />
          <Route path="admin/templates" element={<PrivateRoute adminOnly><TemplatesPage /></PrivateRoute>} />
          <Route path="admin/structures" element={<PrivateRoute adminOnly><StructuresPage /></PrivateRoute>} />
          <Route path="admin/doc-templates" element={<Navigate to="/admin/templates" replace />} />
          <Route path="admin/users"    element={<PrivateRoute adminOnly><UsersPage /></PrivateRoute>} />
          <Route path="admin/stats"    element={<PrivateRoute adminOnly><StatsPage /></PrivateRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
