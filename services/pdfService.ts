import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import { getTrimmedBounds, isContained } from '../shared/canvas-utils.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

export interface CropSettings {
  cropPadding: number;
  canvasPaddingLeft: number;
  canvasPaddingRight: number;
  canvasPaddingY: number;
}

export const renderPageToImage = async (page: any, scale: number = 3): Promise<{ dataUrl: string, width: number, height: number }> => {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  
  if (!context) throw new Error("Canvas context failed");
  
  canvas.height = viewport.height;
  canvas.width = viewport.width;

  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise;

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.9),
    width: canvas.width,
    height: canvas.height
  };
};

/**
 * Creates a lower resolution copy of a base64 image for faster AI processing.
 */
export const createLowResCopy = async (base64: string, scaleFactor: number = 0.5): Promise<{ dataUrl: string, width: number, height: number }> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.floor(img.width * scaleFactor);
      const h = Math.floor(img.height * scaleFactor);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error("Canvas context failed"));
      
      ctx.drawImage(img, 0, 0, w, h);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.8),
        width: w,
        height: h
      });
    };
    img.onerror = reject;
    img.src = base64;
  });
};

/**
 * Renders multiple PDF pages and stitches them into a single long vertical image.
 */
export const mergePdfPagesToSingleImage = async (
  pdf: any, 
  totalPages: number, 
  scale: number = 2.5, // Slightly lower scale for giant images to save memory
  onProgress?: (current: number, total: number) => void
): Promise<{ dataUrl: string, width: number, height: number }> => {
  
  const pageImages: { img: HTMLImageElement, width: number, height: number }[] = [];
  let totalHeight = 0;
  let maxWidth = 0;

  // 1. Render all pages individually first
  for (let i = 1; i <= totalPages; i++) {
    if (onProgress) onProgress(i, totalPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
      const img = new Image();
      img.src = canvas.toDataURL('image/jpeg', 0.85);
      await new Promise(r => img.onload = r);
      
      pageImages.push({ img, width: viewport.width, height: viewport.height });
      totalHeight += viewport.height;
      maxWidth = Math.max(maxWidth, viewport.width);
    }
  }

  // 2. Create giant canvas
  const canvas = document.createElement('canvas');
  canvas.width = maxWidth;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) throw new Error("Failed to create giant canvas");

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 3. Draw them stacked
  let currentY = 0;
  for (const p of pageImages) {
    // Center smaller pages if any
    const x = (maxWidth - p.width) / 2;
    ctx.drawImage(p.img, x, currentY);
    currentY += p.height;
  }

  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    width: canvas.width,
    height: canvas.height
  };
};

/**
 * Stitches two Base64 images vertically.
 * Used for merging a "continuation" fragment to the previous question.
 */
export const mergeBase64Images = async (topBase64: string, bottomBase64: string): Promise<string> => {
  const loadImg = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  const [imgTop, imgBottom] = await Promise.all([loadImg(topBase64), loadImg(bottomBase64)]);

  const width = Math.max(imgTop.width, imgBottom.width);
  const height = imgTop.height + imgBottom.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (!ctx) return topBase64;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Draw Top (Left Aligned)
  ctx.drawImage(imgTop, 0, 0);
  
  // Draw Bottom (Left Aligned)
  ctx.drawImage(imgBottom, 0, imgTop.height);

  return canvas.toDataURL('image/jpeg', 0.95);
};

/**
 * Crops multiple segments from the source, trims black artifacts, and stitches them vertically.
 * Handles deduplication of nested boxes.
 * 
 * Returns { final: string, original?: string }
 */
