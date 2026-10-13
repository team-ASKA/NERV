import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md p-12 text-center">
      <h1 className="text-2xl font-bold">That page doesn’t exist</h1>
      <p className="mt-2 text-sm text-white/60">Check the address, or head back to safety.</p>
      <Link to="/dashboard" className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
        Go to dashboard
      </Link>
    </div>
  );
}
