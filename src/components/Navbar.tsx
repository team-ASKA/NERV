import { Link } from 'react-router-dom';

/** Public top nav for the landing / marketing surface. */
const Navbar = () => {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 bg-primary/70 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="font-montserrat text-xl font-bold tracking-tight text-white">NERV</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to="/login"
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-white"
          >
            Login
          </Link>
          <Link
            to="/signup"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/85"
          >
            Sign Up
          </Link>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
