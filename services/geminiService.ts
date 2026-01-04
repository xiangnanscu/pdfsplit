
import { GoogleGenAI, Type } from "@google/genai";
import { DetectedQuestion } from "../types";
import { PROMPTS, SCHEMAS, MODEL_IDS } from "../shared/ai-config.js";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

/**
 * Detects questions on a single image.
 * @param image Base64 image string (data:image/jpeg;base64,...)
 * @param modelId 
 */
export const detectQuestionsOnPage = async (
  image: string, 
  modelId: string = MODEL_IDS.PRO
): Promise<DetectedQuestion[]> => {
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
    if (!text) return [];
    
    return JSON.parse(text) as DetectedQuestion[];
  } catch (error) {
    console.error("Gemini Detection Error:", error);
    throw error;
  }
};