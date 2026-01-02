
/**
 * Math Exam PDF Question Splitter - Node.js Version
 * 
 * Usage: 
 *   export API_KEY="your_gemini_api_key"
 *   node scripts/process-pdf.mjs <input_pdf_path> <output_zip_path> [enable_detailed=false] [model_name=gemini-3-pro-preview]
 * 
 * Dependencies:
 *   npm install canvas pdfjs-dist @google/genai jszip
 */

import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GoogleGenAI, Type } from "@google/genai";
import JSZip from 'jszip';

// 1. Setup PDF.js for Node environment
pdfjsLib.GlobalWorkerOptions.workerSrc = ''; 

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("Error: API_KEY environment variable is missing.");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.log("Usage: node scripts/process-pdf.mjs <input.pdf> <output.zip> [enable_detailed_analysis=false] [model_name=gemini-3-pro-preview]");
  process.exit(1);
}

const [inputPath, outputPath, detailedFlag, modelFlag] = args;
const enableDetailedAnalysis = detailedFlag === 'true';
const selectedModel = modelFlag || 'gemini-3-pro-preview';

const ai = new GoogleGenAI({ apiKey: API_KEY });

/**
 * Renders a PDF page to a Node Canvas and returns base64 and dims
 */
async function renderPageToBuffer(page, scale = 3) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext('2d');

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  // return buffer and dimensions
  return {
    buffer: canvas.toBuffer('image/jpeg', { quality: 0.9 }),
    base64: canvas.toDataURL('image/jpeg', 0.9),
    width: viewport.width,
    height: viewport.height
  };
}

/**
 * Gemini AI Detection Logic
 */
async function detectQuestions(base64ImageStr, detailed, modelId) {
  const basicPrompt = `分析这张高考数学试卷页面并提取题目。

严格目标：
1. **精确性**：边界划分需要适中,在空白的区域的中线进行划分, 既保留必要空白, 又避免截到其他题目的文本。
2. **完整性（关键）**：务必确保题号完整包含在框内。特别是两位数题号（如12.），边界框的左侧（xmin）必须包含第一个数字，不要切掉。
3. **无重复**：一道题通常应该由一个框表示。不要输出一个"整题"的框，又单独输出一个"选项"的框。

输出规则：
- 返回一个 JSON 数组。
- 'id': 题号（例如 "11"）。
- 'boxes_2d': 一个数组 [ymin, xmin, ymax, xmax]（0-1000 归一化坐标）。

框选逻辑：
- **单栏**：返回一个包含所有内容的框。
- **跨栏**：如果一道题跨栏，返回两个框：[框 1 (第一栏末尾)], [框 2 (第二栏开头)]。
- **安全检查**：如果不确定图表属于 Q11 还是 Q12，请检查空间邻近度。图表通常出现在文字的*下方*或*旁边*，很少出现在题号上方。`;

  const detailedPrompt = `
    
额外的详细提取要求：
你必须为每个问题提取以下内容：
1. **markdown**: Markdown 格式的完整题目文本。
   - 所有数学公式必须使用 LaTeX（行内用 $，块级用 $$）。
2. **tags**: 1-3 个关键词的数组。
3. **type**: 属于 ["选择题", "填空题", "解答题", "其他"] 之一。
4. **difficulty**: 属于 ["简单", "中等", "困难"] 之一。
5. **analysis**: 对关键解题步骤和逻辑的简明分析。
6. **graphic_boxes_2d**: 仅识别题目内部图表/几何图形/图形的边界框。返回 [ymin, xmin, ymax, xmax] 的数组。
`;

  const basicSchemaItems = {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER }
        },
        description: "Array of [ymin, xmin, ymax, xmax] normalized 0-1000"
      }
    },
    required: ["id", "boxes_2d"]
  };

  const detailedSchemaItems = {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER }
        },
        description: "Array of [ymin, xmin, ymax, xmax] normalized 0-1000"
      },
      markdown: { type: Type.STRING },
      tags: { type: Type.ARRAY, items: { type: Type.STRING } },
      type: { type: Type.STRING },
      difficulty: { type: Type.STRING },
      analysis: { type: Type.STRING },
      graphic_boxes_2d: {
         type: Type.ARRAY,
         items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
      }
    },
    required: ["id", "boxes_2d", "markdown", "type", "analysis"]
  };

  try {
    const cleanBase64 = base64ImageStr.split(',')[1];

    const response = await ai.models.generateContent({
      model: modelId || 'gemini-3-pro-preview', 
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: cleanBase64
              }
            },
            {
              text: detailed ? basicPrompt + detailedPrompt : basicPrompt
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: detailed ? detailedSchemaItems : basicSchemaItems
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini Error:", error);
    return [];
  }
}

const isContained = (inner, outer) => {
  const buffer = 10; 
  return (
    inner[0] >= outer[0] - buffer && 
    inner[1] >= outer[1] - buffer && 
    inner[2] <= outer[2] + buffer && 
    inner[3] <= outer[3] + buffer    
  );
};

/**
 * Intelligent "Edge Peel" Trimming (Ported to Node Canvas)
 * Updated to ONLY peel black artifacts, preserving clean whitespace.
 */
const getTrimmedBounds = (ctx, width, height) => {
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

  // 1. Peel Top (Only if ink)
  while (top < SAFETY_Y && rowHasInk(top)) { top++; }

  // 2. Peel Bottom (Only if ink)
  while (bottom > h - SAFETY_Y && bottom > top && rowHasInk(bottom - 1)) { bottom--; }

  // 3. Peel Left (Only if ink)
  while (left < SAFETY_X && colHasInk(left)) { left++; }

  // 4. Peel Right (Only if ink)
  while (right > w - SAFETY_X && right > left && colHasInk(right - 1)) { right--; }

  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top)
  };
};

