import { toBlob } from "html-to-image";

export interface RenderOptions {
  node: HTMLElement;
  fontEmbedCss: string;
}

export function pngFilename(width: number, height: number): string {
  return `markdown-${width}x${height}.png`;
}

export async function renderPngBlob(options: RenderOptions): Promise<Blob> {
  const { node, fontEmbedCss } = options;

  await document.fonts.ready;

  const blob = await toBlob(node, {
    pixelRatio: 1,
    width: node.offsetWidth,
    height: node.offsetHeight,
    fontEmbedCSS: fontEmbedCss,
    skipFonts: true,
    cacheBust: false,
    style: {
      transform: "none",
    },
  });

  if (!blob) throw new Error("PNG rendering failed");
  return blob;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyPngToClipboard(options: RenderOptions): Promise<void> {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    throw new Error("clipboard image writing is not supported");
  }

  // 把渲染 Promise 直接交给 ClipboardItem：写入在用户手势内发起，渲染可以继续异步完成
  const blobPromise = renderPngBlob(options);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
    return;
  } catch {
    // 部分实现只接受已完成的 Blob
    const blob = await blobPromise;
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }
}
