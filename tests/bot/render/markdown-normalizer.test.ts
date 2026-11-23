import { describe, expect, it } from "vitest";
import { parseTelegramBlocks } from "../../../src/bot/render/block-parser.js";
import {
  normalizeMarkdownForTelegramBlockParsing,
  normalizeMarkdownForTelegramRendering,
} from "../../../src/bot/render/markdown-normalizer.js";

describe("bot/render/markdown-normalizer", () => {
  it("normalizes headings, quotes, horizontal rules, and checklists", () => {
    const input = [
      "# Main heading",
      "",
      "> quoted line",
      "Quote continues",
      "",
      "- [ ] Open task",
      "- [x] Done task",
      "1. [ ] Numbered task",
      "",
      "---",
    ].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      [
        "**Main heading**",
        "",
        "> quoted line",
        "> Quote continues",
        "",
        "🔲 Open task",
        "✅ Done task",
        "🔲 Numbered task",
        "",
        "──────────",
      ].join("\n"),
    );
  });

  it("normalizes checklists inside quotes and preserves quote mode", () => {
    const input = ["> - [ ] Review", "Follow-up line", "- [x] Outside quote"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["> 🔲 Review", "> Follow-up line", "> ✅ Outside quote"].join("\n"),
    );
  });

  it("resets quote mode after an empty line", () => {
    const input = ["> quoted line", "", "Plain line"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["> quoted line", "", "Plain line"].join("\n"),
    );
  });

  it("keeps fenced code blocks untouched", () => {
    const input = [
      "```ts",
      "# Not a heading",
      "> not a quote",
      "- [ ] not a checklist",
      "---",
      "```",
    ].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
  });

  it("keeps tilde-fenced code blocks untouched", () => {
    const input = ["~~~text", "$$x^2$$", "", "```math", "```", "~~~"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("keeps four-space indented code blocks untouched", () => {
    const input = ["Example:", "", "    $$x^2$$", "", "    $$", "    a = b", "    $$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
  });

  it("preserves malformed emphasis text without dropping content", () => {
    const input = "*text: *value**";

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
  });

  it("keeps structural markdown for parser-safe normalization", () => {
    const input = [
      "# Main heading",
      "",
      "> - [ ] Review",
      "Follow-up line",
      "",
      "- [x] Done task",
      "",
      "---",
    ].join("\n");

    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(
      [
        "# Main heading",
        "",
        "> - [ ] Review",
        "> Follow-up line",
        "",
        "- [x] Done task",
        "",
        "---",
      ].join("\n"),
    );
  });

  it("converts dollar-delimited formulas into math fences", () => {
    const input = ["Intro", "", "$$", "E = mc^2", "$$", "", "and $$x^2$$ inside a line"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["Intro", "", "```math", "E = mc^2", "```", "", "and $$x^2$$ inside a line"].join("\n"),
    );
  });

  it("keeps a formula nested inside a numbered list item", () => {
    const input = ["1. Formula:", "   $$x^2$$", "   continuation", "2. Second"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["1. Formula:", "   ```math", "   x^2", "   ```", "   continuation", "2. Second"].join("\n"),
    );

    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "list",
        ordered: true,
        items: [
          {
            blocks: [
              { type: "paragraph", inlines: [{ type: "text", text: "Formula:" }] },
              { type: "math", expression: "x^2" },
              { type: "paragraph", inlines: [{ type: "text", text: "continuation" }] },
            ],
          },
          { blocks: [{ type: "paragraph", inlines: [{ type: "text", text: "Second" }] }] },
        ],
      },
    ]);
  });

  it("keeps multi-line formulas nested inside a list item", () => {
    const input = ["- item", "  $$", "  a = b", "  $$", "- next"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["- item", "  ```math", "  a = b", "  ```", "- next"].join("\n"),
    );
  });

  it("does not close a longer fence on a shorter delimiter", () => {
    const input = ["````md", "```ts", "$$x^2$$", "```", "````"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("does not close a tilde fence on a line with trailing text", () => {
    const input = ["~~~text", "~~~not-a-closing-fence", "$$x^2$$", "~~~"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("keeps formulas inside multi-line inline code spans", () => {
    const input = ["`begin", "$$x^2$$", "end`"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "paragraph",
        inlines: [{ type: "code", text: "begin\n$$x^2$$\nend" }],
      },
    ]);
  });

  it("does not take a closing dollar delimiter from inside a code block", () => {
    const input = ["$$", "intro", "```", "$$", "```"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "paragraph",
        inlines: [
          { type: "text", text: "$$\nintro" },
        ],
      },
      { type: "code", text: "$$" },
    ]);
  });

  it("keeps fences working on CRLF input", () => {
    const input = ["```md", "# Title", "---", "$$x^2$$", "```"].join("\r\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["```md", "# Title", "---", "$$x^2$$", "```"].join("\n"),
    );
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(
      ["```md", "# Title", "---", "$$x^2$$", "```"].join("\n"),
    );
  });

  it("keeps fences inside a nested list item", () => {
    const input = ["- outer", "  - inner", "    ```md", "    ---", "    ```"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("converts a formula whose body is indented", () => {
    const input = ["$$", "    a = b", "$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["```math", "a = b", "```"].join("\n"),
    );
  });

  it("ignores escaped backticks when matching inline code", () => {
    const input = ["\\`", "$$x^2$$", "\\`"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["\\`", "```math", "x^2", "```", "\\`"].join("\n"),
    );
  });

  it("does not let inline code spans cross a heading", () => {
    const input = ["`start", "# Heading", "$$x^2$$", "end`"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["`start", "**Heading**", "```math", "x^2", "```", "end`"].join("\n"),
    );
  });

  it("keeps indented code after a rule written as a list marker", () => {
    const input = ["* * *", "", "    $$x^2$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["──────────", "", "    $$x^2$$"].join("\n"),
    );
  });

  it("keeps indented code after a fence that ends a list item", () => {
    const input = ["1. item", "", "```", "x", "```", "", "    $$x^2$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
  });

  it("converts a formula with a blank line and indented body", () => {
    const input = ["$$", "    a = b", "", "    c = d", "$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["```math", "a = b", "", "    c = d", "```"].join("\n"),
    );
  });

  it("keeps a fence that starts right after a list marker", () => {
    const input = ["- ```js", "  $$x^2$$", "  ```"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "list",
        ordered: false,
        items: [{ blocks: [{ type: "code", language: "js", text: "$$x^2$$" }] }],
      },
    ]);
  });

  it("keeps indented code after a rule that ends a list", () => {
    const input = ["- item", "", "---", "", "    $$x^2$$"].join("\n");

    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["- item", "", "──────────", "", "    $$x^2$$"].join("\n"),
    );
  });

  it("does not close a fence indented past its container", () => {
    const input = ["   ```js", "   x", "    ```", "$$x^2$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
  });

  it("does not close a dedented fence on the previous list indentation", () => {
    const input = ["- a", "", "```md", "    ```", "$$x$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("uses a longer math fence when the expression contains a fence", () => {
    const input = ["$$", "    ```", "x = 1", "$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["````math", "```", "x = 1", "````"].join("\n"),
    );
    expect(parseTelegramBlocks(input)).toEqual([
      { type: "math", expression: "```\nx = 1" },
    ]);
  });

  it("does not close a list fence on a line outside the item", () => {
    const input = ["- ```js", "  x = 1", "```", "$$x^2$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
    expect(parseTelegramBlocks(input)).toEqual([
      {
        type: "list",
        ordered: false,
        items: [{ blocks: [{ type: "code", language: "js", text: "x = 1" }] }],
      },
      { type: "code", text: "$$x^2$$" },
    ]);
  });

  it("ends a list fence when a dedented line closes the item", () => {
    const input = ["- ```js", "***", "  ```", "$$x^2$$"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(
      ["- ```js", "──────────", "  ```", "$$x^2$$"].join("\n"),
    );
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("keeps a fence that starts left of the list content", () => {
    const input = ["1. item", "", "  ```", "# q", "  ```"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });

  it("keeps code before a fence that starts left of the list content", () => {
    const input = ["1. item", "  ```", "- item", "    $$z$$", "  ```"].join("\n");

    expect(normalizeMarkdownForTelegramRendering(input)).toBe(input);
    expect(normalizeMarkdownForTelegramBlockParsing(input)).toBe(input);
  });
});
