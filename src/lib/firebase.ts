// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

function readEnv(key: string): string {
  try {
    const meta = import.meta as unknown as { env?: Record<string, string | undefined> };
    return meta.env?.[key] ?? '';
  } catch {
    return '';
  }
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    readEnv('VITE_FIREBASE_API_KEY') &&
    readEnv('VITE_FIREBASE_AUTH_DOMAIN') &&
    readEnv('VITE_FIREBASE_PROJECT_ID') &&
    readEnv('VITE_FIREBASE_APP_ID'),
  );
}

export function firebaseConfigStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const k of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) {
    if (!readEnv(k)) missing.push(k);
  }
  return { configured: missing.length === 0, missing };
}

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
// NOTE: initializeApp with placeholder strings does not throw at import time;
// actual auth/network calls fail later and are guarded by isFirebaseConfigured()
// plus the SetupNotice screen. This keeps the React error boundary able to render.
const firebaseConfig = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY') || 'unconfigured',
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN') || 'unconfigured',
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID') || 'unconfigured',
  storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readEnv('VITE_FIREBASE_APP_ID') || 'unconfigured',
  measurementId: readEnv('VITE_FIREBASE_MEASUREMENT_ID'),
};

// Initialize Firebase (safe at import time)
const app = initializeApp(firebaseConfig);

// Initialize Authentication
const auth = getAuth(app);

// Analytics is optional, browser-only, and never blocks boot.
let analytics: unknown = null;
if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
  void import('firebase/analytics')
    .then((m) => {
      try {
        analytics = m.getAnalytics(app);
      } catch {
        analytics = null;
      }
    })
    .catch(() => {
      analytics = null;
    });
}

// Initialize services
export const db = getFirestore(app);
export const storage = getStorage(app);

// Export the Firebase instances
export { app, analytics, auth };

export default app;
