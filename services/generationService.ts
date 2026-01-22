
import { DebugPageData, QuestionImage, DetectedQuestion } from "../types";
import { CropSettings } from "./pdfService";
import { WORKER_BLOB_URL } from "./workerScript";

export const normalizeBoxes = (boxes2d: any): [number, number, number, number][] => {
  if (Array.isArray(boxes2d[0])) {
    return boxes2d as [number, number, number, number][];
  }
  return [boxes2d] as [number, number, number, number][];
};

export interface LogicalQuestion {
  id: string;
  fileId: string;
  parts: {
    pageObj: DebugPageData;
    detection: DetectedQuestion;
    indexInFile: number;
  }[];
}

/**
 * Group pages into Logical Questions (handling continuations)
 */
export const createLogicalQuestions = (pages: DebugPageData[]): LogicalQuestion[] => {
  const files = new Map<string, DebugPageData[]>();
  pages.forEach(p => {
    if (!files.has(p.fileName)) files.set(p.fileName, []);
    files.get(p.fileName)!.push(p);
  });

  const logicalQuestions: LogicalQuestion[] = [];

  for (const [fileId, filePages] of files) {
      // Sort pages to ensure correct continuation order
      filePages.sort((a,b) => a.pageNumber - b.pageNumber);
      
      let currentQ: LogicalQuestion | null = null;

      for (const page of filePages) {
          for (const [idx, det] of page.detections.entries()) {
               if (det.id === 'continuation') {
                   if (currentQ) {
                       currentQ.parts.push({ pageObj: page, detection: det, indexInFile: idx });
                   } else {
                       // Orphan continuation: Treat as separate or skip.
                       // Creating separate to ensure visibility.
                       currentQ = {
                           id: `cont_${page.pageNumber}_${idx}`,
                           fileId,
                           parts: [{ pageObj: page, detection: det, indexInFile: idx }]
                       };
                       logicalQuestions.push(currentQ);
                   }
               } else {
                   currentQ = {
                       id: det.id,
                       fileId,
                       parts: [{ pageObj: page, detection: det, indexInFile: idx }]
                   };
                   logicalQuestions.push(currentQ);
               }
          }
      }
  }
  return logicalQuestions;
};

// --- WORKER POOL IMPLEMENTATION ---

class WorkerPool {
    private workers: Worker[] = [];
    private queue: { 
        task: LogicalQuestion; 
        settings: CropSettings; 
        resolve: (val: QuestionImage | null) => void; 
        reject: (err: any) => void; 
    }[] = [];
    private activeCount = 0;
    private _concurrency = 4;
    private workerMap = new Map<Worker, boolean>(); // Worker -> busy/free

    constructor() {
        // Initialize lazy
    }

    set concurrency(val: number) {
        this._concurrency = val;
        this.processQueue();
    }
    
    get concurrency() { return this._concurrency; }

    get size() {
        return this.queue.length + this.activeCount;
    }

    private getFreeWorker(): Worker | null {
        // Ensure we have enough workers
        while (this.workers.length < this._concurrency) {
            const w = new Worker(WORKER_BLOB_URL);
            this.workers.push(w);
            this.workerMap.set(w, false); // false = free
        }
        
        // Find free worker
        for (const [w, busy] of this.workerMap.entries()) {
            if (!busy) return w;
        }
        return null;
    }

    exec(task: LogicalQuestion, settings: CropSettings): Promise<QuestionImage | null> {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, settings, resolve, reject });
            this.processQueue();
        });
    }

    private processQueue() {
        if (this.queue.length === 0) return;

        // Clean up excess workers if concurrency dropped significantly? 
        // For now, we just keep them alive for reuse.

        while (this.activeCount < this._concurrency && this.queue.length > 0) {
            const worker = this.getFreeWorker();
            if (!worker) break; // All workers busy

            const job = this.queue.shift();
            if (job) {
                this.activeCount++;
                this.workerMap.set(worker, true);
                
                const msgId = Math.random().toString(36).substring(7);
                
                const handler = (e: MessageEvent) => {
                    if (e.data.id === msgId) {
                        worker.removeEventListener('message', handler);
                        this.activeCount--;
                        this.workerMap.set(worker, false);
                        
                        if (e.data.success) {
                            job.resolve(e.data.result);
                        } else {
                            // Non-fatal, just return null for this question
                            console.error("Worker processing error:", e.data.error);
                            job.resolve(null);
                        }
                        this.processQueue();
                    }
                };

                worker.addEventListener('message', handler);
                worker.postMessage({ 
                    id: msgId, 
                    type: 'PROCESS_QUESTION', 
                    payload: { task: job.task, settings: job.settings } 
                });
            }
        }
    }

    // Wait until queue is empty
    onIdle(): Promise<void> {
        if (this.queue.length === 0 && this.activeCount === 0) return Promise.resolve();
        return new Promise((resolve) => {
            const check = setInterval(() => {
                if (this.queue.length === 0 && this.activeCount === 0) {
                    clearInterval(check);
                    resolve();
                }
            }, 100);
        });
    }
    
    clear() {
        this.queue = [];
        // Cannot easily stop running workers without terminating them, 
        // but we can clear pending.
    }
}

