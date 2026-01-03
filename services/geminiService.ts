
import { GoogleGenAI, Type } from "@google/genai";
import { DetectedQuestion } from "../types";
import { PROMPTS, SCHEMAS, MODEL_IDS } from "../shared/ai-config.js";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const detectQuestionsOnPage = async (
  base64Image: string, 
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
                data: base64Image.split(',')[1]
              }
            },
            {
              text: promptText
            }
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