
import { Type } from "@google/genai";

export const MODEL_IDS = {
  FLASH: 'gemini-3-flash-preview',
  PRO: 'gemini-3-pro-preview'
};

export const PROMPTS = {
  BASIC: `分析这张数学试卷图片，试卷页面是三栏布局，它包含若干道题目，请精准识别每个题目的边界，以便后续裁剪。

一、识别规则：
0. 框图必须精准而紧凑，刚好能够包含题号和题目。注意题干使用的是悬挂缩进，不要把题号排除了。
1. 题号规则
   - 题号由阿拉伯数字后接一个英文句点构成，如 "13.", "14.", "15."。
   - 题号就是你输出结构的id，它只能是数字。
2. **排除标题区域**：
   - **严禁**将“一、选择题”、“二、填空题”等板块大标题或“本大题共XX分”的说明文字包含在题目的框内。
   - 题目的边界框应当**紧贴**该题的题号开始。
3. **框图必须包含所有关联内容**：
   - 选择题的选项（A,B,C,D）
   - 插图（几何图形、函数图象）
   - 子题：如 (1)、 (2)或者【甲】、【乙】这种字符开头的题。
4. **跨栏、跨页题目的判断**：
   - 如果一栏或一页的区域**没有**以题号开头（如 "13.", "14.", "15."），请把它标记为ID="continuation"。
5. **宽度固定**：
   - 所有题的boxes_2d的宽度应该相同，以最长的那个宽度为准。

二、输出结构（单框）：
[
  {
    "id": "题号字符串",
    "boxes_2d": [ymin, xmin, ymax, xmax]
  }
]

结构（多框）：
[
  {
    "id": "题号字符串",
    "boxes_2d": [ymin, xmin, ymax, xmax]
  },
  {
    "id": "continuation",
    "boxes_2d": [ymin, xmin, ymax, xmax]
  }
]
`,
  ANALYSIS: `# 角色
你是一个资深的高考数学真题解析专家，帮助考生在考场限定时间内获得尽可能高的分数，现在我给你提供了题目图片和知识点目录，请解析并返回包含有用信息的JSON数据。

# 解析原则
- 帮助学生通过做题来加深概念的理解，做到学懂弄通、举一反三。
- 帮助学生揣摩出题人的意图，让学生站在更高的维度思考问题。
- 注重揭示题目和基本概念之间的联系。
- 如果有，要明确指出易错点。
- 针对难题要明确指出突破口。
- 有时选择题和填空题可以通过代入法、排除法或超纲知识快速锁定正确答案，要优先讲解此类做法。

# 知识点目录 (Reference Only, select appropriate tags)
第一章 空间向量与立体几何 ... (Use standard Chinese Math Curriculum knowledge tree)
(Note: Full tree omitted for brevity, verify against standard High School Math curriculum)

# JSON Output Format
Strictly adhere to the Schema provided in the API call.
`
};

export const SCHEMAS = {
  BASIC: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "题号字符串，如 '1' 或 '13'。如果是跨栏或跨页内容则设为 'continuation'。"
      },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.NUMBER,
        },
        description: "该题目的边界框列表 [ymin, xmin, ymax, xmax] (0-1000)。"
      }
    },
    required: ["id", "boxes_2d"]
  },
  ANALYSIS: {
    type: Type.OBJECT,
    properties: {
      difficulty: { type: Type.INTEGER, description: "1-5, 5 is hardest" },
      question_type: { type: Type.STRING, description: "选择/填空/解答" },
      suggested_time: { type: Type.STRING, description: "e.g., '3分钟'" },
      tags: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
             level0: { type: Type.STRING },
             level1: { type: Type.STRING },
             level2: { type: Type.STRING },
             level3: { type: Type.STRING }
          },
          required: ["level0", "level1"]
        }
      },
      question_md: { type: Type.STRING, description: "Markdown text of question" },
      solution_md: { type: Type.STRING, description: "Step by step solution in Markdown/Latex" },
      analysis_md: { type: Type.STRING, description: "Source analysis and pitfalls" },
      pitfalls_md: { type: Type.STRING, description: "Common mistakes" }
    },
    required: ["difficulty", "question_type", "tags", "question_md", "solution_md", "analysis_md"]
  }
};