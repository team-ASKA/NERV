// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA1uiMu81WEbzsBSDqh8QQZEnT44W9cNSk",
  authDomain: "interviewer-c02fa.firebaseapp.com",
  projectId: "interviewer-c02fa",
  storageBucket: "interviewer-c02fa.firebasestorage.app",
  messagingSenderId: "917483229615",
  appId: "1:917483229615:web:413c49c5ec87e6c5235f5a",
  measurementId: "G-0TEVLRYCL4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Authentication
const auth = getAuth(app);

// Initialize Analytics only in browser environments
let analytics = null;
if (typeof window !== 'undefined') {
  analytics = getAnalytics(app);
}

// Initialize services
export const db = getFirestore(app);
export const storage = getStorage(app);

// Export the Firebase instances
export { app, analytics, auth };

export default app;