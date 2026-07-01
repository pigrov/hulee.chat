import { createElement, type ReactNode } from "react";

type MarkdownBlock =
  | {
      kind: "heading";
      level: 2 | 3 | 4;
      text: string;
    }
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      kind: "list";
      ordered: boolean;
      items: string[];
    };

export function MarkdownContent({ value }: { value: string }): ReactNode {
  const blocks = parseMarkdownBlocks(value);

  return createElement(
    "div",
    { className: "markdownContent" },
    blocks.map((block, index) => renderMarkdownBlock(block, index))
  );
}

export function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const paragraph: string[] = [];
  let currentList: { ordered: boolean; items: string[] } | null = null;

  function flushParagraph(): void {
    const text = paragraph.join(" ").trim();
    paragraph.length = 0;

    if (text.length > 0) {
      blocks.push({ kind: "paragraph", text });
    }
  }

  function flushList(): void {
    if (currentList && currentList.items.length > 0) {
      blocks.push({
        kind: "list",
        ordered: currentList.ordered,
        items: currentList.items
      });
    }

    currentList = null;
  }

  for (const rawLine of value.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();

    if (line.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);

    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: Math.min(heading[1].length + 1, 4) as 2 | 3 | 4,
        text: heading[2].trim()
      });
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(line);

    if (unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      const item = (unordered?.[1] ?? ordered?.[1] ?? "").trim();

      if (!currentList || currentList.ordered !== orderedList) {
        flushList();
        currentList = {
          ordered: orderedList,
          items: []
        };
      }

      if (item.length > 0) {
        currentList.items.push(item);
      }

      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}

function renderMarkdownBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const headingTag = `h${block.level}` as "h2" | "h3" | "h4";

      return createElement(
        headingTag,
        { key: index },
        renderInlineMarkdown(block.text)
      );
    }
    case "paragraph":
      return createElement(
        "p",
        { key: index },
        renderInlineMarkdown(block.text)
      );
    case "list": {
      const listTag = block.ordered ? "ol" : "ul";

      return createElement(
        listTag,
        { key: index },
        block.items.map((item, itemIndex) =>
          createElement("li", { key: itemIndex }, renderInlineMarkdown(item))
        )
      );
    }
  }
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern =
    /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    parts.push(renderInlineToken(match[0], parts.length));
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderInlineToken(token: string, key: number): ReactNode {
  if (token.startsWith("`") && token.endsWith("`")) {
    return createElement("code", { key }, token.slice(1, -1));
  }

  if (
    (token.startsWith("**") && token.endsWith("**")) ||
    (token.startsWith("__") && token.endsWith("__"))
  ) {
    return createElement("strong", { key }, token.slice(2, -2));
  }

  if (
    (token.startsWith("*") && token.endsWith("*")) ||
    (token.startsWith("_") && token.endsWith("_"))
  ) {
    return createElement("em", { key }, token.slice(1, -1));
  }

  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);

  if (link) {
    const href = safeMarkdownHref(link[2]);

    return href
      ? createElement(
          "a",
          { key, href, rel: "noreferrer", target: "_blank" },
          link[1]
        )
      : link[1];
  }

  return token;
}

export function safeMarkdownHref(value: string): string | undefined {
  try {
    const url = new URL(value.trim());

    return url.protocol === "https:" ||
      url.protocol === "http:" ||
      url.protocol === "mailto:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
