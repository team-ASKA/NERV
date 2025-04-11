/**
 * Storage service using IndexedDB for large data and localStorage for small data
 */
import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { compress, decompress } from 'fflate';

// Define the database schema
interface OratoDBSchema extends DBSchema {
  'interview-data': {
    key: string;
    value: any;
    indexes: { 'by-timestamp': string };
  };
  'interview-history': {
    key: string;
    value: any[];
    indexes: { 'by-timestamp': string };
  };
  'resume-data': {
    key: string;
    value: {
      text: string;
      name: string;
      timestamp: string;
    };
  };
}

// StorageKeys enum for consistency
export enum StorageKey {
  InterviewData = 'interview-data',
  InterviewConfig = 'interview-config',
  InterviewResults = 'interview-results',
  InterviewHistory = 'interview-history',
  CurrentEmotions = 'current-emotions',
  InterviewMessages = 'interview-messages',
  ResumeText = 'resume-data',
  ImprovementPlan = 'improvement-plan',
  CurrentQuestion = 'current-question',
}

// Storage limits
const LOCAL_STORAGE_SIZE_LIMIT = 100 * 1024; // 100KB
const MAX_HISTORY_ITEMS = 20;

// Database reference
let db: IDBPDatabase<OratoDBSchema> | null = null;

/**
 * Initialize the database
 */
export const initDB = async (): Promise<void> => {
  if (!db) {
    db = await openDB<OratoDBSchema>('orato-storage', 1, {
      upgrade(database) {
        // Create stores with indexes
        const interviewStore = database.createObjectStore('interview-data', {
          keyPath: 'id',
        });
        interviewStore.createIndex('by-timestamp', 'timestamp');

        const historyStore = database.createObjectStore('interview-history', {
          keyPath: 'id',
        });
        historyStore.createIndex('by-timestamp', 'timestamp');

        database.createObjectStore('resume-data');
      },
    });
    console.log('IndexedDB initialized successfully');
  }
};

/**
 * Compress data to reduce storage size
 */
export const compressData = (data: any): Promise<Uint8Array> => {
  return new Promise((resolve, reject) => {
    const jsonStr = JSON.stringify(data);
    const uint8 = new TextEncoder().encode(jsonStr);
    
    compress(uint8, (err, compressed) => {
      if (err) {
        reject(err);
      } else {
        resolve(compressed);
      }
    });
  });
};

/**
 * Decompress data from storage
 */
export const decompressData = (compressed: Uint8Array): Promise<any> => {
  return new Promise((resolve, reject) => {
    decompress(compressed, (err, decompressed) => {
      if (err) {
        reject(err);
      } else {
        const jsonStr = new TextDecoder().decode(decompressed);
        resolve(JSON.parse(jsonStr));
      }
    });
  });
};

/**
 * Determine if data should use IndexedDB (for large data) or localStorage (for small data)
 */
const shouldUseIndexedDB = (data: any): boolean => {
  if (!data) return false;
  
  try {
    const jsonSize = JSON.stringify(data).length;
    return jsonSize > LOCAL_STORAGE_SIZE_LIMIT;
  } catch (e) {
    // If we can't stringify, it's probably too complex for localStorage
    return true;
  }
};

/**
 * Save data to the appropriate storage
 */
export const saveData = async (key: StorageKey, data: any): Promise<void> => {
  try {
    // Ensure DB is initialized
    await initDB();
    
    if (shouldUseIndexedDB(data)) {
      // For large data, use IndexedDB with compression
      const compressed = await compressData(data);
      
      if (key === StorageKey.InterviewHistory) {
        // Special handling for interview history - add to the array
        const existingData = (await db?.get('interview-history', 'history')) || [];
        existingData.push({
          ...data,
          timestamp: new Date().toISOString(),
        });
        
        // Keep only the most recent MAX_HISTORY_ITEMS
        const limitedData = existingData.slice(-MAX_HISTORY_ITEMS);
        await db?.put('interview-history', limitedData, 'history');
      } else if (key === StorageKey.ResumeText) {
        // Store resume data
        await db?.put('resume-data', {
          text: data,
          name: data.name || 'resume.pdf',
          timestamp: new Date().toISOString(),
        }, 'resume');
      } else if (key === StorageKey.InterviewData || key === StorageKey.InterviewResults) {
        // Store interview data with timestamp
        await db?.put('interview-data', {
          id: key,
          data: compressed,
          timestamp: new Date().toISOString(),
        });
      } else {
        // For other large data
        await db?.put('interview-data', {
          id: key,
          data: compressed,
          timestamp: new Date().toISOString(),
        });
      }
      
      // Set a flag in localStorage to indicate data is in IndexedDB
      localStorage.setItem(`${key}_inIDB`, 'true');
    } else {
      // For small data, use localStorage
      localStorage.setItem(key, JSON.stringify(data));
      // Remove the IndexedDB flag if it exists
      localStorage.removeItem(`${key}_inIDB`);
    }
  } catch (error) {
    console.error(`Error saving data for key ${key}:`, error);
    // Fallback to localStorage with warning
    try {
      localStorage.setItem(key, JSON.stringify(data));
      console.warn(`Data for ${key} saved to localStorage as fallback. May exceed size limits.`);
    } catch (lsError) {
      console.error(`Failed to save data even with localStorage fallback:`, lsError);
      throw new Error(`Storage failure: ${lsError instanceof Error ? lsError.message : 'Unknown error'}`);
    }
  }
};

