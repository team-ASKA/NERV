import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import LandingPage from './pages/LandingPage';
import SignUp from './pages/SignUp';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Interview from './pages/Interview';
import MultiRoundInterview from './pages/MultiRoundInterview';
import TechnicalRound from './pages/TechnicalRound';
import CoreRound from './pages/CoreRound';
import HRRound from './pages/HRRound';
import InterviewSummary from './pages/InterviewSummary';
import EnhancedInterviewSummary from './pages/EnhancedInterviewSummary';
import NERVSummary from './pages/NERVSummary';
import ProfessionalSummary from './pages/ProfessionalSummary';
import Results from './pages/Results';
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
    <div className="min-h-screen bg-primary font-inter">
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
        <Route path="/interview" element={
          <ProtectedRoute>
            <Interview />
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
        <Route path="/interview-summary" element={
          <ProtectedRoute>
            <InterviewSummary />
          </ProtectedRoute>
        } />
        <Route path="/enhanced-summary" element={
          <ProtectedRoute>
            <EnhancedInterviewSummary />
          </ProtectedRoute>
        } />
        <Route path="/nerv-summary" element={
          <ProtectedRoute>
            <NERVSummary />
          </ProtectedRoute>
        } />
        <Route path="/professional-summary" element={
          <ProtectedRoute>
            <ProfessionalSummary />
          </ProtectedRoute>
        } />
        <Route path="/results" element={
          <ProtectedRoute>
            <Results />
          </ProtectedRoute>
        } />
      </Routes>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;