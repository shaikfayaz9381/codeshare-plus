import { describe, expect, it } from "vitest";
import {
  detectLanguageFromContent,
  detectLanguageFromFilename,
  parseCsvText,
  renderMarkdownToSafeHtml,
} from "@/lib/services/previews";

describe("renderMarkdownToSafeHtml", () => {
  it("renders basic markdown", () => {
    const html = renderMarkdownToSafeHtml("# Title\n\n**bold** and *italic*\n\n- one\n- two\n");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<li>one</li>");
  });

  it("escapes raw HTML instead of rendering it", () => {
    const html = renderMarkdownToSafeHtml(
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n<iframe src="https://evil.test"></iframe>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
  });

  it("neutralizes dangerous link and image URLs", () => {
    const html = renderMarkdownToSafeHtml(
      [
        "[a](javascript:alert(1))",
        "[b](data:text/html;base64,PHNjcmlwdD4=)",
        "[c](vbscript:msgbox)",
        "![d](javascript:alert(2))",
        "[safe](https://example.com/x?a=1)",
      ].join("\n\n"),
    );
    expect(html).not.toMatch(
      /<\s*(?:a|img)\b[^>]*\b(?:href|src)\s*=\s*["']?\s*(?:javascript|data|vbscript):/i,
    );
    expect(html).toContain('href="https://example.com/x?a=1"');
  });

  it("hardens outbound links with rel and target", () => {
    const html = renderMarkdownToSafeHtml("[docs](https://example.com)");
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it("drops disallowed attributes while keeping text", () => {
    // Raw HTML is escaped (not rendered), so no attribute can survive at all.
    const html = renderMarkdownToSafeHtml('<span style="position:fixed" onclick="x()">text</span>');
    expect(html).not.toMatch(/<[a-z][^>]*\sstyle=/i);
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
    expect(html).toContain("text");

    // Generated markup (links) is rebuilt from an allowlist.
    const links = renderMarkdownToSafeHtml("[x](https://example.com)");
    expect(links).toContain('<a href="https://example.com"');
    expect(links).not.toContain("style=");
  });

  it("keeps code blocks intact", () => {
    const html = renderMarkdownToSafeHtml("```js\nconst x = '<b>not html</b>';\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("parseCsvText", () => {
  it("parses headers and rows", () => {
    const table = parseCsvText("name,score\nana,10\nbo,20\n");
    expect(table.columns).toEqual(["name", "score"]);
    expect(table.rows).toEqual([
      ["ana", "10"],
      ["bo", "20"],
    ]);
    expect(table.rowCount).toBe(2);
    expect(table.truncatedRows).toBe(false);
    expect(table.truncatedColumns).toBe(false);
    expect(table.parseErrors).toBe(0);
  });

  it("handles quoted fields, embedded commas and newlines", () => {
    const table = parseCsvText('a,b\n"hello, world","line1\nline2"\n');
    expect(table.rows[0]?.[0]).toBe("hello, world");
    expect(table.rows[0]?.[1]).toContain("line1");
  });

  it("caps rows and reports truncation", () => {
    const text = ["h", ...Array.from({ length: 600 }, (_, i) => `r${i}`)].join("\n");
    const table = parseCsvText(text);
    expect(table.rows).toHaveLength(500);
    expect(table.truncatedRows).toBe(true);
    expect(table.rowCount).toBe(500);
  });

  it("caps columns and fills missing cells", () => {
    const table = parseCsvText("a,b,c,d\n1,2,3,4\n", { maxColumns: 2 });
    expect(table.columns).toEqual(["a", "b"]);
    expect(table.truncatedColumns).toBe(true);
    const ragged = parseCsvText("a,b,c\n1\n");
    expect(ragged.rows[0]).toEqual(["1", "", ""]);
  });

  it("degrades gracefully for empty input", () => {
    const table = parseCsvText("");
    expect(table.columns).toEqual([]);
    expect(table.rows).toEqual([]);
    expect(table.rowCount).toBe(0);
  });
});

describe("language detection", () => {
  it("maps filenames to CodeMirror language ids", () => {
    expect(detectLanguageFromFilename("main.ts")).toBe("typescript");
    expect(detectLanguageFromFilename("Component.TSX")).toBe("tsx");
    expect(detectLanguageFromFilename("script.py")).toBe("python");
    expect(detectLanguageFromFilename("notes.md")).toBe("markdown");
    expect(detectLanguageFromFilename("data.json")).toBe("json");
    expect(detectLanguageFromFilename("Dockerfile")).toBe("plaintext");
    expect(detectLanguageFromFilename("archive.tar.gz")).toBe("plaintext");
  });

  it("infers languages from content heuristics", () => {
    expect(detectLanguageFromContent("#!/usr/bin/env node\nconsole.log(1)")).toBe("javascript");
    expect(detectLanguageFromContent("#!/bin/bash\necho hi")).toBe("bash");
    expect(detectLanguageFromContent("<?php echo 1;")).toBe("php");
    expect(detectLanguageFromContent("<!DOCTYPE html>\n<html></html>")).toBe("html");
    expect(detectLanguageFromContent('{"a":1}')).toBe("json");
    expect(detectLanguageFromContent("SELECT * FROM users")).toBe("sql");
    expect(detectLanguageFromContent("def main():\n    pass")).toBe("python");
    expect(detectLanguageFromContent("const value = 42")).toBe("javascript");
    expect(detectLanguageFromContent("just some prose")).toBe("plaintext");
  });
});
