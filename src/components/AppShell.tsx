import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, LayoutDashboard, GraduationCap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/cn';
import { Button } from './ui/Button';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/training-session', label: 'Training', icon: GraduationCap },
];

export interface AppShellProps {
  children: React.ReactNode;
  /** Wrap content in a centered max-width container (default true). */
  container?: boolean;
  className?: string;
}

/** Consistent chrome (top nav + content area) for authenticated, non-immersive pages. */
export function AppShell({ children, container = true, className }: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  };

  const initial = (currentUser?.email?.[0] ?? 'U').toUpperCase();

  return (
    <div className="min-h-screen bg-primary">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-primary/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link to="/dashboard" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-montserrat text-sm font-bold text-white">
                N
              </span>
              <span className="font-montserrat text-lg font-bold tracking-tight text-white">NERV</span>
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              {navItems.map(({ to, label, icon: Icon }) => {
                const active = location.pathname === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    className={cn(
                      'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-accent-muted text-accent-soft'
                        : 'text-muted hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <Icon size={16} />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            {currentUser?.email && (
              <span className="hidden max-w-[180px] truncate text-sm text-muted md:block">
                {currentUser.email}
              </span>
            )}
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-sm font-semibold text-accent-soft">
              {initial}
            </span>
            <Button variant="ghost" size="sm" leftIcon={<LogOut size={16} />} onClick={handleLogout}>
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </div>
      </header>
      <main className={cn(container && 'mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8', className)}>
        {children}
      </main>
    </div>
  );
}

export default AppShell;
