import { GoogleGenAI, Type, Schema } from "@google/genai";
import { DetectedQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

export const detectQuestionsOnPage = async (
  base64Image: string, 
  enableDetailedAnalysis: boolean = false,
  modelId: string = 'gemini-3-pro-preview'
): Promise<DetectedQuestion[]> => {
  try {
    const basicPrompt = `分析这张高考数学试卷页面并提取题目。

严格目标：
1. **精确性**：边界划分要紧凑, 绝对要避免截到其他题目的文本。
2. **完整性（关键）**：务必确保题号完整包含在框内。特别是两位数题号，边界框的左侧（xmin）必须包含第一个数字，不要切掉。
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
   - 示例："设函数 $f(x) = x^2$"。
   - 不要尝试用文字描述复杂的几何图形，只需简单描述或忽略。
2. **tags**: 1-3 个关键词的数组（例如 ["函数", "导数", "立体几何"]）。
3. **type**: 属于 ["选择题", "填空题", "解答题", "其他"] 之一。
4. **difficulty**: 属于 ["简单", "中等", "困难"] 之一。
5. **analysis**: 对关键解题步骤和逻辑的简明分析。
6. **graphic_boxes_2d**: 仅识别题目内部图表/几何图形/图形的边界框。返回 [ymin, xmin, ymax, xmax] 的数组。

警告：启用此详细级别非常复杂。确保不要凭空捏造不存在的文本。优先保证边界框（Bounding Boxes）的准确性。
`;

    // Define Schemas
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
        markdown: { type: Type.STRING, description: "Question text with LaTeX math" },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        type: { type: Type.STRING },
        difficulty: { type: Type.STRING },
        analysis: { type: Type.STRING },
        graphic_boxes_2d: {
           type: Type.ARRAY,
           items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
           description: "Bounding boxes of specific diagrams inside the question"
        }
      },
      required: ["id", "boxes_2d", "markdown", "type", "analysis"]
    };

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
              text: enableDetailedAnalysis ? basicPrompt + detailedPrompt : basicPrompt
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: enableDetailedAnalysis ? detailedSchemaItems : basicSchemaItems
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