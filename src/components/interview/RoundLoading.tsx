import { Spinner } from '../ui';

export interface RoundLoadingProps {
  label?: string;
}

/** Full-screen placeholder while a round's context is still loading. */
export function RoundLoading({ label = 'Preparing your round…' }: RoundLoadingProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-primary">
      <Spinner size={26} />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

export default RoundLoading;