export const cropAndStitchImage = (
  sourceDataUrl: string, 
  boxes: [number, number, number, number][], // Array of [ymin, xmin, ymax, xmax] 0-1000
  originalWidth: number, 
  originalHeight: number,
  settings: CropSettings,
  onStatus?: (msg: string) => void
): Promise<{ final: string, original?: string }> => {
  return new Promise((resolve) => {
    if (!boxes || boxes.length === 0) {
      resolve({ final: '' });
      return;
    }

    // 1. Filter out contained boxes (Deduplication) while preserving original order.
    // We strictly respect the order returned by the AI (boxes_2d), assuming the Prompt ensures Left->Right, Top->Bottom.
    
    const indicesToDrop = new Set<number>();
    
    for (let i = 0; i < boxes.length; i++) {
      for (let j = 0; j < boxes.length; j++) {
        if (i === j) continue;
        
        // Check if box[i] is contained in box[j]
        if (isContained(boxes[i], boxes[j])) {
           const iContainsJ = isContained(boxes[j], boxes[i]);
           
           if (iContainsJ) {
              // Mutual containment (effectively identical). 
              // Drop the later one to avoid duplicates.
              if (i > j) {
                 indicesToDrop.add(i);
                 break;
              }
           } else {
              // Strict containment: i is inside j. Drop i.
              indicesToDrop.add(i);
              break;
           }
        }
      }
    }

    const finalBoxes = boxes.filter((_, i) => !indicesToDrop.has(i));

    const img = new Image();
    img.onload = () => {
      // 3. Define padding parameters from Settings
      const CROP_PADDING = settings.cropPadding; 
      const CANVAS_PADDING_LEFT = settings.canvasPaddingLeft;
      const CANVAS_PADDING_RIGHT = settings.canvasPaddingRight;
      const CANVAS_PADDING_Y = settings.canvasPaddingY;

      // 4. Extract and Trim each fragment
      const processedFragments = finalBoxes.map((box, idx) => {
        const [ymin, xmin, ymax, xmax] = box;
        
        // Initial coarse crop coordinates
        const x = Math.max(0, (xmin / 1000) * originalWidth - CROP_PADDING);
        const y = Math.max(0, (ymin / 1000) * originalHeight - CROP_PADDING);
        
        const rawW = ((xmax - xmin) / 1000) * originalWidth + (CROP_PADDING * 2);
        const rawH = ((ymax - ymin) / 1000) * originalHeight + (CROP_PADDING * 2);

        const w = Math.min(originalWidth - x, rawW);
        const h = Math.min(originalHeight - y, rawH);

        // Create a temporary canvas for this specific fragment
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.floor(w);
        tempCanvas.height = Math.floor(h);
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return null;

        // Draw the raw coarse crop onto temp canvas
        tempCtx.drawImage(img, x, y, w, h, 0, 0, w, h);

        if (onStatus) onStatus(`Refining fragment ${idx + 1}/${finalBoxes.length}...`);

        // Apply Shared "Edge Peel" Logic
        const trim = getTrimmedBounds(tempCtx, Math.floor(w), Math.floor(h), onStatus);

        return {
          sourceCanvas: tempCanvas,
          trim: trim,
          // Calculate the absolute X position of the *ink* on the original page.
          // This allows us to preserve relative indentation even after trimming.
          // x = crop start X, trim.x = whitespace removed from left
          absInkX: x + trim.x 
        };
      }).filter(Boolean) as { sourceCanvas: HTMLCanvasElement, trim: {x: number, y: number, w: number, h: number}, absInkX: number }[];

      if (processedFragments.length === 0) {
        resolve({ final: '' });
        return;
      }

      // 5. Determine final canvas size
      // Find the leftmost ink position across all fragments to serve as the anchor (relative 0)
      const minAbsInkX = Math.min(...processedFragments.map(f => f.absInkX));
      
      // Calculate the required width to hold all fragments while preserving their relative X offsets
      // Width = Max(RelativeX + Width)
      const maxRightEdge = Math.max(...processedFragments.map(f => (f.absInkX - minAbsInkX) + f.trim.w));
      const finalWidth = maxRightEdge + CANVAS_PADDING_LEFT + CANVAS_PADDING_RIGHT;
      
      const fragmentGap = 10; 

      const totalContentHeight = processedFragments.reduce((acc, f) => acc + f.trim.h, 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1)));
      const finalHeight = totalContentHeight + (CANVAS_PADDING_Y * 2);

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve({ final: '' });

      canvas.width = finalWidth;
      canvas.height = finalHeight;

      // Fill background white
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 6. Draw each fragment using the trimmed coordinates + Relative Indentation
      let currentY = CANVAS_PADDING_Y;
      processedFragments.forEach((f) => {
        // Calculate relative indentation offset
        const relativeOffset = f.absInkX - minAbsInkX;
        const offsetX = CANVAS_PADDING_LEFT + relativeOffset;
        
        ctx.drawImage(
          f.sourceCanvas, 
          f.trim.x, f.trim.y, f.trim.w, f.trim.h, // Source
          offsetX, currentY, f.trim.w, f.trim.h   // Destination
        );
        currentY += f.trim.h + fragmentGap;
      });

      const finalDataUrl = canvas.toDataURL('image/jpeg', 0.95);

      // --- 7. Generate Original (Unpeeled) Image for Comparison ---
      const wasTrimmed = processedFragments.some(f => 
        f.trim.w < f.sourceCanvas.width || f.trim.h < f.sourceCanvas.height
      );

      let originalDataUrl: string | undefined;

      if (wasTrimmed) {
         const maxRawWidth = Math.max(...processedFragments.map(f => f.sourceCanvas.width));
         const finalRawWidth = maxRawWidth + CANVAS_PADDING_LEFT + CANVAS_PADDING_RIGHT;
         const totalRawHeight = processedFragments.reduce((acc, f) => acc + f.sourceCanvas.height, 0) + (fragmentGap * (Math.max(0, processedFragments.length - 1)));
         const finalRawHeight = totalRawHeight + (CANVAS_PADDING_Y * 2);

         const rawCanvas = document.createElement('canvas');
         rawCanvas.width = finalRawWidth;
         rawCanvas.height = finalRawHeight;
         const rawCtx = rawCanvas.getContext('2d');
         
         if (rawCtx) {
             rawCtx.fillStyle = '#ffffff';
             rawCtx.fillRect(0, 0, rawCanvas.width, rawCanvas.height);
             
             let currentRawY = CANVAS_PADDING_Y;
             processedFragments.forEach(f => {
                 // For raw view, we just left-align simply, as 'absInkX' logic applies to trimmed ink.
                 // This gives a good comparison of "Raw Crop" vs "Smart Clean Layout"
                 const offsetX = CANVAS_PADDING_LEFT;
                 rawCtx.drawImage(f.sourceCanvas, offsetX, currentRawY);
                 currentRawY += f.sourceCanvas.height + fragmentGap;
             });
             originalDataUrl = rawCanvas.toDataURL('image/jpeg', 0.95);
         }
      }

      resolve({ final: finalDataUrl, original: originalDataUrl });
    };
    img.src = sourceDataUrl;
  });
};
