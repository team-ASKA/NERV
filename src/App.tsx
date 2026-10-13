import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/ui';
import Navbar from './components/Navbar';
import LandingPage from './pages/LandingPage';
import { demoAllowed } from './lib/config';
import { isFirebaseConfigured } from './lib/firebase';

const SignUp = lazy(() => import('./pages/SignUp'));
const Login = lazy(() => import('./pages/Login'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const InterviewContainer = lazy(() => import('./pages/InterviewContainer'));
const ReportPage = lazy(() => import('./pages/ReportPage'));
const History = lazy(() => import('./pages/History'));
const Training = lazy(() => import('./pages/Training'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));
// Legacy adapters (guarded, preserved until links migrate).
const MultiRoundInterview = lazy(() => import('./pages/MultiRoundInterview'));
const TechnicalRound = lazy(() => import('./pages/TechnicalRound'));
const CoreRound = lazy(() => import('./pages/CoreRound'));
const HRRound = lazy(() => import('./pages/HRRound'));
const NERVSummary = lazy(() => import('./pages/NERVSummary'));
const TrainingSession = lazy(() => import('./pages/TrainingSession'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="p-8 text-white/60">Loading…</p>;
  if (!currentUser && !(demoAllowed() && !isFirebaseConfigured())) {
    return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <>{children}</>;
}

function AppContent() {
  const location = useLocation();
  const isLandingPage = location.pathname === '/';

  return (
    <div className="min-h-screen bg-primary font-inter text-white">
      {isLandingPage && <Navbar />}
      <Suspense fallback={<p className="p-8 text-white/60">Loading…</p>}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<SignUp />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/interviews/new" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/interviews/:sessionId" element={<ProtectedRoute><InterviewContainer /></ProtectedRoute>} />
          <Route path="/reports/:sessionId" element={<ProtectedRoute><ReportPage /></ProtectedRoute>} />
          <Route path="/reports/legacy/:interviewId" element={<ProtectedRoute><ReportPage legacy /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
          <Route path="/training" element={<ProtectedRoute><Training /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          {/* Legacy adapters */}
          <Route path="/multi-round-interview" element={<ProtectedRoute><MultiRoundInterview /></ProtectedRoute>} />
          <Route path="/technical-round" element={<ProtectedRoute><TechnicalRound /></ProtectedRoute>} />
          <Route path="/core-round" element={<ProtectedRoute><CoreRound /></ProtectedRoute>} />
          <Route path="/hr-round" element={<ProtectedRoute><HRRound /></ProtectedRoute>} />
          <Route path="/nerv-summary" element={<ProtectedRoute><NERVSummary /></ProtectedRoute>} />
          <Route path="/training-session" element={<ProtectedRoute><TrainingSession /></ProtectedRoute>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
}

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
