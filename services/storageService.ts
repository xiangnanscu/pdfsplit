
import { DebugPageData, HistoryMetadata, JobStatus } from "../types";

const DB_NAME = "MathSplitterDB";
const STORE_NAME = "exams";
const DB_VERSION = 2; // Incremented version for schema changes

interface ExamRecord {
  id: string;
  name: string;
  timestamp: number;
  pageCount: number;
  status: JobStatus;
  totalExpectedPages: number;
  fileBlob?: Blob; // Store the original file to allow resume after refresh
  rawPages: DebugPageData[];
}

/**
 * Open (and initialize) the IndexedDB
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

/**
 * Initialize a new Job (Draft)
 */
export const initJob = async (fileName: string, fileBlob: Blob, totalExpectedPages: number = 0): Promise<string> => {
    const db = await openDB();
    const id = crypto.randomUUID();
    const timestamp = Date.now();
  
    const record: ExamRecord = {
      id,
      name: fileName,
      timestamp,
      pageCount: 0,
      status: JobStatus.IN_PROGRESS,
      totalExpectedPages,
      fileBlob: fileBlob,
      rawPages: []
    };
  
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(record);
  
      request.onsuccess = () => resolve(id);
      request.onerror = () => reject(request.error);
    });
};

/**
 * Append a single page result to an existing job.
 * This provides page-level granularity for saving.
 */
export const addPageToJob = async (jobId: string, pageData: DebugPageData): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        
        const getReq = store.get(jobId);
        
        getReq.onsuccess = () => {
            const record = getReq.result as ExamRecord;
            if (!record) {
                reject(new Error("Job not found"));
                return;
            }

            // Check if page already exists to avoid duplicates
            const exists = record.rawPages.some(p => p.pageNumber === pageData.pageNumber);
            if (!exists) {
                record.rawPages.push(pageData);
                // Sort pages to keep order
                record.rawPages.sort((a, b) => a.pageNumber - b.pageNumber);
                record.pageCount = record.rawPages.length;
                
                // Update timestamp to show activity
                record.timestamp = Date.now();
                
                const putReq = store.put(record);
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error);
            } else {
                resolve();
            }
        };
        getReq.onerror = () => reject(getReq.error);
    });
};

/**
 * Mark a job as fully completed.
 */
export const completeJob = async (jobId: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const getReq = store.get(jobId);
        
        getReq.onsuccess = () => {
            const record = getReq.result as ExamRecord;
            if (record) {
                record.status = JobStatus.COMPLETED;
                // Optional: Clear blob to save space if we don't want to support re-processing from source later
                // record.fileBlob = undefined; 
                store.put(record);
            }
            resolve();
        };
        getReq.onerror = () => reject(getReq.error);
    });
};

/**
 * Save an exam result to history (Legacy / One-shot save)
 * Now wraps initJob + addPages + completeJob logic implicitly or just overwrites.
 */
export const saveExamResult = async (fileName: string, rawPages: DebugPageData[]): Promise<string> => {
  // Logic adapted to new schema
  const db = await openDB();
  const id = crypto.randomUUID();
  const timestamp = Date.now();

  const record: ExamRecord = {
    id,
    name: fileName,
    timestamp,
    pageCount: rawPages.length,
    status: JobStatus.COMPLETED,
    totalExpectedPages: rawPages.length,
    rawPages,
    fileBlob: undefined 
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get a list of all history items (Metadata only)
 */
export const getHistoryList = async (): Promise<HistoryMetadata[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    const results: HistoryMetadata[] = [];

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        const { id, name, timestamp, pageCount, status, totalExpectedPages } = cursor.value;
        results.push({ id, name, timestamp, pageCount, status, totalExpectedPages });
        cursor.continue();
      } else {
        // Sort by newest first
        resolve(results.sort((a, b) => b.timestamp - a.timestamp));
      }
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Load full data for a specific history item, including the Blob if available
 */
export const loadExamResult = async (id: string): Promise<{ rawPages: DebugPageData[], name: string, fileBlob?: Blob, status?: JobStatus } | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      if (request.result) {
        resolve({
          rawPages: request.result.rawPages,
          name: request.result.name,
          fileBlob: request.result.fileBlob,
          status: request.result.status
        });
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Find the most recent incomplete job
 */
export const getLatestIncompleteJob = async (): Promise<HistoryMetadata | null> => {
    const list = await getHistoryList();
    const incomplete = list.find(item => item.status === JobStatus.IN_PROGRESS);
    return incomplete || null;
};

/**
 * Delete a history item
 */
export const deleteExamResult = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete multiple history items
 */
export const deleteExamResults = async (ids: string[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    ids.forEach(id => {
        store.delete(id);
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};
