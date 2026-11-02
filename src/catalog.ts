import type { CatalogRaw, RegistryFamily, Taxonomy } from "./cache";

export interface FontItem {
  id: string;
  family: string;
  subsets: string[];
  weights: number[];
  variable: boolean;
  cls: string[];
  tags: string[];
  tagLabels: string[];
  hay: string;
}

export interface Catalog {
  taxonomy: Taxonomy;
  fonts: FontItem[];
  byId: Map<string, FontItem>;
  clsLabel: Record<string, string>;
  tagLabel: Record<string, string>;
}

export interface Filters {
  q: string;
  cls: Set<string>;
  tags: Set<string>;
  cjk: boolean;
  bold: boolean;
  variable: boolean;
  tagGroup: string;
}

export function createFilters(): Filters {
  return {
    q: "",
    cls: new Set(),
    tags: new Set(),
    cjk: false,
    bold: false,
    variable: false,
    tagGroup: "sans",
  };
}

export function buildCatalog(raw: CatalogRaw): Catalog {
  const regById = new Map<string, RegistryFamily>();
  for (const family of raw.families) regById.set(family.id, family);

  const clsLabel: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.taxonomy.classifications)) {
    clsLabel[key] = value.label;
  }
  const tagLabel: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.taxonomy.tags)) {
    tagLabel[key] = value.label;
  }

  const fonts: FontItem[] = raw.fonts.map((font) => {
    const reg = regById.get(font.id);
    const tags = reg?.tags ?? [];
    const clsSet = new Set<string>(reg?.classifications ?? []);
    if (font.category) clsSet.add(font.category);
    const cls = [...clsSet];
    const tagLabels = tags.map((tag) => tagLabel[tag] ?? tag);
    const clsHay = cls.map((key) => `${clsLabel[key] ?? key} ${key}`).join(" ");
    const hay = `${font.family} ${font.id} ${clsHay} ${tags.join(" ")} ${tagLabels.join(" ")}`.toLowerCase();
    return {
      id: font.id,
      family: font.family,
      subsets: font.subsets ?? [],
      weights: font.weights ?? [],
      variable: Boolean(font.variable),
      cls,
      tags,
      tagLabels,
      hay,
    };
  });

  fonts.sort((a, b) => (a.family.toLowerCase() < b.family.toLowerCase() ? -1 : 1));

  const byId = new Map<string, FontItem>();
  for (const font of fonts) byId.set(font.id, font);

  return { taxonomy: raw.taxonomy, fonts, byId, clsLabel, tagLabel };
}

export function filterFonts(catalog: Catalog, filters: Filters): FontItem[] {
  const tokens = filters.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const clsKeys = [...filters.cls];
  const tagKeys = [...filters.tags];

  return catalog.fonts.filter((font) => {
    for (const token of tokens) {
      if (!font.hay.includes(token)) return false;
    }
    if (clsKeys.length && !clsKeys.some((key) => font.cls.includes(key))) return false;
    if (tagKeys.length && !tagKeys.some((key) => font.tags.includes(key))) return false;
    if (filters.cjk && !font.subsets.includes("chinese-simplified")) return false;
    if (filters.bold && !font.weights.includes(700)) return false;
    if (filters.variable && !font.variable) return false;
    return true;
  });
}

export function hasChinese(font: FontItem): boolean {
  return font.subsets.includes("chinese-simplified");
}

export function hasBold(font: FontItem): boolean {
  return font.weights.includes(700);
}

/** 有没有中文字形 */
export function stackHasChinese(catalog: Catalog, ids: string[]): boolean {
  return ids.some((id) => {
    const font = catalog.byId.get(id);
    return !font || hasChinese(font);
  });
}

export function stackHasBold(catalog: Catalog, ids: string[]): boolean {
  return ids.some((id) => {
    const font = catalog.byId.get(id);
    return !font || hasBold(font);
  });
}

/**
 * 生效顺序：无中文字形的字体排前面（负责西文），中文字体兜底；同类内保持选择顺序。
 */
export function effectiveOrder(catalog: Catalog, ids: string[]): string[] {
  const latin: string[] = [];
  const cjk: string[] = [];
  for (const id of ids) {
    const font = catalog.byId.get(id);
    if (font && hasChinese(font)) cjk.push(id);
    else latin.push(id);
  }
  return [...latin, ...cjk];
}
