import "./styles.css";
import { loadCatalog, refreshStale, type CatalogRaw } from "./cache";
import {
  buildCatalog,
  createFilters,
  effectiveOrder,
  filterFonts,
  stackHasBold,
  stackHasChinese,
  type Catalog,
  type Filters,
  type FontItem,
} from "./catalog";
import { buildFontEmbedCss, ensureFonts, fontFamilyStack } from "./fonts";
import { renderMarkdown } from "./render";
import { copyPngToClipboard, downloadBlob, pngFilename, renderPngBlob } from "./export";
import {
  DEFAULT_FONT_IDS,
  DEFAULT_MARKDOWN,
  LIMITS,
  PRESETS,
  PRESET_CUSTOM,
  clampInt,
  type AppState,
} from "./state";
import { currentUrl, parseState, pushUrl, replaceUrl, serializeState } from "./url";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
};

const refs = {
  preset: $<HTMLSelectElement>("preset"),
  width: $<HTMLInputElement>("width"),
  fontsize: $<HTMLInputElement>("fontsize"),
  fontBtnTop: $<HTMLButtonElement>("fontBtnTop"),
  fontNameTop: $("fontNameTop"),
  exportBtn: $<HTMLButtonElement>("exportBtn"),
  copyPngBtn: $<HTMLButtonElement>("copyPngBtn"),
  mdInput: $<HTMLTextAreaElement>("mdInput"),
  metrics: $("metrics"),
  cjkWarn: $("cjkWarn"),
  stageScroll: $("stageScroll"),
  canvasScaler: $("canvasScaler"),
  canvasWrap: $("canvasWrap"),
  canvas: $("canvas"),
  urlOut: $<HTMLInputElement>("urlOut"),
  copyBtn: $<HTMLButtonElement>("copyBtn"),
  tabEditor: $<HTMLButtonElement>("tabEditor"),
  tabPreview: $<HTMLButtonElement>("tabPreview"),
  openParams: $<HTMLButtonElement>("openParams"),
  paramsSheet: $("paramsSheet"),
  paramsClose: $<HTMLButtonElement>("paramsClose"),
  widthM: $<HTMLInputElement>("widthM"),
  fontsizeM: $<HTMLInputElement>("fontsizeM"),
  wMinus: $<HTMLButtonElement>("wMinus"),
  wPlus: $<HTMLButtonElement>("wPlus"),
  fsMinus: $<HTMLButtonElement>("fsMinus"),
  fsPlus: $<HTMLButtonElement>("fsPlus"),
  fontBtnM: $<HTMLButtonElement>("fontBtnM"),
  fontNameM: $("fontNameM"),
  urlOutM: $<HTMLInputElement>("urlOutM"),
  copyBtnM: $<HTMLButtonElement>("copyBtnM"),
  presetChips: $("presetChips"),
  scrim: $("scrim"),
  editorPane: $("editorPane"),
  stagePane: $("stagePane"),
  fontPanel: $("fontPanel"),
  fontClose: $<HTMLButtonElement>("fontClose"),
  fontCount: $("fontCount"),
  fontSummary: $("fontSummary"),
  fontSearch: $<HTMLInputElement>("fontSearch"),
  clsChips: $("clsChips"),
  groupTabs: $("groupTabs"),
  tagChips: $("tagChips"),
  flagChips: $("flagChips"),
  clearFilters: $<HTMLButtonElement>("clearFilters"),
  selectedBar: $("selectedBar"),
  fontScroll: $("fontScroll"),
  fontSpacer: $("fontSpacer"),
  toast: $("toast"),
};

const ROW_HEIGHT = 56;

let catalog: Catalog | null = null;
let state: AppState = parseState(location.search);
const filters: Filters = createFilters();
let current: FontItem[] = [];
let urlTimer: number | undefined;
let markdownTimer: number | undefined;
let scrollRaf = 0;
let pngBusy = false;
let embedCssCache: { key: string; css: string } | null = null;

// ---------- 小工具 ----------
function toast(message: string): void {
  refs.toast.textContent = message;
  refs.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => refs.toast.classList.remove("show"), 1600);
}
let toastTimer: number | undefined;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function orderedFontIds(): string[] {
  return catalog ? effectiveOrder(catalog, state.fontIds) : state.fontIds;
}

