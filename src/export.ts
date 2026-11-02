import { toPng } from "html-to-image";

export interface ExportOptions {
  node: HTMLElement;
  fontEmbedCss: string;
  filename: string;
}

export async function exportPng(options: ExportOptions): Promise<void> {
  const { node, fontEmbedCss, filename } = options;

  await document.fonts.ready;

  const dataUrl = await toPng(node, {
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

  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
