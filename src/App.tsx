import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/ui';
import Navbar from './components/Navbar';
import LandingPage from './pages/LandingPage';
import SignUp from './pages/SignUp';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MultiRoundInterview from './pages/MultiRoundInterview';
import TechnicalRound from './pages/TechnicalRound';
import CoreRound from './pages/CoreRound';
import HRRound from './pages/HRRound';
import NERVSummary from './pages/NERVSummary';
import TrainingSession from './pages/TrainingSession';
import { useAuth } from './contexts/AuthContext';

// Protected route component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { currentUser } = useAuth();

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  return <>{children}</>;
};

// Component to conditionally render Navbar
const AppContent = () => {
  const location = useLocation();
  const isLandingPage = location.pathname === '/';

  return (
    <div className="min-h-screen bg-primary font-inter text-white">
      {isLandingPage && <Navbar />}
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        } />
        <Route path="/multi-round-interview" element={
          <ProtectedRoute>
            <MultiRoundInterview />
          </ProtectedRoute>
        } />
        <Route path="/technical-round" element={
          <ProtectedRoute>
            <TechnicalRound />
          </ProtectedRoute>
        } />
        <Route path="/core-round" element={
          <ProtectedRoute>
            <CoreRound />
          </ProtectedRoute>
        } />
        <Route path="/hr-round" element={
          <ProtectedRoute>
            <HRRound />
          </ProtectedRoute>
        } />
        <Route path="/nerv-summary" element={
          <ProtectedRoute>
            <NERVSummary />
          </ProtectedRoute>
        } />
        <Route path="/training-session" element={
          <ProtectedRoute>
            <TrainingSession />
          </ProtectedRoute>
        } />
        {/* Any unknown path returns to landing */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Router>
          <AppContent />
        </Router>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
