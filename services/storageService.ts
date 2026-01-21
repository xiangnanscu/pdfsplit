
import { DebugPageData, HistoryMetadata, DetectedQuestion, QuestionImage } from "../types";

const DB_NAME = "MathSplitterDB";
const STORE_INDEX = "exams"; 
const STORE_DETAILS = "exam_details"; 
const STORE_CHUNKS = "exam_chunks"; // New store for image blobs

const DB_VERSION = 4; // Upgrade to v4 for Chunking

/**
 * Open (and initialize) the IndexedDB
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains(STORE_INDEX)) {
        db.createObjectStore(STORE_INDEX, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_DETAILS)) {
        db.createObjectStore(STORE_DETAILS, { keyPath: "id" });
      }
      // Create Chunks Store: Key will be a composite string like "examID#type#fileName#id"
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS);
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
 * Helper to generate chunk keys
 */
const getChunkKey = (examId: string, type: 'q' | 'p', fileName: string, id: string | number) => {
    return `${examId}#${type}#${fileName}#${id}`;
};

/**
 * Save an exam result with CHUNKING.
 * Separates heavy base64 strings into the chunks store.
 */
export const saveExamResult = async (fileName: string, rawPages: DebugPageData[], questions: QuestionImage[] = []): Promise<string> => {
  const db = await openDB();
  
  const list = await getHistoryList();
  const existing = list.find(h => h.name === fileName);
  const id = existing ? existing.id : crypto.randomUUID();
  const timestamp = Date.now();

  // Deduplicate pages
  const uniquePages = Array.from(new Map(rawPages.map(item => [item.pageNumber, item])).values());
  uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

  // Prepare Metadata
  const metaRecord: HistoryMetadata = {
    id,
    name: fileName,
    timestamp,
    pageCount: uniquePages.length
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS, STORE_CHUNKS], "readwrite");
    const chunksStore = transaction.objectStore(STORE_CHUNKS);
    
    // 1. Process Pages: Strip DataURL, Save to Chunks
    const skeletonPages = uniquePages.map(p => {
        if (p.dataUrl) {
            const key = getChunkKey(id, 'p', p.fileName, p.pageNumber);
            chunksStore.put(p.dataUrl, key);
        }
        // Return skeleton
        return {
            ...p,
            dataUrl: undefined // Remove from main object
        };
    });

    // 2. Process Questions: Strip DataURL, Save to Chunks
    const skeletonQuestions = questions.map(q => {
        if (q.dataUrl) {
            const key = getChunkKey(id, 'q', q.fileName, q.id);
            chunksStore.put(q.dataUrl, key);
        }
        if (q.originalDataUrl) {
            const keyOrig = getChunkKey(id, 'q', q.fileName, `${q.id}_orig`);
            chunksStore.put(q.originalDataUrl, keyOrig);
        }
        return {
            ...q,
            dataUrl: undefined,
            originalDataUrl: undefined
        };
    });

    // 3. Save Details (Skeleton)
    const detailsRecord = {
        id,
        rawPages: skeletonPages,
        questions: skeletonQuestions
    };

    transaction.objectStore(STORE_INDEX).put(metaRecord);
    transaction.objectStore(STORE_DETAILS).put(detailsRecord);

    transaction.oncomplete = () => resolve(id);
    transaction.onerror = () => reject(transaction.error);
  });
};

export const reSaveExamResult = async (fileName: string, rawPages: DebugPageData[], questions?: QuestionImage[]): Promise<void> => {
  return saveExamResult(fileName, rawPages, questions || []).then(() => {});
};

/**
 * Fetch a specific chunk (Image Data)
 */
export const getChunkData = async (key: string): Promise<string | undefined> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_CHUNKS], "readonly");
        const request = transaction.objectStore(STORE_CHUNKS).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(undefined); // Fail gracefully
    });
};

/**
 * Convenience: Get Question Image
 */
export const getQuestionImage = async (examId: string, fileName: string, questionId: string): Promise<string | undefined> => {
    return getChunkData(getChunkKey(examId, 'q', fileName, questionId));
};

