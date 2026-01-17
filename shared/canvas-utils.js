
/**
 * Shared Canvas Logic
 * Works in both Browser (DOM Canvas) and Node.js (node-canvas).
 */

/**
 * Scans the canvas content to find the bounding box of the ink/content.
 * (Trims surrounding whitespace)
 * 
 * @param {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D} ctx 
 * @param {number} width 
 * @param {number} height 
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export const trimWhitespace = (ctx, width, height) => {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const threshold = 240; // Pixels lighter than this are considered "white/empty"

  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;

  // Helper: Check if a row has any "ink" (non-white pixels)
  const rowHasInk = (y) => {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Check if pixel is NOT white (R,G,B < threshold) and has opacity
      if (data[i+3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  // Helper: Check if a column has any "ink"
  const colHasInk = (x, yStart, yEnd) => {
    for (let y = yStart; y <= yEnd; y++) {
      const i = (y * w + x) * 4;
      if (data[i+3] > 0 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  // Scan Top
  while (top < h && !rowHasInk(top)) {
    top++;
  }

  // If top reached h, the image is empty
  if (top === h) return { x: 0, y: 0, w: w, h: h }; 

  // Scan Bottom
  while (bottom > top && !rowHasInk(bottom)) {
    bottom--;
  }

  // Scan Left
  while (left < w && !colHasInk(left, top, bottom)) {
    left++;
  }

  // Scan Right
  while (right > left && !colHasInk(right, top, bottom)) {
    right--;
  }

  return {
    x: left,
    y: top,
    w: Math.max(1, right - left + 1),
    h: Math.max(1, bottom - top + 1)
  };
};

/**
 * Checks if box A is contained within or equal to box B.
 * Box format: [ymin, xmin, ymax, xmax] (0-1000)
 * 
 * @param {number[]} a 
 * @param {number[]} b 
 * @returns {boolean}
 */
export const isContained = (a, b) => {
  const [yminA, xminA, ymaxA, xmaxA] = a;
  const [yminB, xminB, ymaxB, xmaxB] = b;
  const tolerance = 5;

  return (
    xminA >= xminB - tolerance &&
    xmaxA <= xmaxB + tolerance &&
    yminA >= yminB - tolerance &&
    ymaxA <= ymaxB + tolerance
  );
};
