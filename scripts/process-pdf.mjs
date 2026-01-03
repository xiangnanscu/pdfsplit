
/**
 * Math Exam PDF Question Splitter - Node.js Version
 * 
 * Usage: 
 *   export API_KEY="your_gemini_api_key"
 *   node scripts/process-pdf.mjs <input_path> [output_path] [concurrency=10]
 * 
 * Examples:
 *   Single file: node scripts/process-pdf.mjs exam.pdf
 *   Single file explicit: node scripts/process-pdf.mjs exam.pdf result.zip
 *   Folder batch: node scripts/process-pdf.mjs ./exams/ ./results/ 5
 */

import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import path from 'path';
import { createCanvas, loadImage } from 'canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { GoogleGenAI, Type } from "@google/genai";
import JSZip from 'jszip';
import { PROMPTS, SCHEMAS, MODEL_IDS } from '../shared/ai-config.js';
import { getTrimmedBounds, isContained } from '../shared/canvas-utils.js';

// 1. Setup PDF.js for Node environment
pdfjsLib.GlobalWorkerOptions.workerSrc = ''; 

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error("Error: API_KEY environment variable is missing.");
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.log("Usage: node scripts/process-pdf.mjs <input_path> [output_path] [concurrency]");
  process.exit(1);
}

const inputPath = args[0];
const userOutputPath = args[1]; // Optional
const concurrencyArg = args[2]; // Optional

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Configuration - synced with Frontend defaults
const SETTINGS = {
  enableDetailedAnalysis: true, // Defaults to true for script
  modelId: MODEL_IDS.PRO,
  cropPadding: 25,
  canvasPaddingLeft: 10,
  canvasPaddingRight: 30,
  canvasPaddingY: 20
};

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

  return {
    buffer: canvas.toBuffer('image/jpeg', { quality: 0.9 }),
    base64: canvas.toDataURL('image/jpeg', 0.9),
    width: viewport.width,
    height: viewport.height
  };
}

/**
 * Gemini AI Detection Logic using Shared Config
 */