/**
 * Load data from the appropriate storage
 */
export const loadData = async <T>(key: StorageKey, defaultValue: T): Promise<T> => {
  try {
    // Ensure DB is initialized
    await initDB();
    
    // Check if data is in IndexedDB
    const inIDB = localStorage.getItem(`${key}_inIDB`) === 'true';
    
    if (inIDB) {
      // Retrieve from IndexedDB
      if (key === StorageKey.InterviewHistory) {
        const history = await db?.get('interview-history', 'history');
        return (history || defaultValue) as T;
      } else if (key === StorageKey.ResumeText) {
        const resume = await db?.get('resume-data', 'resume');
        return (resume?.text || defaultValue) as T;
      } else {
        // For other data
        const record = await db?.get('interview-data', key);
        if (record && record.data) {
          const decompressed = await decompressData(record.data);
          return decompressed as T;
        }
      }
    }
    
    // If not in IndexedDB or retrieval failed, try localStorage
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : defaultValue;
  } catch (error) {
    console.error(`Error loading data for key ${key}:`, error);
    // Return default value if retrieval fails
    return defaultValue;
  }
};

/**
 * Delete data from storage
 */
export const deleteData = async (key: StorageKey): Promise<void> => {
  try {
    // Ensure DB is initialized
    await initDB();
    
    // Check if data is in IndexedDB
    const inIDB = localStorage.getItem(`${key}_inIDB`) === 'true';
    
    if (inIDB) {
      // Delete from IndexedDB
      if (key === StorageKey.InterviewHistory) {
        await db?.delete('interview-history', 'history');
      } else if (key === StorageKey.ResumeText) {
        await db?.delete('resume-data', 'resume');
      } else {
        await db?.delete('interview-data', key);
      }
      localStorage.removeItem(`${key}_inIDB`);
    }
    
    // Always remove from localStorage
    localStorage.removeItem(key);
  } catch (error) {
    console.error(`Error deleting data for key ${key}:`, error);
  }
};

/**
 * Clean up old data to prevent storage overflow
 */
export const cleanupOldData = async (): Promise<void> => {
  try {
    // Ensure DB is initialized
    await initDB();
    
    // Get interview data sorted by timestamp
    const tx = db?.transaction('interview-data', 'readwrite');
    const index = tx?.store.index('by-timestamp');
    if (!index) return;
    
    // Get all records sorted by timestamp
    let cursor = await index.openCursor();
    const records: { key: string; timestamp: string }[] = [];
    
    while (cursor) {
      records.push({
        key: cursor.key as string,
        timestamp: cursor.value.timestamp,
      });
      cursor = await cursor.continue();
    }
    
    // Keep only the most recent data for each type
    const keysToKeep = new Set<string>();
    const typeCounts = new Map<string, number>();
    
    // Sort records by timestamp (newest first)
    records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    for (const record of records) {
      // Extract type from key (e.g., 'interview-data-123' -> 'interview-data')
      const type = record.key.split('-').slice(0, -1).join('-');
      const count = typeCounts.get(type) || 0;
      
      if (count < 5) { // Keep last 5 of each type
        keysToKeep.add(record.key);
        typeCounts.set(type, count + 1);
      }
    }
    
    // Delete old records
    for (const record of records) {
      if (!keysToKeep.has(record.key)) {
        await tx?.store.delete(record.key);
      }
    }
    
    await tx?.done;
    console.log('Storage cleanup completed successfully');
  } catch (error) {
    console.error('Error during storage cleanup:', error);
  }
};

// Initialize the database when the service is imported
initDB().catch(error => console.error('Failed to initialize IndexedDB:', error)); 