/**
 * Stitching Logic
 */
async function cropAndStitch(sourceBuffer, boxes, originalWidth, originalHeight) {
  if (!boxes || boxes.length === 0) return null;

  // 1. Filter Contained
  const getArea = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  const sortedBySize = [...boxes].sort((a, b) => getArea(b) - getArea(a));
  
  const finalBoxes = [];
  for (const box of sortedBySize) {
    const isRedundant = finalBoxes.some(keeper => isContained(box, keeper));
    if (!isRedundant) {
      finalBoxes.push(box);
    }
  }

  // 2. Sort
  finalBoxes.sort((a, b) => {
    const centerXA = (a[1] + a[3]) / 2;
    const centerXB = (b[1] + b[3]) / 2;
    if (Math.abs(centerXA - centerXB) > 150) {
      return centerXA - centerXB; 
    }
    return a[0] - b[0];
  });

  const img = await loadImage(sourceBuffer);

  // 3. Define padding - EXTRA padding for the peel algorithm to work
  const CROP_PADDING = 25;
  const CANVAS_PADDING_LEFT = 10;
  const CANVAS_PADDING_RIGHT = 30;
  const CANVAS_PADDING_Y = 20;

  // 4. Extract and Trim
  const processedFragments = finalBoxes.map(box => {
    const [ymin, xmin, ymax, xmax] = box;
    const x = Math.max(0, (xmin / 1000) * originalWidth - CROP_PADDING);
    const y = Math.max(0, (ymin / 1000) * originalHeight - CROP_PADDING);
    
    const rawW = ((xmax - xmin) / 1000) * originalWidth + (CROP_PADDING * 2);
    const rawH = ((ymax - ymin) / 1000) * originalHeight + (CROP_PADDING * 2);

    const w = Math.min(originalWidth - x, rawW);
    const h = Math.min(originalHeight - y, rawH);
    
    // Create temp canvas to trim
    const tempCanvas = createCanvas(Math.floor(w), Math.floor(h));
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, x, y, w, h, 0, 0, w, h);

    // Apply Intelligent Trim
    const trim = getTrimmedBounds(tempCtx, Math.floor(w), Math.floor(h));

    return {
      sourceCanvas: tempCanvas,
      trim: trim 
    };
  }).filter(f => f.trim.w > 0 && f.trim.h > 0);

  if (processedFragments.length === 0) return null;

  // 5. Final Canvas Size
  const maxFragmentWidth = Math.max(...processedFragments.map(f => f.trim.w));
  const finalWidth = maxFragmentWidth + CANVAS_PADDING_LEFT + CANVAS_PADDING_RIGHT;
  
  const gap = 5;
  const totalContentHeight = processedFragments.reduce((acc, f) => acc + f.trim.h, 0) + (gap * (Math.max(0, processedFragments.length - 1)));
  const finalHeight = totalContentHeight + (CANVAS_PADDING_Y * 2);

  const canvas = createCanvas(finalWidth, finalHeight);
  const ctx = canvas.getContext('2d');

  // Fill white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 6. Draw
  let currentY = CANVAS_PADDING_Y;
  processedFragments.forEach((f) => {
    const centerOffset = (maxFragmentWidth - f.trim.w) / 2;
    const offsetX = CANVAS_PADDING_LEFT + centerOffset;
    
    ctx.drawImage(
      f.sourceCanvas, 
      f.trim.x, f.trim.y, f.trim.w, f.trim.h, // source
      offsetX, currentY, f.trim.w, f.trim.h   // dest
    );
    currentY += f.trim.h + gap;
  });

  // Return Buffer
  return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

async function main() {
  console.log(`Starting PDF Processing...`);
  console.log(`Input: ${inputPath}`);
  console.log(`Output: ${outputPath}`);
  console.log(`Detailed Analysis: ${enableDetailedAnalysis}`);
  console.log(`Model: ${selectedModel}`);

  try {
    const dataBuffer = await readFile(inputPath);
    const data = new Uint8Array(dataBuffer);
    
    const loadingTask = pdfjsLib.getDocument(data);
    const pdf = await loadingTask.promise;
    console.log(`PDF Loaded. Pages: ${pdf.numPages}`);

    const zip = new JSZip();
    const folder = zip.folder("math_questions");

    for (let i = 1; i <= pdf.numPages; i++) {
      console.log(`Processing Page ${i}/${pdf.numPages}...`);
      
      const page = await pdf.getPage(i);
      const { base64, buffer, width, height } = await renderPageToBuffer(page);

      console.log(`  - AI Detecting questions...`);
      const detections = await detectQuestions(base64, enableDetailedAnalysis, selectedModel);
      console.log(`  - Found ${detections.length} questions.`);

      for (const detection of detections) {
        const stitchedBuffer = await cropAndStitch(buffer, detection.boxes_2d, width, height);
        
        if (stitchedBuffer) {
           const filename = `P${i}_Q${detection.id}.jpg`;
           folder.file(filename, stitchedBuffer);

           if (enableDetailedAnalysis && detection.markdown) {
             const mdContent = `
---
Question ID: ${detection.id}
Type: ${detection.type}
Difficulty: ${detection.difficulty}
Tags: ${JSON.stringify(detection.tags)}
---

## Question
${detection.markdown}

## Analysis
${detection.analysis}
`;
             folder.file(`P${i}_Q${detection.id}_info.md`, mdContent.trim());
           }
        }
      }
    }

    console.log(`Generating ZIP file...`);
    const zipContent = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await writeFile(outputPath, zipContent);
    console.log(`Success! Saved to ${outputPath}`);

  } catch (error) {
    console.error("Processing Failed:", error);
    process.exit(1);
  }
}

main();
