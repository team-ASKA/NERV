/** Explicit dashboard state machine: scattered booleans → one derived state. */

export type DashboardStateKind =
  | 'no-resume'
  | 'ingesting'
  | 'needs-review'
  | 'ready'
  | 'active'
  | 'report-pending'
  | 'report-ready'
  | 'load-failed';

export interface DashboardSnapshot {
  hasResume: boolean;
  resumeReviewNeeded: boolean;
  ingesting: boolean;
  activeSessionId: string | null;
  latestReportStatus: 'none' | 'pending' | 'ready' | 'failed';
  loadFailed: boolean;
}

export function deriveDashboardState(s: DashboardSnapshot): DashboardStateKind {
  if (s.loadFailed && !s.hasResume && !s.activeSessionId) return 'load-failed';
  if (s.activeSessionId) return 'active';
  if (s.ingesting) return 'ingesting';
  if (!s.hasResume) return 'no-resume';
  if (s.resumeReviewNeeded) return 'needs-review';
  if (s.latestReportStatus === 'pending') return 'report-pending';
  if (s.latestReportStatus === 'ready') return 'report-ready';
  return 'ready';
}

export function primaryCta(kind: DashboardStateKind): string {
  switch (kind) {
    case 'no-resume':
      return 'Upload resume';
    case 'ingesting':
      return 'View upload status';
    case 'needs-review':
      return 'Review resume';
    case 'active':
      return 'Resume interview';
    case 'report-pending':
      return 'View report status';
    case 'report-ready':
    case 'ready':
      return 'Start interview';
    case 'load-failed':
      return 'Retry';
  }
}
