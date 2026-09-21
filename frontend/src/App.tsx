import { lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import type { Role } from './lib/types'
import { useAuth } from './store/auth'
import Login from './pages/Login'

// Each screen is downloaded when it is first opened, so the first page loads fast.
const BarcodeDesigner = lazy(() => import('./pages/BarcodeDesigner'))
const BarcodeGenerator = lazy(() => import('./pages/BarcodeGenerator'))
const Branches = lazy(() => import('./pages/Branches'))
const Categories = lazy(() => import('./pages/Categories'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const DataExport = lazy(() => import('./pages/DataExport'))
const Discounts = lazy(() => import('./pages/Discounts'))
const EndOfDay = lazy(() => import('./pages/EndOfDay'))
const Inventory = lazy(() => import('./pages/Inventory'))
const Pos = lazy(() => import('./pages/Pos'))
const Products = lazy(() => import('./pages/Products'))
const ReceiptDesigner = lazy(() => import('./pages/ReceiptDesigner'))
const Reports = lazy(() => import('./pages/Reports'))
const Sales = lazy(() => import('./pages/Sales'))
const Staff = lazy(() => import('./pages/Staff'))
const SystemSettings = lazy(() => import('./pages/SystemSettings'))
const Transfers = lazy(() => import('./pages/Transfers'))

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
        <Route path="sales" element={<Sales />} />
        <Route path="dashboard" element={<Protected roles={staff}><Dashboard /></Protected>} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="transfers" element={<Protected roles={staff}><Transfers /></Protected>} />
        <Route path="products" element={<Protected roles={staff}><Products /></Protected>} />
        <Route path="end-of-day" element={<EndOfDay />} />
        <Route path="branches" element={<Protected roles={admin}><Branches /></Protected>} />
        <Route path="staff" element={<Protected roles={admin}><Staff /></Protected>} />
        <Route path="categories" element={<Protected roles={staff}><Categories /></Protected>} />
        <Route path="discounts" element={<Protected roles={staff}><Discounts /></Protected>} />
        <Route path="barcode-designer" element={<Protected roles={staff}><BarcodeDesigner /></Protected>} />
        <Route path="barcode-generator" element={<Protected roles={staff}><BarcodeGenerator /></Protected>} />
        <Route path="receipt-designer" element={<Protected roles={admin}><ReceiptDesigner /></Protected>} />
        <Route path="reports" element={<Protected roles={staff}><Reports /></Protected>} />
        <Route path="data-export" element={<Protected roles={admin}><DataExport /></Protected>} />
        <Route path="settings" element={<Protected roles={admin}><SystemSettings /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
