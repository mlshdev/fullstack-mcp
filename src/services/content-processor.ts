import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Remove images, videos, audio, iframes, SVGs
turndown.addRule("removeMedia", {
  filter: ["img", "video", "audio", "iframe", "picture", "figure"],
  replacement: () => "",
});

// Remove SVGs
turndown.addRule("removeSvg", {
  filter: (node) => node.nodeName === "SVG" || node.nodeName === "svg",
  replacement: () => "",
});

// Remove script and style tags
turndown.addRule("removeScriptsStyles", {
  filter: ["script", "style", "noscript"],
  replacement: () => "",
});

export interface ProcessedContent {
  title: string;
  markdown: string;
  wordCount: number;
}

export function processHtml(html: string, url: string): ProcessedContent | null {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content) {
    return null;
  }

  let markdown = turndown.turndown(article.content);

  // Clean up excessive whitespace
  markdown = markdown
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "")
    .trim();

  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  return {
    title: article.title || "",
    markdown,
    wordCount,
  };
}