async function detectQuestions(base64ImageStr) {
  try {
    const cleanBase64 = base64ImageStr.split(',')[1];
    
    const promptText = SETTINGS.enableDetailedAnalysis 
      ? PROMPTS.BASIC + PROMPTS.DETAILED_SUFFIX 
      : PROMPTS.BASIC;

    const itemsSchema = SETTINGS.enableDetailedAnalysis ? SCHEMAS.DETAILED : SCHEMAS.BASIC;

    const response = await ai.models.generateContent({
      model: SETTINGS.modelId,
      contents: [{
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } },
          { text: promptText }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: itemsSchema
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini Error:", error.message);
    return [];
  }
}

/**
 * Stitching Logic
 */
async function cropAndStitch(sourceBuffer, boxes, originalWidth, originalHeight) {
  if (!boxes || boxes.length === 0) return null;

  const getArea = (b) => (b[2] - b[0]) * (b[3] - b[1]);
  const sortedBySize = [...boxes].sort((a, b) => getArea(b) - getArea(a));
  
  const finalBoxes = [];
  for (const box of sortedBySize) {
    const isRedundant = finalBoxes.some(keeper => isContained(box, keeper));
    if (!isRedundant) {
      finalBoxes.push(box);
    }
  }

  finalBoxes.sort((a, b) => {
    const centerXA = (a[1] + a[3]) / 2;
    const centerXB = (b[1] + b[3]) / 2;
    if (Math.abs(centerXA - centerXB) > 150) {
      return centerXA - centerXB; 
    }
    return a[0] - b[0];
  });

  const img = await loadImage(sourceBuffer);

  const processedFragments = finalBoxes.map(box => {
    const [ymin, xmin, ymax, xmax] = box;
    const x = Math.max(0, (xmin / 1000) * originalWidth - SETTINGS.cropPadding);
    const y = Math.max(0, (ymin / 1000) * originalHeight - SETTINGS.cropPadding);
    
    const rawW = ((xmax - xmin) / 1000) * originalWidth + (SETTINGS.cropPadding * 2);
    const rawH = ((ymax - ymin) / 1000) * originalHeight + (SETTINGS.cropPadding * 2);

    const w = Math.min(originalWidth - x, rawW);
    const h = Math.min(originalHeight - y, rawH);
    
    const tempCanvas = createCanvas(Math.floor(w), Math.floor(h));
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(img, x, y, w, h, 0, 0, w, h);

    const trim = getTrimmedBounds(tempCtx, Math.floor(w), Math.floor(h));

    return {
      sourceCanvas: tempCanvas,
      trim: trim 
    };
  }).filter(f => f.trim.w > 0 && f.trim.h > 0);

  if (processedFragments.length === 0) return null;

  const maxFragmentWidth = Math.max(...processedFragments.map(f => f.trim.w));
  const finalWidth = maxFragmentWidth + SETTINGS.canvasPaddingLeft + SETTINGS.canvasPaddingRight;
  
  const gap = 10; // Matched with Frontend fragmentGap
  const totalContentHeight = processedFragments.reduce((acc, f) => acc + f.trim.h, 0) + (gap * (Math.max(0, processedFragments.length - 1)));
  const finalHeight = totalContentHeight + (SETTINGS.canvasPaddingY * 2);

  const canvas = createCanvas(finalWidth, finalHeight);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let currentY = SETTINGS.canvasPaddingY;
  processedFragments.forEach((f) => {
    const centerOffset = (maxFragmentWidth - f.trim.w) / 2;
    const offsetX = SETTINGS.canvasPaddingLeft + centerOffset;
    
    ctx.drawImage(
      f.sourceCanvas, 
      f.trim.x, f.trim.y, f.trim.w, f.trim.h, 
      offsetX, currentY, f.trim.w, f.trim.h   
    );
    currentY += f.trim.h + gap;
  });

  return canvas.toBuffer('image/jpeg', { quality: 0.95 });
}

async function processSinglePDF(inputFile, outputFile) {
  console.log(`\nProcessing: ${path.basename(inputFile)}`);
  try {
    const dataBuffer = await readFile(inputFile);
    const data = new Uint8Array(dataBuffer);
    
    const loadingTask = pdfjsLib.getDocument(data);
    const pdf = await loadingTask.promise;

    const zip = new JSZip();
    const folder = zip.folder("questions");
    const debugFolder = zip.folder("debug");

    for (let i = 1; i <= pdf.numPages; i++) {
      process.stdout.write(`  Page ${i}/${pdf.numPages}: Rendering... `);
      
      const page = await pdf.getPage(i);
      const { base64, buffer, width, height } = await renderPageToBuffer(page);

      // Save Raw Full Page Image
      debugFolder.file(`Page_${i}_Full.jpg`, buffer);

      process.stdout.write(`Detecting... `);
      const detections = await detectQuestions(base64);

      // Save Raw Gemini JSON
      debugFolder.file(`Page_${i}_Gemini.json`, JSON.stringify(detections, null, 2));

      process.stdout.write(`Found ${detections.length}. Cropping...\n`);

      for (const detection of detections) {
        const stitchedBuffer = await cropAndStitch(buffer, detection.boxes_2d, width, height);
        
        if (stitchedBuffer) {
           const filename = `P${i}_Q${detection.id}.jpg`;
           folder.file(filename, stitchedBuffer);

           if (SETTINGS.enableDetailedAnalysis && detection.markdown) {
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

    const zipContent = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await writeFile(outputFile, zipContent);
    console.log(`  ✅ Saved: ${outputFile}`);
  } catch (err) {
    console.error(`  ❌ Failed ${path.basename(inputFile)}: ${err.message}`);
  }
}

async function main() {
  try {
    const inputStats = await stat(inputPath);
    
    if (inputStats.isFile()) {
      // Single file mode
      let outPath = userOutputPath;
      if (!outPath) {
        const parsed = path.parse(inputPath);
        outPath = path.join(parsed.dir, `${parsed.name}.zip`);
      }
      await processSinglePDF(inputPath, outPath);

    } else if (inputStats.isDirectory()) {
      // Batch mode
      const outDir = userOutputPath || inputPath;
      // Ensure output directory exists
      try { await mkdir(outDir, { recursive: true }); } catch (e) {}

      const files = await readdir(inputPath);
      const pdfFiles = files.filter(f => f.toLowerCase().endsWith('.pdf'));
      
      console.log(`Found ${pdfFiles.length} PDF files in directory.`);
      
      const concurrency = parseInt(concurrencyArg || "10", 10);
      const queue = [...pdfFiles];
      let activeWorkers = 0;
      
      // Simple concurrency implementation
      const runNext = async () => {
        if (queue.length === 0) return;
        const file = queue.shift();
        activeWorkers++;
        
        const inFilePath = path.join(inputPath, file);
        const outFilePath = path.join(outDir, `${path.parse(file).name}.zip`);
        
        await processSinglePDF(inFilePath, outFilePath);
        
        activeWorkers--;
        await runNext();
      };

      const workers = [];
      for (let i = 0; i < Math.min(concurrency, pdfFiles.length); i++) {
        workers.push(runNext());
      }
      
      await Promise.all(workers);
      console.log("\nBatch processing complete.");
    }
  } catch (error) {
    console.error("Critical Error:", error);
    process.exit(1);
  }
}

main();
