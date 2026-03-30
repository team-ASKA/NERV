import posthog from 'posthog-js';

export type AnalyticsEvent = 
  | 'Interview Started'
  | 'Round Completed'
  | 'Camera Denied'
  | 'Interview Abandoned'
  | 'Mic Check Failed';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;

class AnalyticsService {
  private isInitialized = false;

  init() {
    // Only initialize if we have a key and haven't initialized yet
    if (POSTHOG_KEY && !this.isInitialized) {
      posthog.init(POSTHOG_KEY, { 
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
        autocapture: false // We only want to track explicit events for interviews
      });
      this.isInitialized = true;
    }
  }

  track(eventName: AnalyticsEvent, properties?: Record<string, any>) {
    if (this.isInitialized) {
      posthog.capture(eventName, properties);
    } else {
      // Fallback logging for when the user hasn't added their PostHog key yet
      console.log(`[Analytics Event] ${eventName}`, properties || '');
    }
  }

  identify(userId: string, traits?: Record<string, any>) {
    if (this.isInitialized) {
      posthog.identify(userId, traits);
    } else {
      console.log(`[Analytics Identify] User: ${userId}`, traits || '');
    }
  }
}

export const analytics = new AnalyticsService();
