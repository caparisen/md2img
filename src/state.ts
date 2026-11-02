export interface Preset {
  label: string;
  w: number;
  fs: number;
}

export const PRESETS: Record<string, Preset> = {
  "wechat-iphone": { label: "微信缩略图", w: 1080, fs: 72 },
  "wechat-large": { label: "微信大字版", w: 1080, fs: 96 },
  "hd-long": { label: "高清长图", w: 1440, fs: 96 },
};

export const PRESET_CUSTOM = "custom";

export const LIMITS = {
  wMin: 240,
  wMax: 4320,
  fsMin: 12,
  fsMax: 240,
};

export const DEFAULT_FONT_IDS = ["noto-sans-sc"];

export interface AppState {
  preset: string;
  w: number;
  fs: number;
  fontIds: string[];
}

export const DEFAULT_STATE: AppState = {
  preset: "wechat-iphone",
  w: PRESETS["wechat-iphone"].w,
  fs: PRESETS["wechat-iphone"].fs,
  fontIds: [...DEFAULT_FONT_IDS],
};

export const DEFAULT_MARKDOWN = `# 微信里不点开也能看清

高度由内容决定，宽度和字号是参数。这个 preset 的宽度是 1080 px、正文 72 px，一行大约十三个汉字。

缩略图里能读多大字，取决于 **宽度 ÷ 每行字数**，跟图片总分辨率无关。

## 支持的排版

- 标题、**加粗**、*斜体*
- 列表、引用、表格、代码

> 图片负责版式，文字负责点击。

行内代码 \`const x = 1\`，链接 https://example.com 。

\`\`\`bash
npm run build
# 输出到 dist
\`\`\`

## 参数

| 参数 | 取值 |
| --- | --- |
| 宽度 | 1080 px |
| 字号 | 72 px |
| 字体 | Noto Sans SC |

正文到这里结束，下面的高度由内容自动撑开。`;

export function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