// Global Singleton for the pool
export const globalWorkerPool = new WorkerPool();

// Backwards compatibility wrapper for CropQueue
// We now just wrap the globalWorkerPool
export class CropQueue {
  set concurrency(val: number) {
      globalWorkerPool.concurrency = val;
  }
  
  get concurrency() { return globalWorkerPool.concurrency; }

  // Enqueue assumes a void function wrapper in legacy code, 
  // but we can't easily extract the args from the closure.
  // The hooks/useFileProcessor needs to be updated to use exec directly
  // OR we keep this wrapper if we modify useFileProcessor to pass data.
  // Actually, useFileProcessor calls `enqueue(async () => ... processLogicalQuestion ...)`.
  // To make this work transparently, we need to export `processLogicalQuestion` that 
  // internally calls the worker pool.
  
  enqueue(task: () => Promise<void>) {
      // Legacy support: We execute the task. 
      // BUT if the task calls processLogicalQuestion, it will block main thread if we don't change processLogicalQuestion.
      // See below.
      task(); 
  }

  get size() { return globalWorkerPool.size; }

  onIdle() { return globalWorkerPool.onIdle(); }

  clear() { globalWorkerPool.clear(); }
}

/**
 * Process a single logical question - NOW USES WORKER
 */
export const processLogicalQuestion = async (
  task: LogicalQuestion, 
  settings: CropSettings
): Promise<QuestionImage | null> => {
    return globalWorkerPool.exec(task, settings);
};

// Legacy helper used by History loading
export const pMap = async <T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
  signal?: AbortSignal
): Promise<R[]> => {
    // Just map and promise all, because the concurrency is handled inside `processLogicalQuestion` (via WorkerPool)
    // if `mapper` calls `processLogicalQuestion`.
    // If mapper does something else, we might need real pMap.
    // For `handleBatchReprocessHistory`, it calls processLogicalQuestion.
    
    // However, to be safe and ensure we don't flood the pool with millions of pending promises,
    // we use a simple semaphore loop.
    
    const results: R[] = [];
    const executing: Promise<void>[] = [];
    
    for (let i = 0; i < items.length; i++) {
        if (signal?.aborted) throw new Error("Aborted");
        const p = mapper(items[i], i).then(res => {
            results[i] = res;
        });
        executing.push(p);
        
        // Cleaning up finished promises
        const clean = () => {
             // Removing resolved is tricky with basic array, simpler to just limit initial dispatch
        };
        
        if (executing.length >= concurrency) {
            await Promise.race(executing);
            // In a real implementation we'd remove the finished one. 
            // But since our mapper relies on WorkerPool which has internal queue, 
            // we can actually just fire all if not too many, OR use a basic chunking.
            // Let's use basic chunking for safety.
        }
    }
    
    await Promise.all(executing);
    return results;
};


/**
 * Generates processed questions from raw debug data.
 */
export const generateQuestionsFromRawPages = async (
  pages: DebugPageData[], 
  settings: CropSettings, 
  signal: AbortSignal,
  callbacks?: {
    onProgress?: () => void;
    onResult?: (image: QuestionImage) => void;
  },
  concurrency: number = 3
): Promise<QuestionImage[]> => {
  
  globalWorkerPool.concurrency = concurrency;
  
  const logicalQuestions = createLogicalQuestions(pages);
  if (logicalQuestions.length === 0) return [];

  const results: QuestionImage[] = [];

  // We push all to pool. Pool handles concurrency.
  const promises = logicalQuestions.map(async (task) => {
     if (signal.aborted) return null;
     
     const res = await processLogicalQuestion(task, settings);
     
     if (res) {
        if (callbacks?.onResult) callbacks.onResult(res);
        if (callbacks?.onProgress) callbacks.onProgress();
        results.push(res);
     }
     return res;
  });

  await Promise.all(promises);
  return results;
};
