import { describe, expect, it } from "vitest";
import { classifyStoredFile, detectFile } from "@/lib/uploads/file-types";

const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value);

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);

const FIXTURES = {
  png: new Uint8Array(PNG_1X1),
  gif: new Uint8Array(Buffer.from("GIF89a" + "\u0000".repeat(32), "binary")),
  pdf: bytes("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<<>>\n%%EOF\n"),
  zip: new Uint8Array(Buffer.concat([Buffer.from("504b0304", "hex"), Buffer.alloc(64)])),
  html: bytes("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>"),
  svg: bytes(
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`,
  ),
  php: bytes("<?php echo 'pwn'; ?>"),
  markdown: bytes("# Title\n\nSome **notes**\n"),
  csv: bytes("name,score\nana,10\n"),
  typescript: bytes("export const x = 1;\n"),
  binaryText: new Uint8Array(Buffer.from([0x68, 0x00, 0x69, 0x00])),
} as const;

describe("detectFile", () => {
  it("detects raster images by signature, ignoring client-declared types", async () => {
    const png = await detectFile(FIXTURES.png, "photo.png");
    expect(png).toMatchObject({ mimeType: "image/png", classification: "image", sniffed: true });

    const gif = await detectFile(FIXTURES.gif, "animation.gif");
    expect(gif.mimeType).toBe("image/gif");
    expect(gif.classification).toBe("image");
  });

  it("classifies active content as download-only, never inline", async () => {
    const html = await detectFile(FIXTURES.html, "page.html");
    expect(html.mimeType).toBe("text/html");
    expect(html.classification).toBe("download-only");

    const svg = await detectFile(FIXTURES.svg, "logo.svg");
    expect(svg.mimeType).toBe("image/svg+xml");
    expect(svg.classification).toBe("download-only");

    const svgNoDeclaration = await detectFile(
      bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      "icon.svg",
    );
    expect(svgNoDeclaration.mimeType).toBe("image/svg+xml");
    expect(svgNoDeclaration.classification).toBe("download-only");
  });

  it("detects documents and archives", async () => {
    const pdf = await detectFile(FIXTURES.pdf, "doc.pdf");
    expect(pdf).toMatchObject({
      mimeType: "application/pdf",
      classification: "pdf",
      sniffed: true,
    });

    const zip = await detectFile(FIXTURES.zip, "bundle.zip");
    expect(zip).toMatchObject({
      mimeType: "application/zip",
      classification: "archive",
      sniffed: true,
    });
  });

  it("never trusts extensions over bytes", async () => {
    const disguised = await detectFile(FIXTURES.php, "shell.png");
    expect(disguised.mimeType).toBe("application/octet-stream");
    expect(disguised.classification).toBe("unknown");

    const executable = new Uint8Array(Buffer.from("MZ\u0090\u0000\u0003", "binary"));
    const exe = await detectFile(executable, "photo.jpg");
    expect(exe.mimeType).not.toBe("image/jpeg");
    expect(exe.classification).toBe("unknown");
  });

  it("recognizes text formats only when extension and content agree", async () => {
    const markdown = await detectFile(FIXTURES.markdown, "README.md");
    expect(markdown.classification).toBe("markdown");
    expect(markdown.mimeType).toBe("text/markdown");

    const csv = await detectFile(FIXTURES.csv, "scores.csv");
    expect(csv.classification).toBe("csv");
    expect(csv.mimeType).toBe("text/csv");

    const typescript = await detectFile(FIXTURES.typescript, "main.ts");
    expect(typescript.classification).toBe("text");
    expect(typescript.mimeType).toBe("text/plain");
    expect(typescript.sniffed).toBe(false);

    const htmlAsText = await detectFile(FIXTURES.html, "page.txt");
    expect(htmlAsText.classification).toBe("download-only");

    const binary = await detectFile(FIXTURES.binaryText, "notes.txt");
    expect(binary.mimeType).toBe("application/octet-stream");
    expect(binary.classification).toBe("unknown");
    expect(binary.binary).toBe(true);
  });
});

describe("classifyStoredFile", () => {
  it("maps stored metadata to preview classifications", () => {
    expect(classifyStoredFile("image/png", "a.png", 10)).toBe("image");
    expect(classifyStoredFile("application/pdf", "a.pdf", 10)).toBe("pdf");
    expect(classifyStoredFile("application/zip", "a.zip", 10)).toBe("archive");
    expect(classifyStoredFile("audio/mpeg", "a.mp3", 10)).toBe("audio");
    expect(classifyStoredFile("video/mp4", "a.mp4", 10)).toBe("video");
    expect(classifyStoredFile("text/markdown", "a.md", 10)).toBe("markdown");
    expect(classifyStoredFile(null, "a.markdown", 10)).toBe("markdown");
    expect(classifyStoredFile("text/csv", "a.csv", 10)).toBe("csv");
    expect(classifyStoredFile(null, "a.tsv", 10)).toBe("csv");
    expect(classifyStoredFile("text/plain", "a.ts", 10)).toBe("text");
    expect(classifyStoredFile("application/json", "a.json", 10)).toBe("text");
  });

  it("keeps active and unknown types away from inline previews", () => {
    expect(classifyStoredFile("image/svg+xml", "a.svg", 10)).toBe("download-only");
    expect(classifyStoredFile("text/html", "a.html", 10)).toBe("download-only");
    expect(classifyStoredFile("application/xml", "a.xml", 10)).toBe("download-only");
    expect(classifyStoredFile("image/heic", "a.heic", 10)).toBe("download-only");
    expect(classifyStoredFile(null, "a.svg", 10)).toBe("download-only");
    expect(classifyStoredFile("application/octet-stream", "a.bin", 10)).toBe("unknown");
  });
});
