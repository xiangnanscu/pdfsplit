
import { GoogleGenAI, Type } from "@google/genai";
import { DetectedQuestion } from "../types";
import { PROMPTS, SCHEMAS, MODEL_IDS } from "../shared/ai-config.js";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Detects questions on a single image with automatic retry logic.
 * @param image Base64 image string (data:image/jpeg;base64,...)
 * @param modelId 
 * @param maxRetries
 */
export const detectQuestionsOnPage = async (
  image: string, 
  modelId: string = MODEL_IDS.PRO,
  maxRetries: number = 5
): Promise<DetectedQuestion[]> => {
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      const promptText = PROMPTS.BASIC;
      const itemsSchema = SCHEMAS.BASIC;

      const response = await ai.models.generateContent({
        model: modelId,
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: image.split(',')[1]
                }
              },
              { text: promptText }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: itemsSchema
          }
        }
      });

      const text = response.text;
      if (!text) throw new Error("Empty response from AI");
      
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Invalid response format: Expected Array");
      
      return parsed as DetectedQuestion[];
    } catch (error: any) {
      attempt++;
      const isRateLimit = error?.message?.includes('429') || error?.status === 429;
      const waitTime = isRateLimit ? Math.pow(2, attempt) * 1000 : 2000;
      
      console.warn(`Gemini detection attempt ${attempt} failed: ${error.message}. Retrying in ${waitTime}ms...`);
      
      if (attempt >= maxRetries) {
        throw new Error(`AI 识别在 ${maxRetries} 次重试后仍然失败: ${error.message}`);
      }
      
      await delay(waitTime);
    }
  }
  return [];
};
