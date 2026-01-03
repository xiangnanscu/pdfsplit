
export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export interface DetectedQuestion {
  id: string;
  boxes_2d: [number, number, number, number][]; // Array of [ymin, xmin, ymax, xmax]
}

export interface QuestionImage {
  id: string;
  pageNumber: number;
  dataUrl: string;
  originalDataUrl?: string; // Used for "Before/After" comparison if trimming occurred
}

export interface DebugPageData {
  pageNumber: number;
  dataUrl: string; // The full page image
  width: number;
  height: number;
  detections: DetectedQuestion[]; // Raw coordinates from Gemini
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  LOADING_PDF = 'LOADING_PDF',
  DETECTING_QUESTIONS = 'DETECTING_QUESTIONS',
  CROPPING = 'CROPPING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}