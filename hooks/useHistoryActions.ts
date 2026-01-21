
import { ProcessingStatus, DebugPageData, QuestionImage } from '../types';
import { loadExamResult, getHistoryList, saveExamResult, updateExamQuestionsOnly, cleanupAllHistory } from '../services/storageService';
import { generateQuestionsFromRawPages } from '../services/generationService';

interface HistoryProps {
  state: any;
  setters: any;
  refs: any;
  actions: any;
}

export const useHistoryActions = ({ state, setters, refs, actions }: HistoryProps) => {
  const { batchSize, cropSettings, legacySyncFiles, questions, rawPages } = state;
  const {
    setStatus, setDetailedStatus, setError, setQuestions, setRawPages, setSourcePages,
    setTotal, setCompletedCount, setCroppingTotal, setCroppingDone, setLegacySyncFiles, setIsSyncingLegacy,
    setCurrentExamId
  } = setters;
  const { abortControllerRef } = refs;
  const { resetState, addNotification } = actions;

  const refreshHistoryList = async () => {
    try {
      const list = await getHistoryList();
      setters.setHistoryList(list);
    } catch (e) {
      console.error("Failed to load history list", e);
    }
  };

  const handleCleanupAllHistory = async () => {
      try {
          const removedCount = await cleanupAllHistory();
          // Callers will need to refresh list manually if needed
          if (removedCount > 0) {
              setDetailedStatus(`Maintenance complete. Cleaned ${removedCount} duplicate pages.`);
              await refreshHistoryList(); // Refresh list to show updated page counts
          } else {
              setDetailedStatus(`Maintenance complete. No duplicate pages found.`);
          }
          setTimeout(() => {
             if (state.status === ProcessingStatus.IDLE) setDetailedStatus('');
          }, 4000);
      } catch (e) {
          console.error(e);
          setError("Failed to cleanup history.");
          setStatus(ProcessingStatus.ERROR);
      }
  };

  const handleLoadHistory = async (id: string) => {
    resetState();
    setters.setShowHistory(false);
    setters.setIsLoadingHistory(true);
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus('Restoring from history...');

    try {
      // Set the exam ID to enable lazy loading in UI components
      setCurrentExamId(id);
      
      const result = await loadExamResult(id);
      if (!result) throw new Error("History record not found.");

      const uniquePages = Array.from(new Map(result.rawPages.map((p: any) => [p.pageNumber, p])).values()) as DebugPageData[];
      uniquePages.sort((a, b) => a.pageNumber - b.pageNumber);

      setRawPages(uniquePages);
      
      const recoveredSourcePages = uniquePages.map(rp => ({
        dataUrl: rp.dataUrl || '', // Might be empty if lazy loading
        width: rp.width,
        height: rp.height,
        pageNumber: rp.pageNumber,
        fileName: rp.fileName
      }));
      setSourcePages(recoveredSourcePages);

      if (result.questions && result.questions.length > 0) {
          setQuestions(result.questions);
          setCompletedCount(uniquePages.length);
          setTotal(uniquePages.length);
          setStatus(ProcessingStatus.COMPLETED);
          setDetailedStatus("Loaded successfully from cache.");
      } else {
          // Fallback if questions weren't saved for some reason (rare in v3+)
          setStatus(ProcessingStatus.CROPPING);
          setDetailedStatus('Generating questions from raw data...');
          
          // Note: generationService needs FULL data. If uniquePages are skeleton, this fails.
          // Since this is a fallback for legacy corrupt data, we might need to fetch full pages.
          // For now, assuming loadExamResult returns full pages if they were v1/v2/v3, and v4 handles lazy.
          // In v4, if questions are missing, we likely have bigger problems or it's a raw save.
          
          const totalDetections = uniquePages.reduce((acc, p) => acc + p.detections.length, 0);
          setCroppingTotal(totalDetections);
          setCroppingDone(0);
          setTotal(uniquePages.length);
          setCompletedCount(uniquePages.length);

          abortControllerRef.current = new AbortController();
          const generatedQuestions = await generateQuestionsFromRawPages(
            uniquePages, 
            cropSettings, 
            abortControllerRef.current.signal,
            () => setCroppingDone((p: number) => p + 1)
          );

          setQuestions(generatedQuestions);
          setStatus(ProcessingStatus.COMPLETED);
          
          setLegacySyncFiles(new Set([result.name]));
      }

    } catch (e: any) {
      setError("Failed to load history: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    } finally {
      setters.setIsLoadingHistory(false);
    }
  };

  const handleBatchLoadHistory = async (ids: string[]) => {
    resetState();
    setters.setShowHistory(false);
    setters.setIsLoadingHistory(true);
    setStatus(ProcessingStatus.LOADING_PDF);
    setDetailedStatus(`Queuing ${ids.length} exams from history...`);

    // Batch loading doesn't support lazy loading optimization efficiently across multiple files yet
    // without complex ID tracking. For now, we behave as before (loading full objects if possible).
    // Note: If data is chunked, `loadExamResult` returns skeletons. Batch view might show empty images
    // if we don't handle multiple currentExamIds.
    // LIMITATION: Lazy loading currently assumes SINGLE active exam ID for simplicity in QuestionGrid.
    // Batch loaded items might not display images if they are chunked.
    
    // Workaround: We force fetch chunks for batch load to keep memory usage high but functionality working?
    // OR we just don't set currentExamId, and let components fail gracefully?
    // Ideally: Update LazyImage to handle missing examId by checking if question has dataUrl.
    // If we batch load, we probably *should* load dataUrls into memory because switching examIds per cell is hard.
    
    // REVISED STRATEGY: For Batch Load, we fetch full data (hydrate) immediately to match old behavior.
    
    try {
      const CHUNK_SIZE = batchSize;
      const combinedPages: DebugPageData[] = [];
      const combinedQuestions: QuestionImage[] = [];
      const legacyFilesFound = new Set<string>();
      
      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
         const chunk = ids.slice(i, i + CHUNK_SIZE);
         setDetailedStatus(`Restoring data batch ${Math.min(i + CHUNK_SIZE, ids.length)}/${ids.length}...`);
         
         // Helper to hydrate
         const hydrateResult = async (id: string) => {
             const res = await loadExamResult(id);
             if (!res) return null;
             
             // Hydrate Pages
             // @ts-ignore
             const getPageImage = (await import('../services/storageService')).getPageImage;
             // @ts-ignore
             const getQuestionImage = (await import('../services/storageService')).getQuestionImage;
             
             const fullPages = await Promise.all(res.rawPages.map(async p => {
                 if (p.dataUrl) return p;
                 const d = await getPageImage(id, p.fileName, p.pageNumber);
                 return { ...p, dataUrl: d || '' };
             }));
             
             // Hydrate Questions
             const fullQuestions = await Promise.all((res.questions || []).map(async q => {
                 if (q.dataUrl) return q;
                 const d = await getQuestionImage(id, q.fileName, q.id);
                 return { ...q, dataUrl: d || '' };
             }));

             return { ...res, rawPages: fullPages, questions: fullQuestions };
         };

         const results = await Promise.all(chunk.map(id => hydrateResult(id)));
         results.forEach(res => {
            if (res && res.rawPages) {
                combinedPages.push(...res.rawPages);
                
                if (res.questions && res.questions.length > 0) {
                    combinedQuestions.push(...res.questions);
                } else {
                    legacyFilesFound.add(res.name);
                }
            }
         });
         
         await new Promise(r => setTimeout(r, 10));
      }

      if (combinedPages.length === 0) {
        throw new Error("No valid data found in selected items.");
      }

      const uniqueMap = new Map<string, DebugPageData>();
      combinedPages.forEach(p => {
          const key = `${p.fileName}#${p.pageNumber}`;
          uniqueMap.set(key, p);
      });

      const uniquePages = Array.from(uniqueMap.values());
      uniquePages.sort((a, b) => {
         if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
         return a.pageNumber - b.pageNumber;
      });

      setRawPages(uniquePages);

      const recoveredSourcePages = uniquePages.map(rp => ({
        dataUrl: rp.dataUrl || '',
        width: rp.width,
        height: rp.height,
        pageNumber: rp.pageNumber,
        fileName: rp.fileName
      }));
      setSourcePages(recoveredSourcePages);

      if (legacyFilesFound.size > 0) {
          setStatus(ProcessingStatus.CROPPING);
          setDetailedStatus(`Generating images for ${legacyFilesFound.size} legacy files...`);

          const legacyPages = uniquePages.filter(p => legacyFilesFound.has(p.fileName));
          const totalDetections = legacyPages.reduce((acc, p) => acc + p.detections.length, 0);
          setCroppingTotal(totalDetections);
          setCroppingDone(0);

          abortControllerRef.current = new AbortController();
          const generatedLegacyQuestions = await generateQuestionsFromRawPages(
            legacyPages, 
            cropSettings, 
            abortControllerRef.current.signal,
            () => setCroppingDone((p: number) => p + 1)
          );
          
          setQuestions([...combinedQuestions, ...generatedLegacyQuestions]);
          setLegacySyncFiles(legacyFilesFound);
      } else {
          setQuestions(combinedQuestions);
      }

      setTotal(uniquePages.length);
      setCompletedCount(uniquePages.length);
      setStatus(ProcessingStatus.COMPLETED);

    } catch (e: any) {
      setError("Batch load failed: " + e.message);
      setStatus(ProcessingStatus.ERROR);
    } finally {
      setters.setIsLoadingHistory(false);
    }
  };

  const handleSyncLegacyData = async () => {
     // Cast legacySyncFiles to Set<string> since it comes from untyped state
     const syncSet = legacySyncFiles as Set<string>;
     if (syncSet.size === 0) return;
     
     setIsSyncingLegacy(true);
     setDetailedStatus("Syncing processed images to database...");
     
     try {
         const history = await getHistoryList();
         const filesToSync = Array.from(syncSet);
         
         await Promise.all(filesToSync.map(async (fileName) => {
             const fileQuestions = questions.filter((q: any) => q.fileName === fileName);
             if (fileQuestions.length === 0) return;

             const historyItem = history.find(h => h.name === fileName);
             if (historyItem) {
                 await updateExamQuestionsOnly(historyItem.id, fileQuestions);
             } else {
                 const filePages = rawPages.filter((p: any) => p.fileName === fileName);
                 await saveExamResult(fileName, filePages, fileQuestions);
             }
         }));

         setLegacySyncFiles(new Set()); 
         setDetailedStatus("Sync complete!");
         addNotification("Sync", "success", "All images saved to database for future instant loading.");
         
         await refreshHistoryList(); // Refresh list after syncing
         
         setTimeout(() => {
             if (state.status === ProcessingStatus.COMPLETED) setDetailedStatus("");
         }, 3000);

     } catch (e: any) {
         console.error(e);
         setError("Failed to sync legacy data: " + e.message);
     } finally {
         setIsSyncingLegacy(false);
     }
  };

  return { handleCleanupAllHistory, handleLoadHistory, handleBatchLoadHistory, handleSyncLegacyData, refreshHistoryList };
};