export const getQuestionOriginalImage = async (examId: string, fileName: string, questionId: string): Promise<string | undefined> => {
    return getChunkData(getChunkKey(examId, 'q', fileName, `${questionId}_orig`));
};

/**
 * Convenience: Get Page Image
 */
export const getPageImage = async (examId: string, fileName: string, pageNumber: number): Promise<string | undefined> => {
    return getChunkData(getChunkKey(examId, 'p', fileName, pageNumber));
};

/**
 * Load exam result. 
 * NOTE: Returns "Skeleton" objects (dataUrl is undefined). Components must lazy load.
 * Supports legacy records by returning them as-is if chunks aren't found (backward compatibility).
 */
export const loadExamResult = async (id: string): Promise<{ rawPages: DebugPageData[], questions?: QuestionImage[], name: string } | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS], "readonly");
    
    const metaReq = transaction.objectStore(STORE_INDEX).get(id);
    const detailsReq = transaction.objectStore(STORE_DETAILS).get(id);

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

// ... Rest of the legacy update functions (updatePageDetectionsAndQuestions, etc) need to be aware of chunks ...
// For simplicity in this refactor, we assume "update" functions fetch the full record, modify it, and re-save using the new saveExamResult logic which handles chunking automatically.

export const updatePageDetectionsAndQuestions = async (
    fileName: string, 
    pageNumber: number, 
    newDetections: DetectedQuestion[], 
    newFileQuestions: QuestionImage[]
): Promise<void> => {
  const list = await getHistoryList();
  const targetItem = list.find(h => h.name === fileName);
  if (!targetItem) return;

  // We need to fetch the current raw page to get its image data if it's chunked, 
  // because we need to re-save it. 
  // Actually, for just updating detections, we don't need the image data if we are just updating the metadata array.
  // BUT, saveExamResult expects full data or it might overwrite chunks with undefined.
  
  // STRATEGY: Read Skeleton -> Update Metadata -> Save (Save logic handles undefined dataUrl by NOT overwriting existing chunk if undefined? No, put(undefined) is bad)
  
  // Revised Strategy for Updates: 
  // We manually update the details object and leave chunks alone unless we have new image data.
  
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
    const detailsStore = transaction.objectStore(STORE_DETAILS);
    const indexStore = transaction.objectStore(STORE_INDEX);

    const getReq = detailsStore.get(targetItem.id);
    getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record || !record.rawPages) { resolve(); return; }

        // 1. Update Detections (Metadata only)
        const pageIndex = record.rawPages.findIndex((p: DebugPageData) => p.pageNumber === pageNumber);
        if (pageIndex !== -1) {
            record.rawPages[pageIndex].detections = newDetections;
        }

        // 2. Update Questions
        // This is tricky. newFileQuestions likely contains dataUrls if they were just generated.
        // If they are skeleton, we just save skeleton.
        // We should allow the caller to pass full questions, and we strip them here manually before saving to details.
        // But we also need to save the chunks!
        
        // So we really should reuse the `saveExamResult` logic but scoped to updating specific fields.
        // Since `saveExamResult` is heavy, let's do a partial chunk update here.
        
        // A. Handle Questions Chunking manually here
        const chunksStore = transaction.objectStore(STORE_CHUNKS);
        const skeletonQuestions = newFileQuestions.map(q => {
            if (q.dataUrl) {
                const key = getChunkKey(targetItem.id, 'q', q.fileName, q.id);
                chunksStore.put(q.dataUrl, key);
            }
             if (q.originalDataUrl) {
                const keyOrig = getChunkKey(targetItem.id, 'q', q.fileName, `${q.id}_orig`);
                chunksStore.put(q.originalDataUrl, keyOrig);
            }
            return { ...q, dataUrl: undefined, originalDataUrl: undefined };
        });
        
        record.questions = skeletonQuestions;
        detailsStore.put(record);

        // 3. Update Timestamp
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
  });
};