const FALLBACK_LABELS: Record<string, string> = {
  "noto-sans-sc": "Noto Sans SC",
  "noto-serif-sc": "Noto Serif SC",
};

function fontLabel(id: string): string {
  return catalog?.byId.get(id)?.family ?? FALLBACK_LABELS[id] ?? id;
}

function fontStackLabel(): string {
  return orderedFontIds().map(fontLabel).join(" + ");
}

function applyStyle(): void {
  const ordered = orderedFontIds();
  refs.canvas.style.width = `${state.w}px`;
  refs.canvas.style.fontSize = `${state.fs}px`;
  refs.canvas.style.fontFamily = fontFamilyStack(ordered);
  const hasCjk = catalog ? stackHasChinese(catalog, state.fontIds) : true;
  const hasBold = catalog ? stackHasBold(catalog, state.fontIds) : true;
  refs.canvas.classList.toggle("no-bold", !hasBold);
  refs.cjkWarn.hidden = hasCjk;
  fit();
}

function fit(): void {
  const pad = window.innerWidth <= 820 ? 24 : 56;
  const avail = Math.max(120, refs.stageScroll.clientWidth - pad);
  const scale = Math.min(1, avail / state.w);
  refs.canvasWrap.style.width = `${state.w}px`;
  refs.canvasWrap.style.transform = `scale(${scale})`;
  const height = refs.canvas.offsetHeight;
  refs.canvasScaler.style.width = `${Math.round(state.w * scale)}px`;
  refs.canvasScaler.style.height = `${Math.round(height * scale)}px`;
  refs.metrics.textContent = `Output ${state.w} × ${height} px · Preview ${Math.round(scale * 100)}%`;
}

function updateUrlUi(): void {
  refs.urlOut.value = currentUrl(state);
  refs.urlOutM.value = serializeState(state);
}

function syncInputs(): void {
  if (refs.width.value !== String(state.w)) refs.width.value = String(state.w);
  if (refs.widthM.value !== String(state.w)) refs.widthM.value = String(state.w);
  if (refs.fontsize.value !== String(state.fs)) refs.fontsize.value = String(state.fs);
  if (refs.fontsizeM.value !== String(state.fs)) refs.fontsizeM.value = String(state.fs);
  refs.preset.value = state.preset;
  for (const chip of Array.from(refs.presetChips.children)) {
    chip.classList.toggle("on", (chip as HTMLElement).dataset.preset === state.preset);
  }
}

function updateFontButtons(): void {
  const label = fontStackLabel();
  refs.fontNameTop.textContent = label;
  refs.fontNameM.textContent = label;
  refs.fontBtnTop.title = label;
  refs.fontBtnM.title = label;
  renderSelectedBar();
}

function applyState(): void {
  applyStyle();
  syncInputs();
  updateFontButtons();
  updateUrlUi();
}

function scheduleUrl(): void {
  window.clearTimeout(urlTimer);
  urlTimer = window.setTimeout(() => {
    if (location.search !== serializeState(state)) pushUrl(state);
  }, 400);
}

function loadStackFonts(): Promise<void> {
  if (!catalog) return Promise.resolve();
  return ensureFonts(catalog, orderedFontIds()).catch((error: unknown) => {
    console.warn("font load failed", error);
  });
}

function finishChange(): void {
  applyState();
  scheduleUrl();
}

function setWidth(value: number): void {
  const next = clampInt(value, LIMITS.wMin, LIMITS.wMax);
  if (next === state.w) return;
  state.w = next;
  state.preset = PRESET_CUSTOM;
  finishChange();
}

function setFontSize(value: number): void {
  const next = clampInt(value, LIMITS.fsMin, LIMITS.fsMax);
  if (next === state.fs) return;
  state.fs = next;
  state.preset = PRESET_CUSTOM;
  finishChange();
}

function setPreset(name: string): void {
  if (name === PRESET_CUSTOM) {
    state.preset = PRESET_CUSTOM;
    finishChange();
    return;
  }
  const preset = PRESETS[name];
  if (!preset) return;
  state.preset = name;
  state.w = preset.w;
  state.fs = preset.fs;
  finishChange();
}

