import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CONTENT_MAX_CHARS,
  TITLE_MAX,
  createItemSchema,
  createShareSchema,
  dashboardQuerySchema,
  reorderItemsSchema,
  reserveUploadSchema,
  updateItemSchema,
  updateShareSchema,
  verifyPasswordSchema,
  zodIssues,
} from "@/lib/validation/schemas";
import { CODE_LANGUAGES } from "@/types";

const UUID = "0f0f0f0f-1111-4222-8333-444455556666";

describe("createShareSchema", () => {
  it("applies secure defaults", () => {
    const parsed = createShareSchema.parse({ title: "  My collection  " });
    expect(parsed).toEqual({
      title: "My collection",
      visibility: "unlisted",
      expiresIn: "7d",
      allowDownload: true,
      allowEdit: false,
    });
  });

  it("accepts explicit options and normalizes an empty description", () => {
    const parsed = createShareSchema.parse({
      title: "Shared",
      description: "   ",
      visibility: "public",
      expiresIn: "never",
      password: "a-long-enough-password",
      allowDownload: false,
      allowEdit: true,
    });
    expect(parsed.description).toBeNull();
    expect(parsed.visibility).toBe("public");
    expect(parsed.expiresIn).toBe("never");
    expect(parsed.password).toBe("a-long-enough-password");
    expect(parsed.allowEdit).toBe(true);
  });

  it("rejects invalid titles, expiries and passwords", () => {
    expect(createShareSchema.safeParse({ title: "" }).success).toBe(false);
    expect(createShareSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(createShareSchema.safeParse({ title: "x".repeat(TITLE_MAX + 1) }).success).toBe(false);
    expect(createShareSchema.safeParse({ title: "ok", visibility: "secret" }).success).toBe(false);
    expect(createShareSchema.safeParse({ title: "ok", expiresIn: "2h" }).success).toBe(false);
    expect(createShareSchema.safeParse({ title: "ok", password: "short" }).success).toBe(false);
    expect(createShareSchema.safeParse({ title: "ok", allowDownload: "yes" }).success).toBe(false);
  });
});

describe("custom share links", () => {
  it("is optional", () => {
    expect(createShareSchema.parse({ title: "t" }).customShareId).toBeUndefined();
  });

  it("normalizes case and surrounding whitespace", () => {
    const parsed = createShareSchema.parse({ title: "t", customShareId: "  My-Team-Notes  " });
    expect(parsed.customShareId).toBe("my-team-notes");
  });

  it("accepts valid links", () => {
    for (const good of ["team", "team2", "my-team-notes", "2026-notes", "a1b2"]) {
      expect(createShareSchema.safeParse({ title: "t", customShareId: good }).success).toBe(true);
    }
  });

  it("rejects malformed links", () => {
    for (const bad of [
      "abc", // too short
      "-team", // leading hyphen
      "team-", // trailing hyphen
      "my link", // space
      "a_b", // underscore
      "tëam", // non-ascii
      "x".repeat(33), // too long
    ]) {
      expect(createShareSchema.safeParse({ title: "t", customShareId: bad }).success).toBe(false);
    }
  });

  it("rejects reserved links case-insensitively", () => {
    expect(createShareSchema.safeParse({ title: "t", customShareId: "api" }).success).toBe(false);
    expect(createShareSchema.safeParse({ title: "t", customShareId: "DASHBOARD" }).success).toBe(
      false,
    );
  });
});

describe("updateShareSchema", () => {
  it("defaults to keeping the password and allows partial updates", () => {
    expect(updateShareSchema.parse({ title: "Renamed" })).toEqual({
      title: "Renamed",
      passwordMode: "keep",
    });
    expect(updateShareSchema.parse({ expiresIn: "1h" }).expiresIn).toBe("1h");
  });

  it("requires a strong password when enabling protection", () => {
    const missing = updateShareSchema.safeParse({ passwordMode: "set" });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues[0]?.path).toEqual(["password"]);

    expect(updateShareSchema.safeParse({ passwordMode: "set", password: "short" }).success).toBe(
      false,
    );
    const ok = updateShareSchema.safeParse({
      passwordMode: "set",
      password: "long-enough-password",
    });
    expect(ok.success).toBe(true);
    expect(updateShareSchema.safeParse({ passwordMode: "clear" }).success).toBe(true);
    expect(updateShareSchema.safeParse({ passwordMode: "drop" }).success).toBe(false);
  });
});

