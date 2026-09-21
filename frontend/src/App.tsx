import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import type { Role } from './lib/types'
import { useAuth } from './store/auth'
import Branches from './pages/Branches'
import Dashboard from './pages/Dashboard'
import EndOfDay from './pages/EndOfDay'
import Inventory from './pages/Inventory'
import Login from './pages/Login'
import Pos from './pages/Pos'
import Products from './pages/Products'
import Staff from './pages/Staff'
import Transfers from './pages/Transfers'

function Protected({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const user = useAuth((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

function Home() {
  const user = useAuth((s) => s.user)
  return <Navigate to={user?.role === 'cashier' ? '/pos' : '/dashboard'} replace />
}

export default function App() {
  const staff: Role[] = ['admin', 'manager']
  const admin: Role[] = ['admin']
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Home />} />
        <Route path="pos" element={<Pos />} />
        <Route path="dashboard" element={<Protected roles={staff}><Dashboard /></Protected>} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="transfers" element={<Protected roles={staff}><Transfers /></Protected>} />
        <Route path="products" element={<Protected roles={staff}><Products /></Protected>} />
        <Route path="end-of-day" element={<EndOfDay />} />
        <Route path="branches" element={<Protected roles={admin}><Branches /></Protected>} />
        <Route path="staff" element={<Protected roles={admin}><Staff /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
