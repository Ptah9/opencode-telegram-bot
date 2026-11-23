interface NormalizeMarkdownOptions {
  preserveBlockMarkup: boolean;
}

interface FenceDelimiter {
  char: "`" | "~";
  length: number;
  /** Container indentation the fence belongs to, in columns. */
  container: number;
}

/** Characters of a line covered by an inline code span. */
interface CodeSpan {
  start: number;
  end: number;
}

interface LineAnalysis {
  /** Lines of fenced code blocks, including their delimiters. */
  fenced: boolean[];
  /** Lines that open an indented code block. */
  indentedCode: boolean[];
  /** Indented lines that lazily continue an open paragraph. */
  continuation: boolean[];
}

/** An opening fence after its container indentation is stripped. */
const OPENING_FENCE_PATTERN = /^(`{3,}|~{3,})(.*)$/;

/** A closing fence: the same character, at least as long, and nothing else on the line. */
const CLOSING_FENCE_PATTERN = /^(`{3,}|~{3,})[ \t]*$/;

const LIST_MARKER_PATTERN = /^(\s*)(?:[-+*]|\d+[.)])\s+/;

/**
 * Content indentation of a list item. Up to four spaces after the marker count
 * as indentation; a longer run starts the item content after a single space.
 */
function listMarkerContentIndent(marker: string): number {
  const markerWidth = indentWidth(marker.trimEnd());
  const spacing = indentWidth(marker) - markerWidth;
  return markerWidth + (spacing <= 4 ? spacing : 1);
}

/**
 * A fence may sit at most three columns past the current container, so nested
 * list items can still hold fenced code.
 */
function openingFence(line: string, width: number, containerIndent: number): FenceDelimiter | null {
  if (width > containerIndent + 3) {
    return null;
  }

  const indent = leadingIndent(line);
  let rest = line.slice(indent.length);
  // A fence left of the current list content starts outside that list.
  let container = width < containerIndent ? 0 : containerIndent;

  // A fence may start right after a list marker, e.g. "- ```js".
  const marker = rest.match(/^(?:[-+*]|\d+[.)])\s+/);
  if (marker) {
    container = width + indentWidth(marker[0]);
    rest = rest.slice(marker[0].length);
  }

  const match = rest.match(OPENING_FENCE_PATTERN);
  const fence = match?.[1];
  const info = match?.[2];
  if (!fence || info === undefined) {
    return null;
  }

  const char = fence[0] as "`" | "~";
  // A backtick fence cannot carry backticks in its info string.
  if (char === "`" && info.includes("`")) {
    return null;
  }

  return { char, length: fence.length, container };
}

function isClosingFence(line: string, opening: FenceDelimiter): boolean {
  const indent = leadingIndent(line);
  const width = indentWidth(indent);
  // A closing fence stays inside its container and at most three columns past it.
  if (width < opening.container || width > opening.container + 3) {
    return false;
  }

  const fence = line.slice(indent.length).match(CLOSING_FENCE_PATTERN)?.[1];
  return fence !== undefined && fence[0] === opening.char && fence.length >= opening.length;
}

function leadingIndent(line: string): string {
  return line.match(/^[ \t]*/)?.[0] ?? "";
}

/** Indentation width, with tabs counted as four spaces. */
function indentWidth(indent: string): number {
  return indent.replace(/\t/g, "    ").length;
}

/** Drop the opening fence indentation so the formula keeps its own layout. */
function stripIndent(line: string, indent: string): string {
  if (!indent) {
    return line;
  }

  return line.startsWith(indent) ? line.slice(indent.length) : line.trimStart();
}

/**
 * Splits the document into literal and structural lines in one pass. The list
 * container is tracked so fences keep working inside nested items, and an
 * indented line only opens a code block where a code block can interrupt the
 * flow: right after a blank line or another block, never inside a paragraph.
 */
function analyzeLines(lines: string[]): LineAnalysis {
  const fenced = new Array<boolean>(lines.length).fill(false);
  const indentedCode = new Array<boolean>(lines.length).fill(false);
  const continuation = new Array<boolean>(lines.length).fill(false);
  let opening: FenceDelimiter | null = null;
  let listContentIndent = 0;
  let paragraphOpen = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    if (opening) {
      // A dedented line ends the container, and the fence ends with it.
      if (line.trim() && indentWidth(leadingIndent(line)) < opening.container) {
        opening = null;
        paragraphOpen = false;
      } else {
        fenced[index] = true;
        if (isClosingFence(line, opening)) {
          opening = null;
          paragraphOpen = false;
        }
        continue;
      }
    }

    if (!line.trim()) {
      paragraphOpen = false;
      continue;
    }

    const indent = leadingIndent(line);
    const width = indentWidth(indent);

    const fence = openingFence(line, width, listContentIndent);
    if (fence) {
      opening = fence;
      fenced[index] = true;
      paragraphOpen = false;
      // A fence at a smaller indentation ends the surrounding list item.
      if (width < listContentIndent) {
        listContentIndent = 0;
      }
      continue;
    }

    if (width >= listContentIndent + 4) {
      if (paragraphOpen) {
        continuation[index] = true;
      } else {
        indentedCode[index] = true;
      }
      continue;
    }

    if (isHorizontalRuleLine(line)) {
      // A rule at a smaller indentation ends the surrounding list item.
      if (width < listContentIndent) {
        listContentIndent = 0;
      }
      paragraphOpen = false;
      continue;
    }

    const listMarker = line.match(LIST_MARKER_PATTERN);
    if (listMarker) {
      listContentIndent = listMarkerContentIndent(listMarker[0]);
      paragraphOpen = true;
      continue;
    }

    if (width < listContentIndent) {
      listContentIndent = 0;
    }

    paragraphOpen = !isHeadingLine(line);
  }

  return { fenced, indentedCode, continuation };
}

