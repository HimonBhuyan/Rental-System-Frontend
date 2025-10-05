import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Login from './components/auth/Login'
import Dashboard from './components/Dashboard'
import TenantDashboard from './components/tenant/TenantDashboard'
import TenantProfile from './components/tenant/TenantProfile'
import ClientDashboard from './components/client/ClientDashboard'
import OwnerDashboard from './components/owner/OwnerDashboard'
import Help from './components/Help'
import RazorpayScript from './components/RazorpayScript'
import ClientDiagnostic from './components/ClientDiagnostic'
import ProfileDiagnostic from './components/ProfileDiagnostic'
import { UserProvider, useUser } from './context/UserContext'
import { OwnerProvider } from './context/OwnerContext'
import { RealTimeNotificationProvider } from './context/RealTimeNotificationContext'
import './App.css'

const AppContent = () => {
  const { user, login, logout, loading } = useUser()

  if (loading) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <Router>
      <div className="App">
        <RazorpayScript />
        <Toaster position="top-right" />
        <Routes>
          <Route 
            path="/login" 
            element={user ? <Navigate to="/dashboard" /> : <Login onLogin={login} />} 
          />
          <Route 
            path="/dashboard" 
            element={user ? <Dashboard user={user} onLogout={logout} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/tenant" 
            element={user && user.role === 'tenant' ? <ClientDashboard user={user} onLogout={logout} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/tenant/profile" 
            element={user && user.role === 'tenant' ? <TenantProfile onLogout={logout} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/client" 
            element={user && user.role === 'tenant' ? <ClientDashboard user={user} onLogout={logout} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/help" 
            element={user ? <Help onLogout={logout} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/owner" 
            element={user && user.role === 'owner' ? <OwnerDashboard onLogout={logout} /> : <Navigate to="/login" />} 
          />
          <Route 
            path="/diagnostic" 
            element={<ClientDiagnostic />} 
          />
          <Route 
            path="/profile-diagnostic" 
            element={<ProfileDiagnostic />} 
          />
          <Route 
            path="/" 
            element={<Navigate to={user ? "/dashboard" : "/login"} />} 
          />
        </Routes>
      </div>
    </Router>
  )
}

function App() {
  return (
    <UserProvider>
      <OwnerProvider>
        <RealTimeNotificationProvider>
          <AppContent />
        </RealTimeNotificationProvider>
      </OwnerProvider>
    </UserProvider>
  )
}

export default App