function setFontIds(ids: string[]): void {
  state.fontIds = ids;
  updateFontButtons();
  drawRows();
  updateCounts();
  applyStyle();
  scheduleUrl();
  void loadStackFonts().then(applyStyle);
}

// ---------- markdown ----------
function renderCanvas(): void {
  renderMarkdown(refs.canvas, refs.mdInput.value);
  fit();
}

function scheduleMarkdown(): void {
  window.clearTimeout(markdownTimer);
  markdownTimer = window.setTimeout(renderCanvas, 120);
}

// ---------- preset UI ----------
function buildPresetUi(): void {
  refs.preset.innerHTML = "";
  for (const [key, preset] of Object.entries(PRESETS)) {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = preset.label;
    refs.preset.appendChild(option);
  }
  const customOption = document.createElement("option");
  customOption.value = PRESET_CUSTOM;
  customOption.textContent = "Custom";
  refs.preset.appendChild(customOption);

  refs.presetChips.innerHTML = "";
  for (const [key, preset] of Object.entries(PRESETS)) {
    const chip = el("button", "chip", preset.label);
    chip.type = "button";
    chip.dataset.preset = key;
    chip.title = "Preset sets width and text size; fonts are kept";
    chip.addEventListener("click", () => setPreset(key));
    refs.presetChips.appendChild(chip);
  }
  const customChip = el("button", "chip", "Custom");
  customChip.type = "button";
  customChip.dataset.preset = PRESET_CUSTOM;
  customChip.addEventListener("click", () => setPreset(PRESET_CUSTOM));
  refs.presetChips.appendChild(customChip);
}

// ---------- 字体目录 ----------
function validateFontIds(): void {
  if (!catalog) return;
  const known = state.fontIds.filter((id) => catalog?.byId.has(id));
  if (known.length) {
    state.fontIds = known;
    return;
  }
  const defaults = DEFAULT_FONT_IDS.filter((id) => catalog?.byId.has(id));
  state.fontIds = defaults.length ? defaults : [catalog.fonts[0]?.id ?? DEFAULT_FONT_IDS[0]];
}

function applyCatalog(raw: CatalogRaw): void {
  catalog = buildCatalog(raw);
  validateFontIds();
  buildFontChips();
  applyFilters();
  updateFontButtons();
  applyState();
  replaceUrl(state);
  void loadStackFonts()
    .then(applyStyle)
    .then(() => {
      requestIdle(() => {
        void getEmbedCss().catch(() => undefined);
      });
    });
}

function requestIdle(callback: () => void): void {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(callback, { timeout: 5000 });
  } else {
    window.setTimeout(callback, 1500);
  }
}

function showCatalogError(error: unknown): void {
  console.error(error);
  refs.fontSummary.textContent = "Font catalog failed to load";
  refs.fontSpacer.innerHTML = "";
  refs.fontSpacer.appendChild(
    el("div", "font-error", "Could not load the font catalog from api.fontsource.org. Check your network and reload the page."),
  );
  refs.clearFilters.hidden = true;
}

// ---------- 字体筛选 chips ----------
function buildFontChips(): void {
  if (!catalog) return;
  const taxonomy = catalog.taxonomy;

  refs.clsChips.innerHTML = "";
  for (const [key, entry] of Object.entries(taxonomy.classifications)) {
    const chip = el("button", "chip", entry.label);
    chip.type = "button";
    chip.classList.toggle("on", filters.cls.has(key));
    chip.addEventListener("click", () => {
      if (filters.cls.has(key)) filters.cls.delete(key);
      else filters.cls.add(key);
      chip.classList.toggle("on", filters.cls.has(key));
      applyFilters();
    });
    refs.clsChips.appendChild(chip);
  }

  refs.flagChips.innerHTML = "";
  const flags: Array<[keyof Pick<Filters, "cjk" | "bold" | "variable">, string]> = [
    ["cjk", "Chinese"],
    ["bold", "Bold"],
    ["variable", "Variable"],
  ];
  for (const [key, label] of flags) {
    const chip = el("button", "chip", label);
    chip.type = "button";
    chip.classList.toggle("on", filters[key]);
    chip.addEventListener("click", () => {
      filters[key] = !filters[key];
      chip.classList.toggle("on", filters[key]);
      applyFilters();
    });
    refs.flagChips.appendChild(chip);
  }

  renderTagSection();
  refs.clearFilters.onclick = clearFilters;
}

