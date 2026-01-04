
import { Type } from "@google/genai";

export const MODEL_IDS = {
  FLASH: 'gemini-3-flash-preview',
  PRO: 'gemini-3-pro-preview'
};

export const PROMPTS = {
  BASIC: `分析这张数学试卷图片，精准识别并拆分每一道独立的题目。试卷页面的布局有可能是多栏，有可能是单栏。

**识别规则：**
1. **一个题号 = 一个独立 ID**：页面上每一个主题号（如 "13.", "14.", "15."）都必须对应一个独立的 JSON 对象。
   - 看到 "13"，开始记录 ID="13" 的框。
   - 一旦看到 "14"（或下一题的题号），必须**立刻**结束 ID="13" 的记录。
   - 严禁合并不同题号的题目
2. **排除和具体题目无关的区域**：
   - **严禁**将“一、选择题”、“二、填空题”、“三、解答题”等板块大标题或“本大题共XX分”的说明文字包含在题目的框内。
   - 题目的边界框应当**紧贴**该题的题号（如 "11."）开始，大标题应被视为背景噪音并忽略。
3. **包含子题**：题目内部的子问题（如 (1), (2)或选项（A,B,C,D）属于当前主题号。
4. **跨栏**：如果一道题占据了左右两栏，可以给它分配多个框（boxes_2d），但这些框必须都属于同一题。
5. **跨页**：只有当页面最顶端的内容明显是上一页题目的结尾（且没有新题号）时，才标记为 ID="continuation"。

**输出要求**：
1. 请列出页面上出现的所有题目编号。例如页面上有 13, 14, 15, 16, 17, 18 六道题，JSON 数组长度应为 6。
2. boxes_2d的成员数应尽可能地少，这至少意味着：当一道题既没有跨栏也没有跨页的时候，boxes_2d成员数应为1. 如果出现了跨栏或跨页，按常理2个框即可（不会有题干超过一栏或一页的题）。

结构：
{
  "id": "题号字符串",
  "boxes_2d": [ [ymin, xmin, ymax, xmax], ... ]
}

`
};

export const SCHEMAS = {
  BASIC: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "The distinct question number (e.g. '13', '14'). Do NOT group multiple questions."
      },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER }
        },
        description: "Bounding boxes [ymin, xmin, ymax, xmax] (0-1000) for THIS question only. Exclude section headers."
      }
    },
    required: ["id", "boxes_2d"]
  }
};