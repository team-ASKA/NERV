import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebase';
import { Button, Card, Input } from '../components/ui';
import SetupNotice from '../components/SetupNotice';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setDone(true);
    } catch {
      setError('Could not send a reset link. Check the address and retry.');
    }
  };

  if (!isFirebaseConfigured()) {
    return (
      <div className="mx-auto max-w-md p-8">
        <SetupNotice section="password reset" />
        <Link to="/login" className="mt-4 inline-block text-sm font-bold text-white">Back to login</Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h1 className="text-xl font-bold">Reset your password</h1>
        {done ? (
          <p className="text-sm text-white/70" role="status">If that address has an account, a reset link is on its way.</p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
            <Button type="submit" fullWidth>Send reset link</Button>
          </form>
        )}
        <Link to="/login" className="block text-center text-sm font-bold text-white">Back to login</Link>
      </Card>
    </div>
  );
}
