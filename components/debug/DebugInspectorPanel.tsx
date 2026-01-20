
import React, { useState, useEffect } from 'react';
import { DetectedQuestion, QuestionImage, DebugPageData } from '../../types';
import { constructQuestionCanvas, CropSettings } from '../../services/pdfService';

const DEBUG_CROP_SETTINGS: CropSettings = {
  cropPadding: 0,
  canvasPadding: 0,
  mergeOverlap: -5,
  debugExportPadding: 0
};

interface Props {
  width: number;
  selectedDetection: DetectedQuestion & { pageNumber: number; fileName: string } | null;
  selectedImage: QuestionImage | null;
  pageData?: DebugPageData; // The full page data needed to generate raw view
  isProcessing: boolean;
  draggingSide: 'left' | 'right' | 'top' | 'bottom' | null;
  dragValue: number | null;
  columnInfo: { indices: number[]; initialLeft: number; initialRight: number } | null;
}

export const DebugInspectorPanel: React.FC<Props> = ({
  width,
  selectedDetection,
  selectedImage,
  pageData,
  isProcessing,
  draggingSide,
  dragValue,
  columnInfo
}) => {
  const [displayRawUrl, setDisplayRawUrl] = useState<string | null>(null);
  const [isGeneratingRaw, setIsGeneratingRaw] = useState(false);

  // Effect: Generate raw view when selection changes
  useEffect(() => {
    setDisplayRawUrl(null);
    setIsGeneratingRaw(false);

    if (!selectedDetection || !pageData) return;

    const generateRawView = async () => {
      setIsGeneratingRaw(true);
      try {
        let boxes = selectedDetection.boxes_2d;
        if (!Array.isArray(boxes[0])) {
           // @ts-ignore
           boxes = [boxes];
        }

        const result = await constructQuestionCanvas(
          pageData.dataUrl,
          boxes as [number, number, number, number][],
          pageData.width,
          pageData.height,
          DEBUG_CROP_SETTINGS
        );

        if (result.originalDataUrl) {
          setDisplayRawUrl(result.originalDataUrl);
        }
      } catch (e) {
        console.error("Error generating debug view:", e);
      } finally {
        setIsGeneratingRaw(false);
      }
    };

    generateRawView();
  }, [selectedDetection, pageData]);

  return (
    <div 
        className="bg-slate-900 flex flex-col shadow-2xl relative z-20"
        style={{ width: `${width}%` }}
    >
      <div className="p-6 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md">
        <h3 className="text-slate-400 font-bold text-xs uppercase tracking-[0.2em]">Inspector</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-8 relative">
        {isProcessing && (
           <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-[2px] z-50 flex items-center justify-center">
                <span className="text-blue-400 font-black uppercase tracking-widest text-xs animate-pulse">Syncing...</span>
           </div>
        )}
        
        {selectedDetection ? (
          <div className="space-y-12 animate-[fade-in_0.3s_ease-out]">
              {/* Header Info */}
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h2 className="text-4xl font-black text-white tracking-tight">
                    {selectedDetection.id === 'continuation' ? 'Continuation' : `Q${selectedDetection.id}`}
                  </h2>
                  <span className="bg-slate-800 text-slate-400 px-4 py-1.5 rounded-full text-xs font-bold border border-slate-700">
                      Page {selectedDetection.pageNumber}
                  </span>
                </div>
                <p className="text-slate-500 text-sm font-medium break-all">{selectedDetection.fileName}</p>
                {columnInfo && (
                    <p className="mt-2 text-blue-400 text-xs font-bold uppercase tracking-wide bg-blue-900/20 inline-block px-2 py-1 rounded border border-blue-900/40">
                        Editing Column: {columnInfo.indices.length} Questions Linked
                    </p>
                )}
              </div>

              {/* Comparison Section */}
              <div className="grid grid-cols-1 gap-10">
                
                {/* 1. Final Processed Result */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                     <h4 className="text-green-400 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                       <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                       Final Processed Output
                     </h4>
                     {selectedImage && (
                        <span className="text-slate-600 text-[10px] font-mono">
                           {(selectedImage as any).width || '?'} x {(selectedImage as any).height || '?'} px
                        </span>
                     )}
                  </div>

                  <div className="bg-slate-950 rounded-3xl border border-green-900/30 p-6 shadow-2xl relative group overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-emerald-600 rounded-t-3xl opacity-50"></div>
                    {selectedImage ? (
                        <div className="flex items-center justify-center min-h-[160px] bg-white rounded-xl overflow-hidden relative cursor-zoom-in">
                          <div className="absolute inset-0 opacity-10" 
                              style={{backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '10px 10px'}}></div>
                          
                          <img 
                            src={selectedImage.dataUrl} 
                            alt="Final Result" 
                            className="relative max-w-full h-auto object-contain"
                          />
                        </div>
                    ) : (
                       <div className="h-40 flex flex-col items-center justify-center text-slate-600">
                         <span className="text-xs font-bold uppercase tracking-widest">Processing...</span>
                       </div>
                    )}
                  </div>
                </div>

                {/* 2. Raw Gemini Detection */}
                <div className="space-y-3">
                   <div className="flex justify-between items-center">
                        <h4 className="text-blue-400 font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                            <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                            Raw Gemini Detection (No Trim)
                        </h4>
                        <span className="text-[10px] text-slate-500 font-black uppercase">
                            Drag Lines to Adjust Crop
                        </span>
                   </div>

                   <div className="bg-slate-950 rounded-3xl border border-blue-900/30 p-6 shadow-2xl relative group overflow-hidden">
                     <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-t-3xl opacity-50"></div>
                     
                     {displayRawUrl ? (
                         <div className="flex items-center justify-center min-h-[160px] bg-white rounded-xl overflow-hidden relative cursor-zoom-in">
                           <div className="absolute inset-0 opacity-10" 
                               style={{backgroundImage: 'radial-gradient(#000 1px, transparent 1px)', backgroundSize: '10px 10px'}}></div>
                           
                           <img 
                             src={displayRawUrl} 
                             alt="Raw Gemini Crop" 
                             className="relative max-w-full h-auto object-contain"
                           />
                         </div>
                     ) : (
                        <div className="h-40 flex flex-col items-center justify-center text-slate-600 border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/50">
                           {isGeneratingRaw ? (
                               <div className="flex flex-col items-center gap-2">
                                   <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                                   <span className="text-xs font-bold uppercase tracking-widest text-blue-400">Generating Preview...</span>
                               </div>
                           ) : (
                               <span className="text-xs font-bold uppercase tracking-widest opacity-50">Raw view unavailable</span>
                           )}
                        </div>
                     )}
                   </div>
                </div>

              </div>

              {/* Technical Data */}
              <div className="space-y-4 pt-6 border-t border-slate-800">
                <div className="flex justify-between items-center">
                    <h4 className="text-slate-500 font-bold text-xs uppercase tracking-widest">Bounding Box Coordinates</h4>
                    <span className="text-blue-500 text-[10px] uppercase font-bold">Y-Axis (Green) • X-Axis (Blue)</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className={`bg-slate-800/30 p-3 rounded-lg border transition-colors ${draggingSide === 'top' ? 'bg-emerald-900/30 border-emerald-500' : 'bg-slate-800/30 border-slate-800'}`}>
                      <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">Y-Min (Top)</span>
                      <span className="text-white font-mono text-sm">
                          {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][0] : selectedDetection.boxes_2d[0]) as number) : '-'}
                      </span>
                    </div>
                    <div className={`p-3 rounded-lg border transition-colors ${draggingSide === 'left' ? 'bg-blue-900/30 border-blue-500' : 'bg-slate-800/30 border-slate-800'}`}>
                      <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">X-Min (Left)</span>
                      <span className="text-white font-mono text-sm">
                          {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][1] : selectedDetection.boxes_2d[1]) as number) : '-'}
                      </span>
                    </div>
                    <div className={`bg-slate-800/30 p-3 rounded-lg border transition-colors ${draggingSide === 'bottom' ? 'bg-emerald-900/30 border-emerald-500' : 'bg-slate-800/30 border-slate-800'}`}>
                      <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">Y-Max (Bottom)</span>
                      <span className="text-white font-mono text-sm">
                          {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][2] : selectedDetection.boxes_2d[2]) as number) : '-'}
                      </span>
                    </div>
                    <div className={`p-3 rounded-lg border transition-colors ${draggingSide === 'right' ? 'bg-blue-900/30 border-blue-500' : 'bg-slate-800/30 border-slate-800'}`}>
                      <span className="block text-[9px] text-slate-500 uppercase font-black mb-1">X-Max (Right)</span>
                      <span className="text-white font-mono text-sm">
                          {selectedDetection ? Math.round((Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0][3] : selectedDetection.boxes_2d[3]) as number) : '-'}
                      </span>
                    </div>
                </div>
              </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
              <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-8">
                  <svg className="w-12 h-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" /></svg>
              </div>
              <h3 className="text-slate-200 font-bold text-xl mb-3">No Selection</h3>
              <p className="text-slate-500 text-base max-w-[240px]">Click any bounding box on the left to inspect details and drag adjustment lines.</p>
          </div>
        )}
      </div>
    </div>
  );
};