function renderTagSection(): void {
  if (!catalog) return;
  const taxonomy = catalog.taxonomy;

  refs.groupTabs.innerHTML = "";
  for (const [key, entry] of Object.entries(taxonomy.tagGroups)) {
    const chip = el("button", "chip group", entry.label);
    chip.type = "button";
    chip.classList.toggle("on", filters.tagGroup === key);
    chip.addEventListener("click", () => {
      filters.tagGroup = key;
      renderTagSection();
    });
    refs.groupTabs.appendChild(chip);
  }

  refs.tagChips.innerHTML = "";
  for (const [key, entry] of Object.entries(taxonomy.tags)) {
    if (key.split("/")[0] !== filters.tagGroup) continue;
    const chip = el("button", "chip", entry.label);
    chip.type = "button";
    chip.classList.toggle("on", filters.tags.has(key));
    chip.addEventListener("click", () => {
      if (filters.tags.has(key)) filters.tags.delete(key);
      else filters.tags.add(key);
      chip.classList.toggle("on", filters.tags.has(key));
      applyFilters();
    });
    refs.tagChips.appendChild(chip);
  }
}

function clearFilters(): void {
  filters.q = "";
  refs.fontSearch.value = "";
  filters.cls.clear();
  filters.tags.clear();
  filters.cjk = false;
  filters.bold = false;
  filters.variable = false;
  buildFontChips();
  applyFilters();
}

function applyFilters(): void {
  if (!catalog) return;
  current = filterFonts(catalog, filters);
  refs.fontSpacer.style.height = `${current.length * ROW_HEIGHT}px`;
  refs.fontScroll.scrollTop = 0;
  updateCounts();
  drawRows();
}

function updateCounts(): void {
  const active =
    Boolean(filters.q.trim()) ||
    filters.cls.size > 0 ||
    filters.tags.size > 0 ||
    filters.cjk ||
    filters.bold ||
    filters.variable;
  refs.clearFilters.hidden = !active;
  if (catalog) {
    refs.fontSummary.textContent = `${current.length} / ${catalog.fonts.length} fonts`;
  }
  refs.fontCount.textContent = `${current.length} fonts · ${state.fontIds.length} selected`;
}

// ---------- 字体列表（虚拟滚动） ----------
function drawRows(): void {
  if (!catalog) return;
  const scroll = refs.fontScroll;
  const spacer = refs.fontSpacer;
  const start = Math.max(0, Math.floor(scroll.scrollTop / ROW_HEIGHT) - 4);
  const end = Math.min(current.length, Math.ceil((scroll.scrollTop + (scroll.clientHeight || 600)) / ROW_HEIGHT) + 4);
  spacer.innerHTML = "";
  if (!current.length) {
    spacer.appendChild(el("div", "font-empty", "No matching fonts."));
    return;
  }
  for (let index = start; index < end; index += 1) {
    const font = current[index];
    if (!font) continue;
    const row = el("div", "font-row");
    row.style.top = `${index * ROW_HEIGHT}px`;
    const selected = state.fontIds.includes(font.id);
    row.setAttribute("aria-selected", selected ? "true" : "false");
    row.appendChild(el("span", "fname", font.family));
    const meta = el("span", "meta");
    if (selected) meta.appendChild(el("span", "tag sel", "Selected"));
    if (font.tags.includes("sans/grotesque")) meta.appendChild(el("span", "tag", "grotesque"));
    if (font.subsets.includes("chinese-simplified")) meta.appendChild(el("span", "tag cjk", "Chinese"));
    if (font.weights.includes(700)) meta.appendChild(el("span", "tag bold", "bold"));
    row.appendChild(meta);
    row.addEventListener("click", () => toggleFont(font.id));
    spacer.appendChild(row);
  }
}

