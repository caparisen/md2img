import {
  DEFAULT_FONT_IDS,
  DEFAULT_STATE,
  LIMITS,
  PRESET_CUSTOM,
  PRESETS,
  clampInt,
  type AppState,
} from "./state";

const FONT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function parseFontIds(raw: string | null): string[] {
  if (!raw) return [...DEFAULT_FONT_IDS];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!id || seen.has(id) || !FONT_ID_RE.test(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.length ? ids : [...DEFAULT_FONT_IDS];
}

export function parseState(search: string): AppState {
  const params = new URLSearchParams(search);

  const rawPreset = params.get("preset") ?? "";
  let preset = DEFAULT_STATE.preset;
  if (rawPreset === PRESET_CUSTOM) preset = PRESET_CUSTOM;
  else if (rawPreset && rawPreset in PRESETS) preset = rawPreset;

  const rawW = Number(params.get("w"));
  const rawFs = Number(params.get("fs"));
  const w = Number.isFinite(rawW) && rawW > 0
    ? clampInt(rawW, LIMITS.wMin, LIMITS.wMax)
    : DEFAULT_STATE.w;
  const fs = Number.isFinite(rawFs) && rawFs > 0
    ? clampInt(rawFs, LIMITS.fsMin, LIMITS.fsMax)
    : DEFAULT_STATE.fs;

  return { preset, w, fs, fontIds: parseFontIds(params.get("font")) };
}

export function serializeState(state: AppState): string {
  const params = new URLSearchParams();
  params.set("preset", state.preset);
  params.set("w", String(state.w));
  params.set("fs", String(state.fs));
  params.set("font", state.fontIds.join(","));
  return `?${params.toString()}`;
}

export function urlFor(state: AppState): string {
  return `${location.pathname}${serializeState(state)}`;
}

/** 用 replaceState 规范化当前地址，不新增历史记录 */
export function replaceUrl(state: AppState): void {
  history.replaceState(null, "", urlFor(state));
}

/** 新增一条历史记录，用于浏览器后退撤销参数修改 */
export function pushUrl(state: AppState): void {
  history.pushState(null, "", urlFor(state));
}

export function currentUrl(state: AppState): string {
  return `${location.origin}${urlFor(state)}`;
}
