import React, { useState } from 'react';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const FirebaseTest: React.FC = () => {
  const [testResult, setTestResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const testFirebaseConnection = async () => {
    setIsLoading(true);
    setTestResult('Testing Firebase connection...\n');
    
    try {
      // Test 1: Create a test document
      setTestResult(prev => prev + 'Test 1: Creating test document...\n');
      const testDoc = doc(db, 'test', 'connection');
      await setDoc(testDoc, {
        message: 'Hello Firebase!',
        timestamp: new Date(),
        testId: Math.random().toString(36).substr(2, 9)
      });
      setTestResult(prev => prev + '✅ Test document created successfully\n');
      
      // Test 2: Read the document
      setTestResult(prev => prev + 'Test 2: Reading test document...\n');
      const docSnap = await getDoc(testDoc);
      if (docSnap.exists()) {
        setTestResult(prev => prev + `✅ Test document read successfully: ${JSON.stringify(docSnap.data())}\n`);
      } else {
        setTestResult(prev => prev + '❌ Test document does not exist\n');
      }
      
      // Test 3: Create a user document
      setTestResult(prev => prev + 'Test 3: Creating user document...\n');
      const userDoc = doc(db, 'users', 'test-user-' + Date.now());
      await setDoc(userDoc, {
        displayName: 'Test User',
        email: 'test@example.com',
        createdAt: new Date(),
        testId: Math.random().toString(36).substr(2, 9)
      });
      setTestResult(prev => prev + '✅ User document created successfully\n');
      
      setTestResult(prev => prev + '\n🎉 All Firebase tests passed! Firebase is working correctly.\n');
      
    } catch (error: any) {
      console.error('Firebase test error:', error);
      setTestResult(prev => prev + `\n❌ Firebase test failed:\n`);
      setTestResult(prev => prev + `Error Code: ${error.code || 'Unknown'}\n`);
      setTestResult(prev => prev + `Error Message: ${error.message || 'Unknown error'}\n`);
      setTestResult(prev => prev + `Error Stack: ${error.stack || 'No stack trace'}\n`);
      
      // Common error explanations
      if (error.code === 'permission-denied') {
        setTestResult(prev => prev + '\n💡 This is likely a Firestore security rules issue. Check your Firebase console.\n');
      } else if (error.code === 'not-found') {
        setTestResult(prev => prev + '\n💡 Firestore might not be enabled for this project. Check your Firebase console.\n');
      } else if (error.code === 'unavailable') {
        setTestResult(prev => prev + '\n💡 Firebase service is unavailable. Check your internet connection.\n');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-gray-800 rounded-lg border border-gray-700">
      <h3 className="text-xl font-semibold mb-4 text-white">Firebase Connection Test</h3>
      <button
        onClick={testFirebaseConnection}
        disabled={isLoading}
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 mb-4"
      >
        {isLoading ? 'Testing...' : 'Test Firebase Connection'}
      </button>
      <div className="bg-gray-900 p-4 rounded text-sm text-gray-300 whitespace-pre-wrap font-mono">
        {testResult || 'Click the button to test Firebase connection...'}
      </div>
    </div>
  );
};

export default FirebaseTest;
