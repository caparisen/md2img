import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
});

export function renderMarkdown(target: HTMLElement, source: string): void {
  target.innerHTML = md.render(source);
}
