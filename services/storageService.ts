
import { DebugPageData, HistoryMetadata, DetectedQuestion, QuestionImage } from "../types";

const DB_NAME = "MathSplitterDB";
// STORE_INDEX contains only metadata: { id, name, timestamp, pageCount }
const STORE_INDEX = "exams"; 
// STORE_DETAILS contains heavy data: { id, rawPages, questions }
const STORE_DETAILS = "exam_details"; 

const DB_VERSION = 3; // Keep version 3 as per previous migration

/**
 * Open (and initialize) the IndexedDB
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = (event.target as IDBOpenDBRequest).transaction;

      // 1. Ensure Index Store Exists
      if (!db.objectStoreNames.contains(STORE_INDEX)) {
        db.createObjectStore(STORE_INDEX, { keyPath: "id" });
      }

      // 2. Ensure Details Store Exists
      if (!db.objectStoreNames.contains(STORE_DETAILS)) {
        db.createObjectStore(STORE_DETAILS, { keyPath: "id" });
      }

      // 3. MIGRATION LOGIC: Split existing full records into Meta + Details
      if (transaction) {
        // Only run migration if we detect we might have old data structures or need to ensure integrity
        // In this specific flow, standard creation is enough.
        // If we were upgrading from v2 to v3, the logic below runs.
        const indexStore = transaction.objectStore(STORE_INDEX);
        const detailsStore = transaction.objectStore(STORE_DETAILS);

        // Check if indexStore has items that might still be heavy (from v1/v2)
        // Note: In a real upgrade scenario from v2, the store name was 'exams' which is now STORE_INDEX.
        // So we iterate it to strip heavy data.
        indexStore.openCursor().onsuccess = (e: any) => {
          const cursor = e.target.result;
          if (cursor) {
            const record = cursor.value;
            
            // If the record still contains heavy data (rawPages), split it
            if (record.rawPages) {
              // Move heavy data to details store
              detailsStore.put({
                id: record.id,
                rawPages: record.rawPages,
                questions: record.questions || []
              });

              // Update index store to keep ONLY metadata
              const metaOnly = {
                id: record.id,
                name: record.name,
                timestamp: record.timestamp,
                pageCount: record.pageCount
              };
              cursor.update(metaOnly);
            }
            cursor.continue();
          }
        };

        // Clean up the temporary meta store from previous attempts if it exists
        if (db.objectStoreNames.contains("exams_meta")) {
            db.deleteObjectStore("exams_meta");
        }
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
 * Save an exam result. 
 * Writes metadata to 'exams' and blobs to 'exam_details'.
 */
