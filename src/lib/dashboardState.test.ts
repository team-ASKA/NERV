import { describe, expect, it } from 'vitest';
import { deriveDashboardState, primaryCta } from './dashboardState';

describe('dashboard state machine', () => {
  it('first-time user uploads in one click', () => {
    const k = deriveDashboardState({
      hasResume: false, resumeReviewNeeded: false, ingesting: false,
      activeSessionId: null, latestReportStatus: 'none', loadFailed: false,
    });
    expect(k).toBe('no-resume');
    expect(primaryCta(k)).toBe('Upload resume');
  });
  it('active session resumes', () => {
    const k = deriveDashboardState({
      hasResume: true, resumeReviewNeeded: false, ingesting: false,
      activeSessionId: 's', latestReportStatus: 'none', loadFailed: false,
    });
    expect(k).toBe('active');
    expect(primaryCta(k)).toBe('Resume interview');
  });
});
