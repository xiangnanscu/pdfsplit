
import React, { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';
import { ProcessingStatus, QuestionImage, DetectedQuestion, DebugPageData } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { renderPageToImage, cropAndStitchImage, CropSettings, mergePdfPagesToSingleImage, mergeBase64Images } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';

const CONCURRENCY_LIMIT = 5; 

// Default settings since we removed the UI controls
const DEFAULT_CROP_SETTINGS: CropSettings = {
  cropPadding: 25,
  canvasPaddingLeft: 10,
  canvasPaddingRight: 10,
  canvasPaddingY: 10,
  mergeOverlap: 20
};

interface SourcePage {
  dataUrl: string;
  width: number;
  height: number;
  pageNumber: number;
}

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [sourcePages, setSourcePages] = useState<SourcePage[]>([]); // Store original pages for re-processing
  const [uploadedFileName, setUploadedFileName] = useState<string>('exam_paper');
  const [showDebug, setShowDebug] = useState(false);
  
  // 核心进度状态
  const [progress, setProgress] = useState(0); 
  const [total, setTotal] = useState(0);
  const [completedCount, setCompletedCount] = useState(0); 

  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  
  // 裁剪阶段专属计数
  const [croppingTotal, setCroppingTotal] = useState(0);
  const [croppingDone, setCroppingDone] = useState(0);

  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');
  
  const abortControllerRef = useRef<AbortController | null>(null);

  // 初始化检查 URL query param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zipUrl = params.get('zip');

    if (zipUrl) {
      const loadRemoteZip = async () => {
        try {
          setStatus(ProcessingStatus.LOADING_PDF);
          setDetailedStatus(`正在下载远程数据: ${zipUrl}`);
          
          const response = await fetch(zipUrl);
          if (!response.ok) {
            throw new Error(`无法下载文件 (Status: ${response.status})`);
          }
          
          const blob = await response.blob();
          const fileName = zipUrl.split('/').pop() || 'remote_debug.zip';
          
          await processZipData(blob, fileName);
          setShowDebug(true); // 自动切换到调试视图
        } catch (err: any) {
          console.error("Remote ZIP load failed:", err);
          setError(err.message || "远程 ZIP 下载失败");
          setStatus(ProcessingStatus.ERROR);
        }
      };
      
      loadRemoteZip();
    }
  }, []);

  const handleReset = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setStatus(ProcessingStatus.IDLE);
    setQuestions([]);
    setRawPages([]);
    setSourcePages([]);
    setUploadedFileName('exam_paper');
    setProgress(0);
    setTotal(0);
    setCompletedCount(0);
    setCroppingTotal(0);
    setCroppingDone(0);
    setError(undefined);
    setDetailedStatus('');
    setShowDebug(false);
    
    // Clear URL params on reset if present
    if (window.location.search) {
      window.history.pushState({}, '', window.location.pathname);
    }
  };

  const normalizeBoxes = (boxes2d: any): [number, number, number, number][] => {
    // Check if the first element is an array (nested) or a number (flat)
    if (Array.isArray(boxes2d[0])) {
      return boxes2d as [number, number, number, number][];
    }
    return [boxes2d] as [number, number, number, number][];
  };

  // Extract core AI logic to be reusable for "Re-identify"
  const runAIDetectionAndCropping = async (pages: SourcePage[], signal: AbortSignal) => {
    try {
      setStatus(ProcessingStatus.DETECTING_QUESTIONS);
      setProgress(0);
      setCompletedCount(0);
      setDetailedStatus(`AI 正在智能分析试卷 (${selectedModel === 'gemini-3-flash-preview' ? 'Flash' : 'Pro'})...`);

      const numPages = pages.length;
      const results: DebugPageData[] = new Array(numPages);
      
      for (let i = 0; i < pages.length; i += CONCURRENCY_LIMIT) {
        if (signal.aborted) return;
        const batch = pages.slice(i, i + CONCURRENCY_LIMIT);
        setProgress(Math.min(numPages, i + batch.length));

        const batchResults = await Promise.all(batch.map(async (pageData) => {
          try {
            const detections = await detectQuestionsOnPage(pageData.dataUrl, selectedModel);
            setCompletedCount(prev => prev + 1);
            return {
              pageNumber: pageData.pageNumber,
              dataUrl: pageData.dataUrl,
              width: pageData.width,
              height: pageData.height,
              detections
            };
          } catch (err: any) {
            if (signal.aborted) throw err;
            setCompletedCount(prev => prev + 1);
            console.error(`Error on page ${pageData.pageNumber}:`, err);
            return {
              pageNumber: pageData.pageNumber,
              dataUrl: pageData.dataUrl,
              width: pageData.width,
              height: pageData.height,
              detections: []
            };
          }
        }));

        batchResults.forEach((res, idx) => {
          results[i + idx] = res;
        });
      }

      setRawPages(results);
      if (signal.aborted) return;

      setStatus(ProcessingStatus.CROPPING);
      const totalDetections = results.reduce((acc, p) => acc + p.detections.length, 0);
      setCroppingTotal(totalDetections);
      setCroppingDone(0);
      setProgress(0); 
      setCompletedCount(0);
      setDetailedStatus('正在根据 AI 坐标切割题目图片...');

      let allExtractedQuestions: QuestionImage[] = [];

      for (let i = 0; i < results.length; i++) {
        if (signal.aborted) return;
        const page = results[i];
        setProgress(i + 1);

        for (const detection of page.detections) {
          if (signal.aborted) return;
          
          const boxes = normalizeBoxes(detection.boxes_2d);

          const { final, original } = await cropAndStitchImage(
            page.dataUrl, 
            boxes, 
            page.width, 
            page.height,
            DEFAULT_CROP_SETTINGS
          );
          
          if (final) {
            if (detection.id === 'continuation' && allExtractedQuestions.length > 0) {
              const lastQ = allExtractedQuestions[allExtractedQuestions.length - 1];
              const stitchedImg = await mergeBase64Images(lastQ.dataUrl, final, -DEFAULT_CROP_SETTINGS.mergeOverlap);
              lastQ.dataUrl = stitchedImg;
            } else {
              allExtractedQuestions.push({
                id: detection.id,
                pageNumber: page.pageNumber,
                dataUrl: final,
                originalDataUrl: original
              });
            }
          }
          setCroppingDone(prev => prev + 1);
        }
        setCompletedCount(i + 1);
        await new Promise(r => setTimeout(r, 0));
      }

      setQuestions(allExtractedQuestions);
      setStatus(ProcessingStatus.COMPLETED);
      setDetailedStatus('');

    } catch (err: any) {
       if (err.name === 'AbortError') return;
       console.error(err);
       setError(err.message || "处理失败。");
       setStatus(ProcessingStatus.ERROR);
    }
  };

  const processZipData = async (blob: Blob, fileName: string) => {
    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setDetailedStatus('正在解析 ZIP 文件...');
      
      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(blob);
      
      // Look for analysis_data.json
      let analysisJsonFile: JSZip.JSZipObject | null = null;
      loadedZip.forEach((relativePath, zipEntry) => {
        if (relativePath.endsWith('analysis_data.json')) {
          analysisJsonFile = zipEntry;
        }
      });

      if (!analysisJsonFile) {
        throw new Error('ZIP 中未找到 analysis_data.json，无法恢复数据。');
      }

      const jsonText = await (analysisJsonFile as JSZip.JSZipObject).async('text');
      const loadedRawPages = JSON.parse(jsonText) as DebugPageData[];
      
      setDetailedStatus('正在加载图片资源...');
      
      // Try to reconstruct images from full_pages/ if they are not in the JSON or as a backup
      for (const page of loadedRawPages) {
        const imgPath = `full_pages/Page_${page.pageNumber}.jpg`;
        const imgFile = loadedZip.file(new RegExp(`full_pages/Page_${page.pageNumber}\\.jpg$`, 'i'))[0];
        if (imgFile) {
          const base64 = await imgFile.async('base64');
          page.dataUrl = `data:image/jpeg;base64,${base64}`;
        }
      }

      setRawPages(loadedRawPages);
      // Populate sourcePages from the loaded raw data for potential re-identification
      setSourcePages(loadedRawPages.map(({detections, ...rest}) => rest));
      
      setTotal(loadedRawPages.length);
      setUploadedFileName(fileName.replace(/\.[^/.]+$/, ""));

      // Try to reconstruct individual questions from the ZIP
      const reconstructedQuestions: QuestionImage[] = [];
      const questionFiles: { name: string, entry: JSZip.JSZipObject }[] = [];
      
      loadedZip.forEach((relativePath, zipEntry) => {
        // Exclude directories and metadata files
        if (!zipEntry.dir && 
            !relativePath.includes('full_pages/') && 
            !relativePath.endsWith('.json') &&
            relativePath.match(/\.(jpg|jpeg|png)$/i)) {
          questionFiles.push({ name: relativePath.split('/').pop() || '', entry: zipEntry });
        }
      });

      setDetailedStatus(`已发现 ${questionFiles.length} 个题目图片，正在处理...`);
      
      for (const qf of questionFiles) {
        // Try to guess ID and page from filename. Standard export: {FileName}_{ID}.jpg
        const baseName = qf.name.replace(/\.[^/.]+$/, "");
        const parts = baseName.split('_');
        const id = parts.pop() || 'unknown'; 
        
        // Match against rawPages to find page number
        let pageNumber = 1;
        const pageMatch = loadedRawPages.find(p => p.detections.some(d => d.id === id));
        if (pageMatch) pageNumber = pageMatch.pageNumber;

        const base64 = await qf.entry.async('base64');
        reconstructedQuestions.push({
          id,
          pageNumber,
          dataUrl: `data:image/jpeg;base64,${base64}`
        });
      }

      // Sort by page and ID if possible
      reconstructedQuestions.sort((a, b) => {
        if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
        return a.id.localeCompare(b.id, undefined, { numeric: true });
      });

      setQuestions(reconstructedQuestions);
      setStatus(ProcessingStatus.COMPLETED);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "ZIP 加载失败。");
      setStatus(ProcessingStatus.ERROR);
      throw err; // Re-throw for caller handling if needed
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.endsWith('.zip')) {
      processZipData(file, file.name);
      return;
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setError(undefined);
      setDetailedStatus('正在初始化 PDF 引擎...');
      setQuestions([]);
      setRawPages([]);
      setSourcePages([]);
      setProgress(0);
      setCompletedCount(0);
      setCroppingTotal(0);
      setCroppingDone(0);
      
      const name = file.name.replace(/\.[^/.]+$/, "");
      setUploadedFileName(name);

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;
      setTotal(numPages);

      if (signal.aborted) return;

      setDetailedStatus('正在渲染 PDF 页面...');
      const renderedPages: SourcePage[] = [];
      for (let i = 1; i <= numPages; i++) {
        if (signal.aborted) return;
        const page = await pdf.getPage(i);
        const rendered = await renderPageToImage(page, 3);
        renderedPages.push({ ...rendered, pageNumber: i });
        setProgress(i);
        setCompletedCount(i);
      }

      setSourcePages(renderedPages);
      
      // Trigger the AI processing chain
      await runAIDetectionAndCropping(renderedPages, signal);

    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error(err);
      setError(err.message || "处理失败。");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const handleReidentify = async () => {
    if (sourcePages.length === 0) return;

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    
    // Clear previous results but keep sourcePages
    setQuestions([]);
    setRawPages([]);
    
    await runAIDetectionAndCropping(sourcePages, signal);
  };

  const isWideLayout = showDebug || questions.length > 0 || sourcePages.length > 0;
  const canReidentify = sourcePages.length > 0 && status !== ProcessingStatus.LOADING_PDF && status !== ProcessingStatus.DETECTING_QUESTIONS && status !== ProcessingStatus.CROPPING;

  return (
    <div className="min-h-screen pb-48 px-4 md:px-8 bg-slate-50 relative">
      <header className="max-w-6xl mx-auto py-10 text-center relative">
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
          试卷 <span className="text-blue-600">智能</span> 切割
        </h1>

        {canReidentify && (
          <div className="flex flex-col md:flex-row justify-center items-center gap-4 mt-8 animate-fade-in flex-wrap">
             {/* View Toggle */}
            <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm inline-flex">
              <button
                onClick={() => setShowDebug(false)}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                  !showDebug ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                切割结果
              </button>
              <button
                onClick={() => setShowDebug(true)}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                  showDebug ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                调试视图
              </button>
            </div>

             {/* Action Bar */}
             <div className="flex items-center gap-2 p-1 bg-white rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center px-2 border-r border-slate-100">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-2">Model</span>
                  <select 
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="text-xs font-bold text-slate-700 bg-transparent outline-none cursor-pointer py-2 hover:text-blue-600"
                  >
                    <option value="gemini-3-flash-preview">⚡ Flash (Fast)</option>
                    <option value="gemini-3-pro-preview">🧠 Pro (Accurate)</option>
                  </select>
                </div>
                
                <button 
                  onClick={handleReidentify}
                  className="px-4 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-1.5"
                  title="使用当前选中的模型重新识别所有页面"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  重新识别
                </button>
             </div>

            <button
              onClick={handleReset}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-all shadow-sm flex items-center gap-2 group"
            >
               <svg className="w-4 h-4 text-slate-400 group-hover:text-red-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
               </svg>
               {status === ProcessingStatus.COMPLETED ? '重新开始' : '取消并重置'}
            </button>
          </div>
        )}
      </header>

      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-7xl'}`}>
        {/* Only show upload box if we don't have active content OR if we are in an error state with no content */}
        {!canReidentify && (status === ProcessingStatus.IDLE || (status === ProcessingStatus.ERROR && sourcePages.length === 0)) ? (
          <div className="relative group max-w-2xl mx-auto flex flex-col items-center">
            <div className="w-full mb-8 relative bg-white border-2 border-dashed border-slate-200 rounded-3xl p-16 text-center hover:border-blue-400 transition-colors z-10 shadow-lg shadow-slate-200/50">
              <input 
                type="file" 
                accept="application/pdf,application/zip"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="mb-6">
                <div className="w-24 h-24 bg-blue-50 rounded-3xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-500 shadow-inner">
                  <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-slate-800 mb-2">上传试卷 PDF 或 数据 ZIP</h2>
                <p className="text-slate-400 font-medium">支持 PDF 解析或 ZIP 回放调试</p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-4 mb-4 z-20 w-full">
              <div className="flex items-center bg-white p-2 rounded-2xl border border-slate-200 shadow-md">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-4 mr-4">AI 模型</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedModel('gemini-3-flash-preview')}
                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      selectedModel === 'gemini-3-flash-preview' ? 'bg-amber-100 text-amber-700 shadow-inner' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >⚡ Flash (极速)</button>
                  <button
                    onClick={() => setSelectedModel('gemini-3-pro-preview')}
                    className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all ${
                      selectedModel === 'gemini-3-pro-preview' ? 'bg-indigo-100 text-indigo-700 shadow-inner' : 'text-slate-500 hover:bg-slate-50'
                    }`}
                  >🧠 Pro (高精)</button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <ProcessingState 
          status={status} 
          progress={progress} 
          total={total} 
          completedCount={completedCount}
          error={error} 
          detailedStatus={detailedStatus}
          croppingTotal={croppingTotal}
          croppingDone={croppingDone}
        />

        {showDebug ? (
          <DebugRawView pages={rawPages} />
        ) : (
          questions.length > 0 && (
            <div className="relative">
              <QuestionGrid questions={questions} sourceFileName={uploadedFileName} rawPages={rawPages} />
            </div>
          )
        )}
      </main>
      
      <footer className="mt-20 text-center text-slate-400 text-sm py-10 border-t border-slate-100">
        <p>© 2024 AI 试卷助手</p>
      </footer>
    </div>
  );
};

export default App;