function toggleFont(id: string): void {
  if (state.fontIds.includes(id)) {
    if (state.fontIds.length <= 1) {
      toast("At least one font is required");
      return;
    }
    setFontIds(state.fontIds.filter((item) => item !== id));
  } else {
    setFontIds([...state.fontIds, id]);
  }
}

function renderSelectedBar(): void {
  const bar = refs.selectedBar;
  bar.innerHTML = "";
  bar.appendChild(el("span", "sel-label", "Selected"));
  orderedFontIds().forEach((id, index) => {
    const chip = el("span", "sel-chip");
    chip.appendChild(el("span", "idx", String(index + 1)));
    chip.appendChild(document.createTextNode(fontLabel(id)));
    const remove = el("button", "", "×");
    remove.type = "button";
    remove.title = "Remove";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFont(id);
    });
    chip.appendChild(remove);
    bar.appendChild(chip);
  });
}

// ---------- 浮层 ----------
function openSheet(node: HTMLElement): void {
  node.classList.add("open");
  refs.scrim.classList.add("open");
}

function closeSheet(node: HTMLElement): void {
  node.classList.remove("open");
  if (!refs.paramsSheet.classList.contains("open") && !refs.fontPanel.classList.contains("open")) {
    refs.scrim.classList.remove("open");
  }
}

function openFontPanel(): void {
  openSheet(refs.fontPanel);
  drawRows();
  if (window.innerWidth > 820) {
    const rect = refs.fontBtnTop.getBoundingClientRect();
    const panelRect = { width: 460, height: 640 };
    const left = Math.min(rect.right - panelRect.width, window.innerWidth - panelRect.width - 16);
    const top = Math.min(rect.bottom + 8, window.innerHeight - panelRect.height - 16);
    refs.fontPanel.style.left = `${Math.max(12, left)}px`;
    refs.fontPanel.style.top = `${Math.max(12, top)}px`;
    refs.fontPanel.style.width = `${panelRect.width}px`;
    refs.fontPanel.style.height = `${Math.min(panelRect.height, window.innerHeight - 24)}px`;
  } else {
    refs.fontSearch.focus();
  }
}

function closeFontPanel(): void {
  closeSheet(refs.fontPanel);
}

function closeAllSheets(): void {
  closeSheet(refs.fontPanel);
  closeSheet(refs.paramsSheet);
}

function showTab(which: "editor" | "stage"): void {
  if (which === "editor") {
    refs.editorPane.removeAttribute("hidden");
    refs.stagePane.setAttribute("hidden", "");
    refs.tabEditor.classList.add("active");
    refs.tabPreview.classList.remove("active");
  } else {
    refs.stagePane.removeAttribute("hidden");
    refs.editorPane.setAttribute("hidden", "");
    refs.tabPreview.classList.add("active");
    refs.tabEditor.classList.remove("active");
    window.setTimeout(fit, 0);
  }
}

// ---------- 导出 / 复制 ----------
async function getEmbedCss(): Promise<string> {
  if (!catalog) return "";
  const ids = orderedFontIds();
  const key = ids.join(",");
  if (embedCssCache && embedCssCache.key === key) return embedCssCache.css;
  const css = await buildFontEmbedCss(catalog, ids);
  embedCssCache = { key, css };
  return css;
}

async function runPngTask(
  kind: "export" | "copy",
  task: (embedCss: string, height: number) => Promise<void>,
): Promise<void> {
  if (pngBusy) return;
  pngBusy = true;
  refs.exportBtn.disabled = true;
  refs.copyPngBtn.disabled = true;
  if (kind === "export") refs.exportBtn.textContent = "Exporting…";
  else refs.copyPngBtn.textContent = "Copying…";
  try {
    await loadStackFonts();
    const embedCss = await getEmbedCss();
    await task(embedCss, refs.canvas.offsetHeight);
  } catch (error) {
    console.error(error);
    toast(kind === "copy" ? "Copy failed — use Export PNG" : "Export failed, try again");
  } finally {
    pngBusy = false;
    refs.exportBtn.disabled = false;
    refs.copyPngBtn.disabled = false;
    refs.exportBtn.textContent = "Export PNG";
    refs.copyPngBtn.textContent = "Copy PNG";
  }
}

