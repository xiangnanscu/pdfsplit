
import { Type } from "@google/genai";

export const MODEL_IDS = {
  FLASH: 'gemini-3-flash-preview',
  PRO: 'gemini-3-pro-preview'
};

export const PROMPTS = {
  BASIC: `分析这张数学试卷图片，精准识别并拆分每一道独立的题目。试卷页面的布局有可能是多栏（分栏），有可能是单栏。

**核心识别规则：**
1. **一个题号 = 一个独立 ID**：页面上每一个主题号（如 "13.", "14.", "15."）都必须对应一个独立的 JSON 对象。
   - 题号通常是阿拉伯数字后跟一个小圆点或括号。
   - 严禁合并不同题号的题目。
2. **排除标题区域**：
   - **严禁**将“一、选择题”、“二、填空题”等板块大标题或“本大题共XX分”的说明文字包含在题目的框内。
   - 题目的边界框应当**紧贴**该题的题号开始。
3. **包含所有关联内容**：
   - 题目内部的子问题（如 (1), (2)）、插图（几何图形、函数图象）以及选项（A,B,C,D）必须完整包含在框内。
4. **跨栏处理**：
   - 如果一道题占据了左右两栏（通常是左栏底部到右栏顶部），请为该题提供多个框（boxes_2d），顺序为内容阅读顺序。
5. **跨页标记**：
   - 如果页面最顶端的内容明显是上一页某道题的未完部分（没有新题号），请将其标记为 ID="continuation"。

**输出要求**：
- 仅返回 JSON 数组，包含 detected items。
- boxes_2d 使用归一化坐标 [ymin, xmin, ymax, xmax] (0-1000)。
- 如果是单栏普通题目，boxes_2d 应仅包含一个框。

结构示例：
{
  "id": "13",
  "boxes_2d": [ [ymin, xmin, ymax, xmax] ]
}
`
};

export const SCHEMAS = {
  BASIC: {
    type: Type.OBJECT,
    properties: {
      id: {
        type: Type.STRING,
        description: "题号字符串，如 '1' 或 '13'。如果是跨页承接内容则设为 'continuation'。"
      },
      boxes_2d: {
        type: Type.ARRAY,
        items: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER }
        },
        description: "该题目的边界框列表 [ymin, xmin, ymax, xmax] (0-1000)。"
      }
    },
    required: ["id", "boxes_2d"]
  }
};