export const saveExamResult = async (fileName: string, rawPages: DebugPageData[], questions: QuestionImage[] = []): Promise<string> => {
  const db = await openDB();
  
  // Check if updating existing
  const list = await getHistoryList();
  const existing = list.find(h => h.name === fileName);
  const id = existing ? existing.id : crypto.randomUUID();
  const timestamp = Date.now();

  // Deduplicate pages
  const uniquePages = Array.from(new Map(rawPages.map(item => [item.pageNumber, item])).values());
  uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

  const metaRecord: HistoryMetadata = {
    id,
    name: fileName,
    timestamp,
    pageCount: uniquePages.length
  };

  const detailsRecord = {
    id,
    rawPages: uniquePages,
    questions: questions
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
    
    transaction.objectStore(STORE_INDEX).put(metaRecord);
    transaction.objectStore(STORE_DETAILS).put(detailsRecord);

    transaction.oncomplete = () => resolve(id);
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Update existing exam. Used for Re-analysis.
 */
export const reSaveExamResult = async (fileName: string, rawPages: DebugPageData[], questions?: QuestionImage[]): Promise<void> => {
  return saveExamResult(fileName, rawPages, questions || []).then(() => {});
};

/**
 * Update detections/questions for a specific page.
 * FIXED: Now updates timestamp in STORE_INDEX to ensure consistency.
 */
export const updatePageDetectionsAndQuestions = async (
    fileName: string, 
    pageNumber: number, 
    newDetections: DetectedQuestion[], 
    newFileQuestions: QuestionImage[]
): Promise<void> => {
  const list = await getHistoryList();
  const targetItem = list.find(h => h.name === fileName);
  if (!targetItem) return;

  const db = await openDB();
  return new Promise((resolve, reject) => {
    // Open transaction on BOTH stores
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
    const detailsStore = transaction.objectStore(STORE_DETAILS);
    const indexStore = transaction.objectStore(STORE_INDEX);
    
    // 1. Get Details
    const getReq = detailsStore.get(targetItem.id);
    
    getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record || !record.rawPages) {
            resolve();
            return;
        }

        // Update specific page in Details
        const pageIndex = record.rawPages.findIndex((p: DebugPageData) => p.pageNumber === pageNumber);
        if (pageIndex !== -1) {
            record.rawPages[pageIndex].detections = newDetections;
        }

        // Update questions in Details
        record.questions = newFileQuestions;
        detailsStore.put(record);

        // 2. Update Timestamp in Index (Meta)
        // We get the current meta to preserve other fields, just update timestamp
        const metaReq = indexStore.get(targetItem.id);
        metaReq.onsuccess = () => {
            const meta = metaReq.result;
            if (meta) {
                meta.timestamp = Date.now();
                indexStore.put(meta);
            }
        };

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
};

export const updatePageDetections = async (fileName: string, pageNumber: number, newDetections: DetectedQuestion[]) => {
    return updatePageDetectionsAndQuestions(fileName, pageNumber, newDetections, []); 
};

/**
 * Update ONLY questions for a specific exam ID.
 * FIXED: Now updates timestamp in STORE_INDEX to ensure consistency.
 */
export const updateExamQuestionsOnly = async (id: string, questions: QuestionImage[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
    const detailsStore = transaction.objectStore(STORE_DETAILS);
    const indexStore = transaction.objectStore(STORE_INDEX);
    
    // 1. Update Details
    const getReq = detailsStore.get(id);
    getReq.onsuccess = () => {
        const record = getReq.result;
        if (record) {
            record.questions = questions;
            detailsStore.put(record);

            // 2. Update Timestamp in Index
            const metaReq = indexStore.get(id);
            metaReq.onsuccess = () => {
                const meta = metaReq.result;
                if (meta) {
                    meta.timestamp = Date.now();
                    indexStore.put(meta);
                }
            };
            
            transaction.oncomplete = () => resolve();
        } else {
            resolve();
        }
    };
    getReq.onerror = () => reject(getReq.error);
  });
};


/**
 * Get History List.
 * FAST: Only reads from the lightweight 'exams' store.
 */
export const getHistoryList = async (): Promise<HistoryMetadata[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX], "readonly");
    const store = transaction.objectStore(STORE_INDEX);
    const request = store.getAll();

    request.onsuccess = () => {
      const results = request.result as HistoryMetadata[];
      resolve(results.sort((a, b) => b.timestamp - a.timestamp));
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Load full exam result.
 * JOIN: Fetches metadata from 'exams' and heavy blobs from 'exam_details'.
 */
export const loadExamResult = async (id: string): Promise<{ rawPages: DebugPageData[], questions?: QuestionImage[], name: string } | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS], "readonly");
    
    // We need both parts
    const metaReq = transaction.objectStore(STORE_INDEX).get(id);
    const detailsReq = transaction.objectStore(STORE_DETAILS).get(id);

    // Wait for transaction completion or handle manual Promise.all
    let meta: HistoryMetadata | null = null;
    let details: any | null = null;
    let completed = 0;

    const checkDone = () => {
        if (completed === 2) {
            if (meta && details) {
                resolve({
                    name: meta.name,
                    rawPages: details.rawPages || [],
                    questions: details.questions || []
                });
            } else if (meta && !details) {
                // Should not happen unless migration failed, but robust fallback
                resolve({
                    name: meta.name,
                    rawPages: [],
                    questions: []
                });
            } else {
                resolve(null);
            }
        }
    };

    metaReq.onsuccess = () => { meta = metaReq.result; completed++; checkDone(); };
    detailsReq.onsuccess = () => { details = detailsReq.result; completed++; checkDone(); };
    
    transaction.onerror = () => reject(transaction.error);
  });
};

/**
 * Delete. Removes from BOTH stores.
 */
export const deleteExamResult = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
    transaction.objectStore(STORE_INDEX).delete(id);
    transaction.objectStore(STORE_DETAILS).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteExamResults = async (ids: string[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
    const indexStore = transaction.objectStore(STORE_INDEX);
    const detailsStore = transaction.objectStore(STORE_DETAILS);

    ids.forEach(id => {
        indexStore.delete(id);
        detailsStore.delete(id);
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const cleanupHistoryItem = async (id: string): Promise<number> => {
  const db = await openDB();
  
  // Get Details
  const details: any = await new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_DETAILS], "readonly");
      const req = tx.objectStore(STORE_DETAILS).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
  });

  if (!details || !details.rawPages) return 0;

  const originalCount = details.rawPages.length;
  const uniqueMap = new Map();
  
  details.rawPages.forEach((p: DebugPageData) => {
      if (!uniqueMap.has(p.pageNumber)) {
          uniqueMap.set(p.pageNumber, p);
      } else {
          const existing = uniqueMap.get(p.pageNumber);
          if (p.detections.length > existing.detections.length) {
              uniqueMap.set(p.pageNumber, p);
          }
      }
  });
  
  const uniquePages = Array.from(uniqueMap.values());
  uniquePages.sort((a: any, b: any) => a.pageNumber - b.pageNumber);

  if (uniquePages.length === originalCount) return 0;

  // Update
  await new Promise<void>((resolve, reject) => {
     const tx = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
     
     // Update Details
     details.rawPages = uniquePages;
     tx.objectStore(STORE_DETAILS).put(details);

     // Update Meta Page Count and Timestamp
     const metaReq = tx.objectStore(STORE_INDEX).get(id);
     metaReq.onsuccess = () => {
         const meta = metaReq.result;
         if (meta) {
             meta.pageCount = uniquePages.length;
             meta.timestamp = Date.now(); // Also update timestamp for consistency
             tx.objectStore(STORE_INDEX).put(meta);
         }
     };
     
     tx.oncomplete = () => resolve();
     tx.onerror = () => reject(tx.error);
  });

  return originalCount - uniquePages.length;
};

export const cleanupAllHistory = async (): Promise<number> => {
  const list = await getHistoryList();
  let totalRemoved = 0;
  for (const item of list) {
      try {
          const removed = await cleanupHistoryItem(item.id);
          totalRemoved += removed;
      } catch (e) { console.error(e); }
  }
  return totalRemoved;
};
