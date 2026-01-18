
/**
 * Shared Canvas Logic for "Edge Peel" algorithm.
 * Works in both Browser (DOM Canvas) and Node.js (node-canvas).
 */

/**
 * Intelligent "Edge Peel" Trimming.
 * Peels off artifacts (like black lines) from the edges until clean whitespace is found.
 */
export const getTrimmedBounds = (ctx, width, height, onStatus = null) => {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  // Threshold for "ink" vs "paper". 200 is fairly safe for black text.
  const threshold = 220; 

  const rowHasInk = (y) => {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Check for non-white pixels (low RGB values) or significant alpha
      if (data[i + 3] > 10 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  const colHasInk = (x) => {
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 10 && (data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold)) {
        return true;
      }
    }
    return false;
  };

  // We only peel from the edges, not deep into the image.
  const SAFETY_Y = Math.floor(h * 0.15); // Reduce safety to be more aggressive
  const SAFETY_X = Math.floor(w * 0.15);

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

/**
 * Trim whitespace from all sides of an image until non-white pixels are found.
 * Returns the bounding box of the content.
 */
export const trimWhitespace = (ctx, width, height) => {
  const w = Math.floor(width);
  const h = Math.floor(height);
  if (w <= 0 || h <= 0) return { x: 0, y: 0, w: 0, h: 0 };

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  
  // Adjusted threshold: math papers often have grayish backgrounds.
  // 240 is more aggressive than 250.
  const threshold = 242; 

  const isInkPixel = (x, y) => {
    const i = (y * w + x) * 4;
    // Transparent or pure white is paper
    if (data[i + 3] < 10) return false;
    // If any channel is below threshold, it's ink
    return data[i] < threshold || data[i + 1] < threshold || data[i + 2] < threshold;
  };

  const rowHasInk = (y) => {
    for (let x = 0; x < w; x++) {
      if (isInkPixel(x, y)) return true;
    }
    return false;
  };

  const colHasInk = (x) => {
    for (let y = 0; y < h; y++) {
      if (isInkPixel(x, y)) return true;
    }
    return false;
  };

  let top = 0;
  let bottom = h;
  let left = 0;
  let right = w;

  while (top < h && !rowHasInk(top)) { top++; }
  while (bottom > top && !rowHasInk(bottom - 1)) { bottom--; }
  while (left < w && !colHasInk(left)) { left++; }
  while (right > left && !colHasInk(right - 1)) { right--; }

  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
};

/**
 * Checks if box A is contained within or equal to box B.
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
