import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface AuthContextType {
  currentUser: User | null;
  signup: (email: string, password: string) => Promise<any>;
  login: (email: string, password: string) => Promise<any>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  signup: async () => {},
  login: async () => {},
  logout: async () => {},
  loading: true
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Save user data to Firestore
  const saveUserData = async (user: User) => {
    if (!user) return;

    try {
      const userRef = doc(db, "users", user.uid);
      
      // Check if user document already exists
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        // Only create a new document if it doesn't exist
        const userData = {
          displayName: user.displayName || "",
          email: user.email || "",
          photoURL: user.photoURL || "",
          createdAt: new Date().toISOString(),
          interviewsCompleted: 0
        };
        
        await setDoc(userRef, userData);
        console.log("User document created with ID:", user.uid);
      }
    } catch (error) {
      console.error("Error saving user data:", error);
    }
  };

  function signup(email: string, password: string) {
    return createUserWithEmailAndPassword(auth, email, password);
  }

  function login(email: string, password: string) {
    return signInWithEmailAndPassword(auth, email, password);
  }

  function logout() {
    return signOut(auth);
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await saveUserData(user);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    signup,
    login,
    logout,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}