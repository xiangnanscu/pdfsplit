
import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { ProcessingStatus, QuestionImage, DetectedQuestion, DebugPageData } from './types';
import { ProcessingState } from './components/ProcessingState';
import { QuestionGrid } from './components/QuestionGrid';
import { DebugRawView } from './components/DebugRawView';
import { renderPageToImage, cropAndStitchImage } from './services/pdfService';
import { detectQuestionsOnPage } from './services/geminiService';

const App: React.FC = () => {
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [questions, setQuestions] = useState<QuestionImage[]>([]);
  
  // Debug & Meta State
  const [rawPages, setRawPages] = useState<DebugPageData[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string>('exam_paper');
  const [showDebug, setShowDebug] = useState(false);

  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | undefined>();
  const [detailedStatus, setDetailedStatus] = useState<string>('');
  const [enableDetailedAnalysis, setEnableDetailedAnalysis] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3-flash-preview');

  const handleReset = () => {
    setStatus(ProcessingStatus.IDLE);
    setQuestions([]);
    setRawPages([]);
    setUploadedFileName('exam_paper');
    setProgress(0);
    setTotal(0);
    setError(undefined);
    setDetailedStatus('');
    setShowDebug(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatus(ProcessingStatus.LOADING_PDF);
      setError(undefined);
      setDetailedStatus('');
      setQuestions([]);
      setRawPages([]);
      setProgress(0);
      
      // Store filename without extension
      const name = file.name.replace(/\.[^/.]+$/, "");
      setUploadedFileName(name);

      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      setTotal(pdf.numPages);

      const allExtractedQuestions: QuestionImage[] = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        setProgress(i);
        setDetailedStatus(`Rendering page ${i}...`);
        
        const page = await pdf.getPage(i);
        const { dataUrl, width, height } = await renderPageToImage(page, 3); // High scale for multi-column

        setStatus(ProcessingStatus.DETECTING_QUESTIONS);
        setDetailedStatus(`AI identifying questions on page ${i}...`);
        
        const detections: DetectedQuestion[] = await detectQuestionsOnPage(dataUrl, enableDetailedAnalysis, selectedModel);

        // Store Debug Data
        setRawPages(prev => [...prev, {
          pageNumber: i,
          dataUrl,
          width,
          height,
          detections
        }]);

        setStatus(ProcessingStatus.CROPPING);
        for (let j = 0; j < detections.length; j++) {
          const detection = detections[j];
          setDetailedStatus(`Page ${i}: Cutting & Cleaning Question ${detection.id} (${j+1}/${detections.length})...`);
          
          // Use cropAndStitchImage to handle multiple boxes per question
          const { final, original } = await cropAndStitchImage(
            dataUrl, 
            detection.boxes_2d, 
            width, 
            height,
            (msg) => setDetailedStatus(`Q${detection.id}: ${msg}`) // Update status from inside the cropping logic
          );
          
          if (final) {
            allExtractedQuestions.push({
              id: detection.id,
              pageNumber: i,
              dataUrl: final,
              originalDataUrl: original,
              markdown: detection.markdown,
              tags: detection.tags,
              type: detection.type,
              difficulty: detection.difficulty,
              analysis: detection.analysis,
              graphic_boxes_2d: detection.graphic_boxes_2d
            });
          }
        }
        
        if (i < pdf.numPages) {
          setStatus(ProcessingStatus.LOADING_PDF);
        }
      }

      setQuestions(allExtractedQuestions);
      setStatus(ProcessingStatus.COMPLETED);
      setDetailedStatus('');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to process PDF. Make sure the file is not password protected.");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  // Determine if we should use the wide layout
  const isWideLayout = showDebug || questions.length > 0;

  return (
    <div className="min-h-screen pb-20 px-4 md:px-8 bg-slate-50">
      <header className="max-w-6xl mx-auto py-10 text-center relative">
        <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-6">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          Smart Layout Reconstruction
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
          Exam <span className="text-blue-600">Question</span> Splitter
        </h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Supports 2/3-column layouts. Our AI identifies cross-column fragments and stitches them 
          back into a single high-quality image.
        </p>

        {/* Action Bar: View Toggle & Re-upload */}
        {(questions.length > 0 || rawPages.length > 0) && (
          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mt-8 animate-fade-in">
            <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm inline-flex">
              <button
                onClick={() => setShowDebug(false)}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                  !showDebug ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                Final Results
              </button>
              <button
                onClick={() => setShowDebug(true)}
                className={`px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${
                  showDebug ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
                Debug / Raw View
              </button>
            </div>

            <button
              onClick={handleReset}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm flex items-center gap-2 group"
            >
               <svg className="w-4 h-4 text-slate-400 group-hover:text-blue-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
               </svg>
               Upload New File
            </button>
          </div>
        )}
      </header>

      {/* Main container switches width based on view mode */}
      <main className={`mx-auto transition-all duration-300 ${isWideLayout ? 'w-full max-w-[98vw]' : 'max-w-7xl'}`}>
        {status === ProcessingStatus.IDLE || status === ProcessingStatus.COMPLETED || status === ProcessingStatus.ERROR ? (
          (!isWideLayout && questions.length === 0) && (
            <div className="relative group max-w-2xl mx-auto flex flex-col items-center">
              
              <div className="w-full mb-8 relative bg-white border-2 border-dashed border-slate-200 rounded-3xl p-12 text-center hover:border-blue-400 transition-colors z-10">
                <input 
                  type="file" 
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="mb-6">
                  <div className="w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                    <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold text-slate-800 mb-1">Upload Exam PDF</h2>
                  <p className="text-slate-500">Auto-detects multi-column content</p>
                </div>
              </div>

              <div className="flex flex-col items-center gap-4 mb-4 z-20 w-full">
                {/* Model Selection */}
                <div className="flex items-center bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider ml-3 mr-3">Model</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSelectedModel('gemini-3-flash-preview')}
                      className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                        selectedModel === 'gemini-3-flash-preview' 
                          ? 'bg-amber-100 text-amber-700 shadow-sm' 
                          : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <span>⚡ Flash</span>
                    </button>
                    <button
                      onClick={() => setSelectedModel('gemini-3-pro-preview')}
                      className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${
                        selectedModel === 'gemini-3-pro-preview' 
                          ? 'bg-indigo-100 text-indigo-700 shadow-sm' 
                          : 'text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                     <span>🧠 Pro</span>
                    </button>
                  </div>
                </div>

                {/* Analysis Toggle Switch */}
                <div className="flex items-center gap-3 bg-white px-5 py-3 rounded-full shadow-sm border border-slate-200">
                  <div className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      id="detailed-toggle" 
                      className="sr-only peer" 
                      checked={enableDetailedAnalysis}
                      onChange={(e) => setEnableDetailedAnalysis(e.target.checked)}
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </div>
                  <label htmlFor="detailed-toggle" className="text-sm font-medium text-slate-700 cursor-pointer select-none">
                    Enable AI Text & Analysis Extraction <span className="text-xs text-orange-500 font-normal ml-1">(Slower)</span>
                  </label>
                </div>
              </div>
            </div>
          )
        ) : null}

        <ProcessingState 
          status={status} 
          progress={progress} 
          total={total} 
          error={error} 
          detailedStatus={detailedStatus}
        />

        {showDebug ? (
          <DebugRawView pages={rawPages} />
        ) : (
          questions.length > 0 && (
            <QuestionGrid questions={questions} sourceFileName={uploadedFileName} />
          )
        )}
      </main>

      <footer className="mt-20 text-center text-slate-400 text-sm">
        <p>© 2024 AI Exam Splitter • Smart Multi-Column Stitching</p>
      </footer>
    </div>
  );
};

export default App;