describe("item schemas", () => {
  it("defaults code language to plaintext", () => {
    const parsed = createItemSchema.parse({ type: "code", title: "main", content: "print(1)" });
    expect(parsed.type).toBe("code");
    if (parsed.type === "code") expect(parsed.language).toBe("plaintext");
  });

  it("accepts every advertised language", () => {
    for (const language of CODE_LANGUAGES) {
      expect(
        createItemSchema.safeParse({ type: "code", title: "t", content: "c", language }).success,
      ).toBe(true);
    }
    expect(
      createItemSchema.safeParse({ type: "code", title: "t", content: "c", language: "brainfuck" })
        .success,
    ).toBe(false);
  });

  it("rejects empty content and unknown item types", () => {
    expect(createItemSchema.safeParse({ type: "text", title: "t", content: "" }).success).toBe(
      false,
    );
    expect(createItemSchema.safeParse({ type: "binary", title: "t", content: "x" }).success).toBe(
      false,
    );
    expect(
      createItemSchema.safeParse({
        type: "text",
        title: "t",
        content: "x".repeat(CONTENT_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it("requires at least one change when updating an item", () => {
    expect(updateItemSchema.safeParse({}).success).toBe(false);
    expect(updateItemSchema.safeParse({ title: "New" }).success).toBe(true);
    expect(updateItemSchema.safeParse({ content: "" }).success).toBe(false);
    expect(updateItemSchema.safeParse({ language: "python" }).success).toBe(true);
  });

  it("validates reorder payloads", () => {
    expect(reorderItemsSchema.safeParse({ itemIds: [UUID] }).success).toBe(true);
    expect(reorderItemsSchema.safeParse({ itemIds: [] }).success).toBe(false);
    expect(reorderItemsSchema.safeParse({ itemIds: [UUID, UUID] }).success).toBe(false);
    expect(reorderItemsSchema.safeParse({ itemIds: ["not-a-uuid"] }).success).toBe(false);
    expect(
      reorderItemsSchema.safeParse({
        itemIds: Array.from(
          { length: 501 },
          (_, i) => `${UUID.slice(0, -4)}${String(i).padStart(4, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });
});

describe("upload and password schemas", () => {
  it("validates upload reservations", () => {
    expect(reserveUploadSchema.safeParse({ filename: "a.txt", size: 1 }).success).toBe(true);
    expect(reserveUploadSchema.safeParse({ filename: "a.txt", size: 0 }).success).toBe(false);
    expect(reserveUploadSchema.safeParse({ filename: "a.txt", size: 1.5 }).success).toBe(false);
    expect(reserveUploadSchema.safeParse({ filename: "   ", size: 10 }).success).toBe(false);
    expect(reserveUploadSchema.safeParse({ filename: "x".repeat(256), size: 10 }).success).toBe(
      false,
    );
  });

  it("accepts any non-empty password attempt (strength is enforced on set)", () => {
    expect(verifyPasswordSchema.safeParse({ password: "x" }).success).toBe(true);
    expect(verifyPasswordSchema.safeParse({ password: "" }).success).toBe(false);
    expect(verifyPasswordSchema.safeParse({ password: "x".repeat(129) }).success).toBe(false);
  });
});

describe("dashboardQuerySchema", () => {
  it("coerces and clamps query parameters", () => {
    const defaults = dashboardQuerySchema.parse({});
    expect(defaults).toEqual({ status: "all", sort: "created_desc", page: 1, perPage: 12 });

    const coerced = dashboardQuerySchema.parse({
      page: "3",
      perPage: "50",
      status: "password",
      q: "  report  ",
    });
    expect(coerced.page).toBe(3);
    expect(coerced.perPage).toBe(50);
    expect(coerced.status).toBe("password");
    expect(coerced.q).toBe("report");

    expect(dashboardQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ perPage: "51" }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ page: "abc" }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ status: "deleted" }).success).toBe(false);
    expect(dashboardQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
  });
});

describe("zodIssues", () => {
  it("flattens issues into path/message pairs", () => {
    const result = createShareSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = zodIssues(result.error);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.path).toBe("title");
      expect(typeof issues[0]?.message).toBe("string");
    }

    const rootIssue = zodIssues(new z.ZodError([{ code: "custom", path: [], message: "nope" }]));
    expect(rootIssue[0]).toEqual({ path: "(root)", message: "nope" });
  });
});