function onExport(): void {
  void runPngTask("export", async (embedCss, height) => {
    const blob = await renderPngBlob({ node: refs.canvas, fontEmbedCss: embedCss });
    downloadBlob(blob, pngFilename(state.w, height));
  });
}

function onCopyPng(): void {
  void runPngTask("copy", async (embedCss) => {
    await copyPngToClipboard({ node: refs.canvas, fontEmbedCss: embedCss });
    toast("PNG copied to clipboard");
  });
}

async function copyShareUrl(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentUrl(state));
    toast("Link copied");
  } catch {
    toast("Copy failed — copy the address bar manually");
  }
}

// ---------- 事件 ----------
function bindEvents(): void {
  refs.preset.addEventListener("change", () => setPreset(refs.preset.value));
  refs.width.addEventListener("input", () => setWidth(Number(refs.width.value)));
  refs.fontsize.addEventListener("input", () => setFontSize(Number(refs.fontsize.value)));
  refs.widthM.addEventListener("input", () => setWidth(Number(refs.widthM.value)));
  refs.fontsizeM.addEventListener("input", () => setFontSize(Number(refs.fontsizeM.value)));
  refs.wMinus.addEventListener("click", () => setWidth(state.w - 100));
  refs.wPlus.addEventListener("click", () => setWidth(state.w + 100));
  refs.fsMinus.addEventListener("click", () => setFontSize(state.fs - 4));
  refs.fsPlus.addEventListener("click", () => setFontSize(state.fs + 4));

  refs.fontBtnTop.addEventListener("click", openFontPanel);
  refs.fontBtnM.addEventListener("click", openFontPanel);
  refs.fontClose.addEventListener("click", closeFontPanel);
  refs.fontSearch.addEventListener("input", () => {
    filters.q = refs.fontSearch.value;
    applyFilters();
  });

  refs.openParams.addEventListener("click", () => openSheet(refs.paramsSheet));
  refs.paramsClose.addEventListener("click", () => closeSheet(refs.paramsSheet));
  refs.scrim.addEventListener("click", closeAllSheets);

  refs.tabEditor.addEventListener("click", () => showTab("editor"));
  refs.tabPreview.addEventListener("click", () => showTab("stage"));

  refs.mdInput.addEventListener("input", scheduleMarkdown);
  refs.exportBtn.addEventListener("click", () => onExport());
  refs.copyPngBtn.addEventListener("click", () => onCopyPng());
  refs.copyBtn.addEventListener("click", () => void copyShareUrl());
  refs.copyBtnM.addEventListener("click", () => void copyShareUrl());

  refs.fontScroll.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = 0;
      drawRows();
    });
  });

  window.addEventListener("resize", () => {
    fit();
    drawRows();
    if (window.innerWidth > 820) {
      refs.editorPane.removeAttribute("hidden");
      refs.stagePane.removeAttribute("hidden");
      if (refs.fontPanel.classList.contains("open")) openFontPanel();
    } else {
      refs.fontPanel.style.left = "";
      refs.fontPanel.style.top = "";
      refs.fontPanel.style.width = "";
      refs.fontPanel.style.height = "";
    }
  });
  new ResizeObserver(() => fit()).observe(refs.stageScroll);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllSheets();
  });

  window.addEventListener("popstate", () => {
    window.clearTimeout(urlTimer);
    state = parseState(location.search);
    validateFontIds();
    applyState();
    void loadStackFonts().then(applyStyle);
  });

  document.fonts.ready.then(fit).catch(() => undefined);
}

// ---------- 启动 ----------
async function boot(): Promise<void> {
  buildPresetUi();
  bindEvents();
  refs.mdInput.value = DEFAULT_MARKDOWN;
  renderCanvas();
  applyState();
  replaceUrl(state);

  if (window.innerWidth <= 820) showTab("stage");

  try {
    const result = await loadCatalog();
    applyCatalog(result.raw);
    if (result.stale) {
      requestIdle(() => {
        void refreshStale((raw) => {
          applyCatalog(raw);
        });
      });
    }
  } catch (error) {
    showCatalogError(error);
  }
}

void boot();