function addCodeSpan(
  spans: CodeSpan[][],
  lines: string[],
  lineStarts: number[],
  start: number,
  end: number,
): void {
  for (let index = 0; index < lines.length; index++) {
    const lineStart = lineStarts[index];
    const lineSpans = spans[index];
    if (lineStart === undefined || !lineSpans) {
      continue;
    }

    const lineEnd = lineStart + (lines[index]?.length ?? 0);
    if (end <= lineStart || start >= lineEnd) {
      continue;
    }

    lineSpans.push({
      start: Math.max(start, lineStart) - lineStart,
      end: Math.min(end, lineEnd) - lineStart,
    });
  }
}

function isEscapedBacktick(text: string, index: number): boolean {
  let backslashes = 0;
  for (let position = index - 1; position >= 0 && text[position] === "\\"; position--) {
    backslashes += 1;
  }

  return backslashes % 2 === 1;
}

/**
 * Inline code spans per line. Spans may contain line breaks, so backticks are
 * matched across a whole paragraph and excluded from formula normalization.
 */
function markCodeSpans(lines: string[], paragraph: boolean[]): CodeSpan[][] {
  const spans = lines.map((): CodeSpan[] => []);
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }

  let index = 0;
  while (index < lines.length) {
    if (!paragraph[index]) {
      index += 1;
      continue;
    }

    const first = index;
    while (index < lines.length && paragraph[index]) {
      index += 1;
    }

    const text = lines.slice(first, index).join("\n");
    const base = lineStarts[first] ?? 0;

    let cursor = 0;
    while (cursor < text.length) {
      const open = text.indexOf("`", cursor);
      if (open === -1) {
        break;
      }

      let openEnd = open;
      while (text[openEnd] === "`") {
        openEnd += 1;
      }
      const runLength = openEnd - open;

      if (isEscapedBacktick(text, open)) {
        cursor = openEnd;
        continue;
      }

      let close = -1;
      let search = openEnd;
      while (search < text.length) {
        const next = text.indexOf("`", search);
        if (next === -1) {
          break;
        }

        let runEnd = next;
        while (text[runEnd] === "`") {
          runEnd += 1;
        }
        if (runEnd - next === runLength && !isEscapedBacktick(text, next)) {
          close = next;
          break;
        }
        search = runEnd;
      }

      if (close === -1) {
        cursor = openEnd;
        continue;
      }

      addCodeSpan(spans, lines, lineStarts, base + open, base + close + runLength);
      cursor = close + runLength;
    }
  }

  return spans;
}

function isRangeInCodeSpan(spans: CodeSpan[] | undefined, start: number, end: number): boolean {
  return (spans ?? []).some((span) => start < span.end && end > span.start);
}

function isHorizontalRuleLine(line: string): boolean {
  const normalized = line.trim();
  if (!normalized) {
    return false;
  }

  return /^([-*_])(?:\s*\1){2,}$/.test(normalized);
}

function isHeadingLine(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+\S/.test(line);
}

/** `$$ formula $$` on a single line, as models often emit it. */
function extractSingleLineMath(
  line: string,
): { expression: string; start: number; end: number } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("$$") || !trimmed.endsWith("$$") || trimmed.length <= 4) {
    return null;
  }

  const expression = trimmed.slice(2, -2).trim();
  if (!expression) {
    return null;
  }

  const start = line.length - line.trimStart().length;
  return { expression, start, end: start + trimmed.length };
}

function isMathFenceLine(line: string): boolean {
  return line.trim() === "$$";
}

