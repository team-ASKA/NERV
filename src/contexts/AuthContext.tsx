import { createContext, useContext, useEffect, useState } from 'react';
import {
  type User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from 'firebase/auth';
import { auth, isFirebaseConfigured } from '../lib/firebase';
import { demoAllowed } from '../lib/config';
import { clearAccountCaches } from '../lib/accountCache';

interface AuthContextType {
  currentUser: User | null;
  signup: (email: string, password: string) => Promise<unknown>;
  login: (email: string, password: string, remember?: boolean) => Promise<unknown>;
  logout: () => Promise<void>;
  loading: boolean;
  unconfigured: boolean;
  demo: boolean;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  signup: async () => {},
  login: async () => {},
  logout: async () => {},
  loading: true,
  unconfigured: false,
  demo: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

const DEMO_USER = {
  uid: 'demo-user',
  email: 'demo@nerv.local',
  displayName: 'Demo User',
} as unknown as User;

let lastUid: string | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const unconfigured = !isFirebaseConfigured() && !demoAllowed();
  const demo = demoAllowed() || (!isFirebaseConfigured() && demoAllowed());

  function signup(email: string, password: string) {
    if (demoAllowed()) return Promise.resolve({ user: DEMO_USER });
    return createUserWithEmailAndPassword(auth, email, password);
  }

  async function login(email: string, password: string, remember = true) {
    if (demoAllowed()) {
      setCurrentUser(DEMO_USER);
      return { user: DEMO_USER };
    }
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    return signInWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    const uid = currentUser?.uid ?? lastUid;
    try {
      if (!demoAllowed() && isFirebaseConfigured()) await signOut(auth);
    } finally {
      if (uid) clearAccountCaches(uid);
      lastUid = null;
      setCurrentUser(null);
    }
  }

  useEffect(() => {
    if (demoAllowed()) {
      setLoading(false);
      return;
    }
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      // Account switch: drop the previous account's cached resume/session data.
      if (lastUid && user?.uid !== lastUid) clearAccountCaches(lastUid);
      lastUid = user?.uid ?? null;
      setCurrentUser(user);
      // Do NOT block rendering on Firestore profile fetch: profile loads
      // independently via the API layer (D02/D03). A slow/failed profile
      // must never hang auth bootstrap.
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const value = {
    currentUser: demoAllowed() && !currentUser ? null : currentUser,
    signup,
    login,
    logout,
    loading,
    unconfigured,
    demo: demoAllowed(),
  };

  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
}
