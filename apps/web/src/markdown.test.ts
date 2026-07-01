import { describe, expect, it } from "vitest";

import { parseMarkdownBlocks, safeMarkdownHref } from "./markdown";

describe("markdown content", () => {
  it("parses the supported channel description blocks", () => {
    expect(
      parseMarkdownBlocks(
        [
          "# Telegram Bot",
          "",
          "Use **BotFather** to create a bot.",
          "",
          "- inbound messages",
          "- outbound messages",
          "",
          "1. Create bot",
          "2. Paste token"
        ].join("\n")
      )
    ).toEqual([
      {
        kind: "heading",
        level: 2,
        text: "Telegram Bot"
      },
      {
        kind: "paragraph",
        text: "Use **BotFather** to create a bot."
      },
      {
        kind: "list",
        ordered: false,
        items: ["inbound messages", "outbound messages"]
      },
      {
        kind: "list",
        ordered: true,
        items: ["Create bot", "Paste token"]
      }
    ]);
  });

  it("allows only safe inline link protocols", () => {
    expect(safeMarkdownHref("https://hulee.ru/docs")).toBe(
      "https://hulee.ru/docs"
    );
    expect(safeMarkdownHref("mailto:support@hulee.ru")).toBe(
      "mailto:support@hulee.ru"
    );
    expect(safeMarkdownHref("javascript:alert(1)")).toBeUndefined();
  });
});