/** A math fence must be longer than any backtick run that starts an expression line. */
function mathFenceLength(lines: string[]): number {
  let longest = 0;
  for (const line of lines) {
    const run = line.trimStart().match(/^`+/)?.[0];
    if (run && run.length >= 3) {
      longest = Math.max(longest, run.length);
    }
  }

  return Math.max(3, longest + 1);
}

function normalizeHeadingLine(line: string): string {
  const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
  const heading = match?.[1];
  if (!heading) {
    return line;
  }

  return `**${heading}**`;
}

function normalizeChecklistLine(line: string): string | null {
  const match = line.match(/^(\s*)(?:[-+*]|\d+\.)\s+\[( |x|X)\]\s+(.*)$/);
  const indent = match?.[1];
  const checked = match?.[2];
  const rest = match?.[3];
  if (indent === undefined || checked === undefined || rest === undefined) {
    return null;
  }

  const marker = checked.toLowerCase() === "x" ? "✅" : "🔲";
  return `${indent}${marker} ${rest}`;
}

function normalizeMarkdown(text: string, options: NormalizeMarkdownOptions): string {
  // Line endings are normalized first so fences and formulas work on CRLF input.
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const output: string[] = [];
  const { fenced, indentedCode, continuation } = analyzeLines(lines);
  const codeSpans = markCodeSpans(
    lines,
    lines.map(
      (line, index) =>
        !fenced[index] &&
        !indentedCode[index] &&
        line.trim() !== "" &&
        !isHeadingLine(line) &&
        !isHorizontalRuleLine(line),
    ),
  );
  let inQuote = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    if (fenced[index]) {
      inQuote = false;
      output.push(line);
      continue;
    }

    if (!line.trim()) {
      inQuote = false;
      output.push(line);
      continue;
    }

    const indent = leadingIndent(line);

    // Indented code and its lazy continuations are literal text: formulas
    // inside them must stay untouched.
    if (indentedCode[index] || continuation[index]) {
      output.push(line);
      continue;
    }

    const lineSpans = codeSpans[index];
    const singleLineMath = extractSingleLineMath(line);
    if (singleLineMath && !isRangeInCodeSpan(lineSpans, singleLineMath.start, singleLineMath.end)) {
      const fence = "`".repeat(mathFenceLength([singleLineMath.expression]));
      output.push(
        `${indent}${fence}math`,
        `${indent}${singleLineMath.expression}`,
        `${indent}${fence}`,
      );
      inQuote = false;
      continue;
    }

    if (isMathFenceLine(line) && !isRangeInCodeSpan(lineSpans, indent.length, indent.length + 2)) {
      const expressionLines: string[] = [];
      let closingIndex = -1;
      for (let inner = index + 1; inner < lines.length; inner++) {
        const innerLine = lines[inner];
        if (innerLine === undefined) {
          continue;
        }

        // A fenced block interrupts the formula.
        if (fenced[inner]) {
          break;
        }

        if (isMathFenceLine(innerLine)) {
          const innerIndent = leadingIndent(innerLine);
          // A delimiter inside code or inline code cannot close the formula; the
          // block is ambiguous, so it is left as written rather than rewritten.
          if (
            indentedCode[inner] ||
            isRangeInCodeSpan(codeSpans[inner], innerIndent.length, innerIndent.length + 2)
          ) {
            break;
          }
          closingIndex = inner;
          break;
        }

        expressionLines.push(innerLine);
      }

      const expression = expressionLines
        .map((expressionLine) => stripIndent(expressionLine, indent))
        .join("\n")
        .trim();
      if (closingIndex !== -1 && expression) {
        const emittedLines = expression.split("\n");
        const fence = "`".repeat(mathFenceLength(emittedLines));
        output.push(`${indent}${fence}math`);
        for (const expressionLine of emittedLines) {
          output.push(expressionLine ? `${indent}${expressionLine}` : "");
        }
        output.push(`${indent}${fence}`);
        index = closingIndex;
        inQuote = false;
        continue;
      }
    }

    if (isHeadingLine(line)) {
      output.push(options.preserveBlockMarkup ? line : normalizeHeadingLine(line));
      inQuote = false;
      continue;
    }

    if (isHorizontalRuleLine(line)) {
      output.push(options.preserveBlockMarkup ? line : "──────────");
      inQuote = false;
      continue;
    }

    const trimmedLeft = line.trimStart();
    if (trimmedLeft.startsWith(">")) {
      inQuote = true;
      const quoteContent = trimmedLeft.replace(/^>\s?/, "");
      const normalizedChecklistInQuote = normalizeChecklistLine(quoteContent);
      output.push(
        normalizedChecklistInQuote && !options.preserveBlockMarkup
          ? `> ${normalizedChecklistInQuote.trimStart()}`
          : `> ${quoteContent.trimStart()}`,
      );
      continue;
    }

    const normalizedChecklist = normalizeChecklistLine(line);
    if (normalizedChecklist) {
      if (options.preserveBlockMarkup) {
        output.push(inQuote ? `> ${trimmedLeft}` : line);
      } else {
        output.push(inQuote ? `> ${normalizedChecklist.trimStart()}` : normalizedChecklist);
      }
      continue;
    }

    if (inQuote) {
      output.push(`> ${trimmedLeft}`);
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

export function normalizeMarkdownForTelegramRendering(text: string): string {
  return normalizeMarkdown(text, { preserveBlockMarkup: false });
}

export function normalizeMarkdownForTelegramBlockParsing(text: string): string {
  return normalizeMarkdown(text, { preserveBlockMarkup: true });
}