export const updatePageDetections = async (fileName: string, pageNumber: number, newDetections: DetectedQuestion[]) => {
    // Legacy wrapper - just updates detections, no question changes
     const list = await getHistoryList();
     const targetItem = list.find(h => h.name === fileName);
     if (!targetItem) return;

     const db = await openDB();
     return new Promise<void>((resolve, reject) => {
         const tx = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
         const store = tx.objectStore(STORE_DETAILS);
         store.get(targetItem.id).onsuccess = (e: any) => {
             const record = e.target.result;
             if (record) {
                 const idx = record.rawPages.findIndex((p:any) => p.pageNumber === pageNumber);
                 if (idx !== -1) {
                     record.rawPages[idx].detections = newDetections;
                     store.put(record);
                     
                     // Update timestamp
                     const metaStore = tx.objectStore(STORE_INDEX);
                     metaStore.get(targetItem.id).onsuccess = (ev: any) => {
                         const meta = ev.target.result;
                         if (meta) {
                             meta.timestamp = Date.now();
                             metaStore.put(meta);
                         }
                     };
                 }
             }
         };
         tx.oncomplete = () => resolve();
         tx.onerror = () => reject(tx.error);
     });
};

export const updateExamQuestionsOnly = async (id: string, questions: QuestionImage[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS, STORE_CHUNKS], "readwrite");
    const detailsStore = transaction.objectStore(STORE_DETAILS);
    const indexStore = transaction.objectStore(STORE_INDEX);
    const chunksStore = transaction.objectStore(STORE_CHUNKS);
    
    const getReq = detailsStore.get(id);
    getReq.onsuccess = () => {
        const record = getReq.result;
        if (record) {
            // Strip and Save Chunks
            const skeletonQuestions = questions.map(q => {
                if (q.dataUrl) {
                    const key = getChunkKey(id, 'q', q.fileName, q.id);
                    chunksStore.put(q.dataUrl, key);
                }
                if (q.originalDataUrl) {
                    const key = getChunkKey(id, 'q', q.fileName, `${q.id}_orig`);
                    chunksStore.put(q.originalDataUrl, key);
                }
                return { ...q, dataUrl: undefined, originalDataUrl: undefined };
            });

            record.questions = skeletonQuestions;
            detailsStore.put(record);

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

export const deleteExamResult = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS, STORE_CHUNKS], "readwrite");
    transaction.objectStore(STORE_INDEX).delete(id);
    transaction.objectStore(STORE_DETAILS).delete(id);
    
    // Also delete chunks? Ideally yes. But keys are complex.
    // Iterating to delete might be slow. For now we leave chunks orphaned or we need a range delete.
    // Efficient range delete requires an Index on examId, which we didn't create on STORE_CHUNKS.
    // We can iterate cursor for now (slow but cleaner).
    const chunkStore = transaction.objectStore(STORE_CHUNKS);
    // Optimization: Since keys start with `${id}#`, we can use a key range
    const keyRange = IDBKeyRange.bound(`${id}#`, `${id}#\uffff`);
    chunkStore.delete(keyRange);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const deleteExamResults = async (ids: string[]): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_INDEX, STORE_DETAILS, STORE_CHUNKS], "readwrite");
    const indexStore = transaction.objectStore(STORE_INDEX);
    const detailsStore = transaction.objectStore(STORE_DETAILS);
    const chunksStore = transaction.objectStore(STORE_CHUNKS);

    ids.forEach(id => {
        indexStore.delete(id);
        detailsStore.delete(id);
        const keyRange = IDBKeyRange.bound(`${id}#`, `${id}#\uffff`);
        chunksStore.delete(keyRange);
    });

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
};

export const cleanupHistoryItem = async (id: string): Promise<number> => {
   // Cleanup logic remains similar but acting on skeleton pages
   // Since dedup only checks pageNumber and detection count, skeleton is enough.
  const db = await openDB();
  
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

  await new Promise<void>((resolve, reject) => {
     const tx = db.transaction([STORE_INDEX, STORE_DETAILS], "readwrite");
     details.rawPages = uniquePages;
     tx.objectStore(STORE_DETAILS).put(details);
     const metaReq = tx.objectStore(STORE_INDEX).get(id);
     metaReq.onsuccess = () => {
         const meta = metaReq.result;
         if (meta) {
             meta.pageCount = uniquePages.length;
             meta.timestamp = Date.now();
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
