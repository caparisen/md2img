import type { Catalog, FontItem } from "./catalog";

const CDN = "https://cdn.jsdelivr.net/fontsource/fonts";

const CJK_RANGE =
  "U+2E80-303F, U+3100-31EF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE30-FE4F, U+FF00-FFEF, U+20000-2FA1F";
const LATIN_RANGE =
  "U+0000-024F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+2100-214F, U+2190-21FF, U+2200-22FF, U+25A0-25FF, U+FFFD";

export function familyName(id: string): string {
  return `pf-${id}`;
}

function fontUrl(id: string, subset: string, weight: number): string {
  return `${CDN}/${id}@latest/${subset}-${weight}-normal.woff2`;
}

interface FaceSpec {
  key: string;
  family: string;
  url: string;
  weight: number;
  range: string;
}

function pickWeights(font: FontItem): number[] {
  if (!font.weights.length) return [400];
  const sorted = [...font.weights].sort((a, b) => a - b);
  const body = sorted.reduce((best, w) => (Math.abs(w - 400) < Math.abs(best - 400) ? w : best), sorted[0]);
  const bold = sorted.filter((w) => w >= 600).pop();
  const result = [body];
  if (bold !== undefined && bold !== body) result.push(bold);
  return result;
}

function faceSpecs(font: FontItem): FaceSpec[] {
  const specs: FaceSpec[] = [];
  const hasCjk = font.subsets.includes("chinese-simplified");
  for (const weight of pickWeights(font)) {
    if (hasCjk) {
      specs.push({
        key: `${font.id}:${weight}:cjk`,
        family: familyName(font.id),
        url: fontUrl(font.id, "chinese-simplified", weight),
        weight,
        range: CJK_RANGE,
      });
    }
    specs.push({
      key: `${font.id}:${weight}:latin`,
      family: familyName(font.id),
      url: fontUrl(font.id, "latin", weight),
      weight,
      range: LATIN_RANGE,
    });
  }
  return specs;
}

const loadedFaces = new Set<string>();
const pendingFaces = new Map<string, Promise<void>>();
const fontBuffers = new Map<string, ArrayBuffer>();

async function ensureFace(spec: FaceSpec): Promise<void> {
  if (loadedFaces.has(spec.key)) return;
  let pending = pendingFaces.get(spec.key);
  if (!pending) {
    const face = new FontFace(spec.family, `url("${spec.url}")`, {
      weight: String(spec.weight),
      style: "normal",
      unicodeRange: spec.range,
    });
    pending = face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        loadedFaces.add(spec.key);
      })
      .finally(() => {
        pendingFaces.delete(spec.key);
      });
    pendingFaces.set(spec.key, pending);
  }
  await pending;
}

export async function ensureFonts(catalog: Catalog, ids: string[]): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const id of ids) {
    const font = catalog.byId.get(id);
    if (!font) continue;
    for (const spec of faceSpecs(font)) jobs.push(ensureFace(spec));
  }
  await Promise.all(jobs);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const cached = fontBuffers.get(url);
  if (cached) return cached;
  const response = await fetch(url, { cache: "default" });
  if (!response.ok) throw new Error(`font file ${url} -> ${response.status}`);
  const buffer = await response.arrayBuffer();
  fontBuffers.set(url, buffer);
  return buffer;
}

/** 把当前字体栈实际用到的 woff2 转成 data URL 的 @font-face CSS，供导出时嵌入 SVG */
export async function buildFontEmbedCss(catalog: Catalog, orderedIds: string[]): Promise<string> {
  const rules: string[] = [];
  await Promise.all(
    orderedIds.map(async (id) => {
      const font = catalog.byId.get(id);
      if (!font) return;
      for (const spec of faceSpecs(font)) {
        const buffer = await fetchBuffer(spec.url);
        rules.push(
          `@font-face{font-family:"${spec.family}";src:url(data:font/woff2;base64,${toBase64(buffer)}) format("woff2");font-weight:${spec.weight};font-style:normal;unicode-range:${spec.range};}`,
        );
      }
    }),
  );
  return rules.join("");
}

export function fontFamilyStack(fontIds: string[]): string {
  const families = fontIds.map((id) => `"${familyName(id)}"`);
  return [...families, '"Microsoft YaHei"', '"PingFang SC"', "sans-serif"].join(", ");
}
