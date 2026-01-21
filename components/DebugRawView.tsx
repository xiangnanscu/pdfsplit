
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { DebugPageData, QuestionImage, DetectedQuestion } from '../types';
import { DebugToolbar } from './debug/DebugToolbar';
import { DebugPageViewer } from './debug/DebugPageViewer';
import { DebugInspectorPanel } from './debug/DebugInspectorPanel';
import { getPageImage } from '../services/storageService';

interface Props {
  pages: DebugPageData[];
  questions: QuestionImage[];
  onClose: () => void;
  title?: string;
  onNextFile?: () => void;
  onPrevFile?: () => void;
  onJumpToIndex?: (index: number) => void;
  hasNextFile?: boolean;
  hasPrevFile?: boolean;
  onUpdateDetections?: (fileName: string, pageNumber: number, newDetections: DetectedQuestion[]) => void;
  onReanalyzeFile?: (fileName: string) => void;
  isGlobalProcessing?: boolean;
  processingFiles: Set<string>;
  currentFileIndex: number;
  totalFiles: number;
  currentExamId?: string | null; // Added optional prop
}

export const DebugRawView: React.FC<Props> = ({ 
  pages, 
  questions, 
  onClose, 
  title,
  onNextFile,
  onPrevFile,
  onJumpToIndex,
  hasNextFile,
  hasPrevFile,
  onUpdateDetections,
  onReanalyzeFile,
  isGlobalProcessing = false,
  processingFiles,
  currentFileIndex,
  totalFiles,
  currentExamId
}) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Dragging State
  const [draggingSide, setDraggingSide] = useState<'left' | 'right' | 'top' | 'bottom' | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  
  // Panel Resizing State
  const [leftPanelWidth, setLeftPanelWidth] = useState(70); 
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy Loading State
  const [hydratedPages, setHydratedPages] = useState<DebugPageData[]>(pages);
  const [isLoadingImages, setIsLoadingImages] = useState(false);

  // Effect: Hydrate pages when title/file changes
  useEffect(() => {
    // If pages already have dataUrl, use them directly
    if (pages.length > 0 && pages[0].dataUrl) {
        setHydratedPages(pages);
        setIsLoadingImages(false);
        return;
    }

    if (!currentExamId || !title) {
        setHydratedPages(pages); // Fallback to skeleton
        return;
    }

    // Lazy Load
    setIsLoadingImages(true);
    let active = true;

    const loadImages = async () => {
        const promises = pages.map(async (p) => {
            if (p.dataUrl) return p;
            const url = await getPageImage(currentExamId, p.fileName, p.pageNumber);
            return { ...p, dataUrl: url || '' }; // Return with loaded URL
        });
        
        const loaded = await Promise.all(promises);
        if (active) {
            setHydratedPages(loaded);
            setIsLoadingImages(false);
        }
    };

    loadImages();

    return () => { active = false; };
  }, [pages, title, currentExamId]);

  // Check if current file is processing
  const isCurrentFileProcessing = useMemo(() => {
     if (isGlobalProcessing) return true;
     return title ? processingFiles.has(title) : false;
  }, [isGlobalProcessing, processingFiles, title]);

  // Reset selected key when the file changes
  useEffect(() => {
    setSelectedKey(null);
    setDraggingSide(null);
    setDragValue(null);
  }, [pages[0]?.fileName]);

  const { selectedImage, selectedDetection, pageDetections, selectedIndex } = useMemo(() => {
    if (!selectedKey) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };
    
    const parts = selectedKey.split('||');
    if (parts.length !== 3) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };

    const fileName = parts[0];
    const pageNum = parseInt(parts[1], 10);
    const detIdx = parseInt(parts[2], 10);

    // Use hydrated pages here
    const page = hydratedPages.find(p => p.fileName === fileName && p.pageNumber === pageNum);
    if (!page) return { selectedImage: null, selectedDetection: null, pageDetections: [], selectedIndex: -1 };

    const detectionRaw = page.detections[detIdx];
    const detection = detectionRaw ? { ...detectionRaw, pageNumber: pageNum, fileName } : null;

    let effectiveId: string | null = null;
    const filePages = hydratedPages.filter(p => p.fileName === fileName).sort((a,b) => a.pageNumber - b.pageNumber);
    let found = false;
    for (const p of filePages) {
        for (let i = 0; i < p.detections.length; i++) {
            const d = p.detections[i];
            if (d.id !== 'continuation') {
                effectiveId = d.id;
            }
            if (p.pageNumber === pageNum && i === detIdx) {
                found = true;
                break;
            }
        }
        if (found) break;
    }

    const image = effectiveId ? questions.find(q => q.fileName === fileName && q.id === effectiveId) || null : null;

    return { selectedImage: image, selectedDetection: detection, pageDetections: page.detections, selectedIndex: detIdx };
  }, [selectedKey, hydratedPages, questions]);

  // Column Group Logic
  const columnInfo = useMemo(() => {
    if (!selectedDetection || !pageDetections.length) return null;

    const boxes = (Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0] : selectedDetection.boxes_2d) as [number, number, number, number];
    const targetXMin = boxes[1];
    const targetXMax = boxes[3];
    const THRESHOLD = 50; 

    const columnIndices: number[] = [];
    let minX = targetXMin;
    let maxX = targetXMax;

    pageDetections.forEach((det, idx) => {
        const b = (Array.isArray(det.boxes_2d[0]) ? det.boxes_2d[0] : det.boxes_2d) as [number, number, number, number];
        const detXMin = b[1];
        const detXMax = b[3];
        
        if (Math.abs(detXMin - targetXMin) < THRESHOLD && Math.abs(detXMax - targetXMax) < THRESHOLD) {
            columnIndices.push(idx);
        }
    });

    return { indices: columnIndices, initialLeft: minX, initialRight: maxX };
  }, [selectedDetection, pageDetections]);

  // Current Box coords for overlays
  const selectedBoxCoords = useMemo(() => {
    if (!selectedDetection) return null;
    const boxes = (Array.isArray(selectedDetection.boxes_2d[0]) ? selectedDetection.boxes_2d[0] : selectedDetection.boxes_2d) as [number, number, number, number];
    return {
        ymin: boxes[0],
        xmin: boxes[1],
        ymax: boxes[2],
        xmax: boxes[3]
    };
  }, [selectedDetection]);

  // Selected Page Data Helper
  const selectedPageData = useMemo(() => {
    if (!selectedDetection) return undefined;
    return hydratedPages.find(p => p.fileName === selectedDetection.fileName && p.pageNumber === selectedDetection.pageNumber);
  }, [hydratedPages, selectedDetection]);

  // --- Resizing Logic ---
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); 
    setIsResizingPanel(true);
  }, []);

  const handlePanelResize = useCallback((e: MouseEvent) => {
    if (!isResizingPanel || !containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPanelWidth(Math.max(20, Math.min(80, newWidth)));
  }, [isResizingPanel]);

  const stopResizing = useCallback(() => {
    setIsResizingPanel(false);
  }, []);

  useEffect(() => {
    if (isResizingPanel) {
      window.addEventListener('mousemove', handlePanelResize);
      window.addEventListener('mouseup', stopResizing);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      window.removeEventListener('mousemove', handlePanelResize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    return () => {
      window.removeEventListener('mousemove', handlePanelResize);
      window.removeEventListener('mouseup', stopResizing);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingPanel, handlePanelResize, stopResizing]);

  // Global Mouse Up to Commit Drag
  const handleGlobalMouseUp = useCallback(async () => {
      if (!draggingSide || dragValue === null || !selectedDetection || !onUpdateDetections) {
          setDraggingSide(null);
          setDragValue(null);
          return;
      }

      const parts = selectedKey!.split('||');
      const fileName = parts[0];
      const pageNum = parseInt(parts[1], 10);
      
      const newDetections = JSON.parse(JSON.stringify(pageDetections)) as DetectedQuestion[];
      
      if (draggingSide === 'left' || draggingSide === 'right') {
          if (columnInfo) {
            columnInfo.indices.forEach(idx => {
                const det = newDetections[idx];
                if (Array.isArray(det.boxes_2d[0])) {
                    if (draggingSide === 'left') (det.boxes_2d[0] as any)[1] = Math.round(dragValue);
                    else (det.boxes_2d[0] as any)[3] = Math.round(dragValue);
                } else {
                    if (draggingSide === 'left') (det.boxes_2d as any)[1] = Math.round(dragValue);
                    else (det.boxes_2d as any)[3] = Math.round(dragValue);
                }
            });
          }
      } else {
          const det = newDetections[selectedIndex];
          if (det) {
              if (Array.isArray(det.boxes_2d[0])) {
                  if (draggingSide === 'top') (det.boxes_2d[0] as any)[0] = Math.round(dragValue);
                  else (det.boxes_2d[0] as any)[2] = Math.round(dragValue);
              } else {
                  if (draggingSide === 'top') (det.boxes_2d as any)[0] = Math.round(dragValue);
                  else (det.boxes_2d as any)[2] = Math.round(dragValue);
              }
          }
      }

      setDraggingSide(null);
      setDragValue(null);
      
      onUpdateDetections(fileName, pageNum, newDetections);
      
  }, [draggingSide, dragValue, columnInfo, selectedDetection, pageDetections, selectedKey, onUpdateDetections, selectedIndex]);

  useEffect(() => {
      if (draggingSide) {
          window.addEventListener('mouseup', handleGlobalMouseUp);
      } else {
          window.removeEventListener('mouseup', handleGlobalMouseUp);
      }
      return () => {
          window.removeEventListener('mouseup', handleGlobalMouseUp);
      };
  }, [draggingSide, handleGlobalMouseUp]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (draggingSide) {
            setDraggingSide(null);
            setDragValue(null);
        } else if (selectedKey) {
            setSelectedKey(null);
        } else {
            onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draggingSide, selectedKey, onClose]);


  if (pages.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-950 animate-[fade-in_0.2s_ease-out]">
      <DebugToolbar 
         title={title}
         pageCount={pages.length}
         currentFileIndex={currentFileIndex}
         totalFiles={totalFiles}
         onPrevFile={onPrevFile}
         onNextFile={onNextFile}
         onJumpToIndex={onJumpToIndex}
         onClose={onClose}
         onReanalyze={!isCurrentFileProcessing && onReanalyzeFile && title ? () => onReanalyzeFile(title) : undefined}
         hasNextFile={hasNextFile}
         hasPrevFile={hasPrevFile}
      />

      <div className="flex-1 flex overflow-hidden relative" ref={containerRef}>
        {isLoadingImages && (
            <div className="absolute inset-0 z-[80] bg-slate-900/50 flex items-center justify-center">
                 <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-white font-bold text-sm">Loading Full Pages...</span>
                 </div>
            </div>
        )}
        
        <DebugPageViewer 
           width={leftPanelWidth}
           pages={hydratedPages} 
           selectedKey={selectedKey}
           onSelectKey={setSelectedKey}
           selectedDetection={selectedDetection}
           selectedBoxCoords={selectedBoxCoords}
           columnInfo={columnInfo}
           draggingSide={draggingSide}
           dragValue={dragValue}
           onDragStateChange={(side, val) => {
               setDraggingSide(side);
               setDragValue(val);
           }}
           isProcessing={isCurrentFileProcessing}
           hasNextFile={!!hasNextFile}
           hasPrevFile={!!hasPrevFile}
           onTriggerNextFile={() => onNextFile && onNextFile()}
           onTriggerPrevFile={() => onPrevFile && onPrevFile()}
        />

        <div
            className={`w-2 bg-slate-950 hover:bg-blue-600 cursor-col-resize relative z-[60] flex items-center justify-center transition-colors border-l border-r border-slate-800 flex-none select-none ${isResizingPanel ? 'bg-blue-600' : ''}`}
            onMouseDown={startResizing}
        >
            <div className="w-0.5 h-8 bg-slate-600 rounded-full pointer-events-none"></div>
        </div>

        <DebugInspectorPanel 
            width={100 - leftPanelWidth}
            selectedDetection={selectedDetection}
            selectedImage={selectedImage}
            pageData={selectedPageData}
            isProcessing={isCurrentFileProcessing}
            draggingSide={draggingSide}
            dragValue={dragValue}
            columnInfo={columnInfo}
        />
      </div>
    </div>
  );
};
