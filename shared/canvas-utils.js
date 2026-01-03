

/**
 * Shared Canvas Logic for "Edge Peel" algorithm and Box containment.
 * Works in both Browser (DOM Canvas) and Node.js (node-canvas).
 */

/**
 * Checks if 'inner' box is contained within 'outer' box with a small buffer.
 * @param {number[]} inner [ymin, xmin, ymax, xmax]
 * @param {number[]} outer [ymin, xmin, ymax, xmax]
 * @returns {boolean}
 */
export const isContained = (inner, outer) => {
  const buffer = 10; 
  return (
    inner[0] >= outer[0] - buffer && 
    inner[1] >= outer[1] - buffer && 
    inner[2] <= outer[2] + buffer && 
    inner[3] <= outer[3] + buffer    
  );
};

/**
 * Intelligent "Edge Peel" Trimming.
 * Peels off artifacts (like black lines) from the edges until clean whitespace is found.
 * 
 * @param {any} ctx 
 * @param {number} width 
 * @param {number} height 
 * @param {function(string): void} [onStatus]
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export const getTrimmedBounds = (ctx, width, height, onStatus = null) => {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const threshold = 200; 

  const rowHasInk = (y) => {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  const colHasInk = (x) => {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  const SAFETY_Y = Math.floor(h * 0.3);
  const SAFETY_X = Math.floor(w * 0.3);

  let top = 0;
  let bottom = h;
  let left = 0;
  let right = w;

  if (onStatus) onStatus("Peeling Top...");
  while (top < SAFETY_Y && rowHasInk(top)) { top++; }
  
  if (onStatus) onStatus("Peeling Bottom...");
  while (bottom > h - SAFETY_Y && bottom > top && rowHasInk(bottom - 1)) { bottom--; }
  
  if (onStatus) onStatus("Peeling Left...");
  while (left < SAFETY_X && colHasInk(left)) { left++; }
  
  if (onStatus) onStatus("Peeling Right...");
  while (right > w - SAFETY_X && right > left && colHasInk(right - 1)) { right--; }

  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
};