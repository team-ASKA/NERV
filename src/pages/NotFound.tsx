import { Link } from 'react-router-dom';
import { Button } from '../components/ui';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-primary font-inter text-white">
      <header className="mx-auto flex h-16 max-w-7xl items-center px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2" aria-label="NERV home">
          <span className="font-montserrat text-lg font-bold tracking-tight text-white">NERV</span>
        </Link>
      </header>
      <main className="mx-auto max-w-md px-4 pb-16 pt-24 text-center sm:pt-32">
        <p className="font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-calm-faint">404 / no signal</p>
        <h1 className="mt-3 font-montserrat text-[30px] font-bold tracking-[-0.02em]">That page does not exist</h1>
        <p className="mt-3 text-[15px] leading-[1.55] text-calm">
          Check the address, or pick a way back.
        </p>
        <div className="mt-6">
          <Link to="/dashboard">
            <Button size="lg">Go to dashboard</Button>
          </Link>
        </div>
        <nav aria-label="Popular pages" className="mt-6 flex items-center justify-center gap-5 text-[14px]">
          <Link to="/dashboard" className="text-calm hover:text-white">Dashboard</Link>
          <Link to="/training" className="text-calm hover:text-white">Practice</Link>
          <Link to="/settings" className="text-calm hover:text-white">Settings</Link>
        </nav>
      </main>
    </div>
  );
}
