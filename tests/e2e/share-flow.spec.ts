import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Full-stack browser smoke test:
 *
 *   create a collection -> add code/note/file -> set a password ->
 *   open it as an anonymous visitor -> unlock -> preview a CSV and a PDF ->
 *   download ZIP -> revoke -> confirm the gate -> delete -> confirm 404.
 *
 * It runs against the real Next.js server and PostgreSQL database. The share is
 * unique per run and deleted at the end, so repeated runs do not accumulate
 * data. Uploads go through the proxied transport (no Supabase credentials are
 * required for this flow).
 */

const PASSWORD = "e2e-password-123";

test("guest can build, protect, view, export, revoke, and delete a collection", async ({
  page,
  browser,
}) => {
  const title = `E2E collection ${Date.now()}`;

  // --- Create the collection -------------------------------------------------
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: "New collection", level: 1 })).toBeVisible();
  // Radix renders the selected option only after hydration. Waiting for it
  // prevents clicks from racing the client bundle in the dev server.
  await expect(page.getByRole("combobox", { name: "Link expires" })).toContainText("7 days");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill("Created by the Playwright end-to-end suite.");
  await page.getByRole("button", { name: "Create collection" }).click();

  await expect(page.getByText("Share link", { exact: true })).toBeVisible();
  const urlInput = page.getByLabel("Share URL");
  await expect(urlInput).not.toHaveValue("");
  const shareUrl = await urlInput.inputValue();
  expect(shareUrl).toContain("/s/");

  // The QR dialog generates its image client-side on demand.
  await page.getByRole("button", { name: "QR", exact: true }).click();
  await expect(page.getByAltText(`QR code that opens ${shareUrl}`)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByAltText(`QR code that opens ${shareUrl}`)).toBeHidden();

  // --- Add a code item -------------------------------------------------------
  await page.getByRole("button", { name: "Code", exact: true }).click();
  const itemTitle = page.locator("#item-title");
  await expect(itemTitle).toHaveValue("Untitled snippet");
  await itemTitle.fill("hello.ts");
  await page.locator("#item-language").click();
  await page.getByRole("option", { name: "typescript", exact: true }).click();

  const editor = page.getByLabel("Code for hello.ts");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("export const answer = 42;");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  // --- Add a text note -------------------------------------------------------
  await page.getByRole("button", { name: "Note", exact: true }).click();
  await expect(itemTitle).toHaveValue("Untitled note");
  await itemTitle.fill("README note");
  await page.getByLabel("Content of README note").fill("Hello from the Playwright suite.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  // --- Upload files (proxy transport) ---------------------------------------
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "sample.csv"));
  const itemList = page.getByRole("list", { name: "Collection items" });
  await expect(itemList.getByText("sample.csv").first()).toBeVisible({ timeout: 20_000 });

  await page
    .locator('input[type="file"]')
    .setInputFiles(path.join(__dirname, "fixtures", "sample.pdf"));
  await expect(itemList.getByText("sample.pdf").first()).toBeVisible({ timeout: 20_000 });

  // --- Protect with a password ----------------------------------------------
  await page.locator("#settings-password-mode").click();
  await page.getByRole("option", { name: "Set a password" }).click();
  await page.locator("#settings-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  // --- The collection appears on the guest dashboard ------------------------
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your collections" })).toBeVisible();
  await expect(page.getByRole("link", { name: title })).toBeVisible();

  // --- Anonymous visitor: password gate -------------------------------------
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  // Preview bytes must never be blocked by the page CSP; surface any violation.
  const viewerConsoleErrors: string[] = [];
  viewer.on("console", (message) => {
    if (message.type() === "error") viewerConsoleErrors.push(message.text());
  });
  await viewer.goto(shareUrl);
  await expect(viewer.getByText("Password required")).toBeVisible();
  await expect(viewer.getByText(title, { exact: true })).toBeVisible();

  await viewer.locator("#share-password").fill(PASSWORD);
  await viewer.getByRole("button", { name: "Unlock collection" }).click();
  await expect(viewer.getByRole("heading", { name: title, level: 1 })).toBeVisible();

  // The first item is server-rendered: the code snippet.
  await expect(viewer.locator(".cm-content")).toContainText("export const answer = 42;");

  // --- File preview + ZIP export --------------------------------------------
  await viewer.getByRole("button", { name: /sample\.csv/ }).click();
  await expect(viewer.getByRole("table")).toBeVisible();
  await expect(viewer.getByRole("cell", { name: "Ada" })).toBeVisible();

  // The PDF preview frames the authorized content route (same-origin, so the
  // page CSP allows it) and never redirects to third-party storage URLs.
  await viewer.getByRole("button", { name: /sample\.pdf/ }).click();
  const pdfFrame = viewer.locator('iframe[title^="PDF preview"]');
  await expect(pdfFrame).toBeVisible();
  const pdfSource = await pdfFrame.getAttribute("src");
  expect(pdfSource).toBeTruthy();
  expect(pdfSource).toContain("/content");
  const pdfResponse = await viewer.request.get(pdfSource!);
  expect([200, 206]).toContain(pdfResponse.status());
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
  expect(pdfResponse.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(pdfResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(pdfResponse.headers()["location"]).toBeUndefined();

  const downloadPromise = viewer.waitForEvent("download", {
    // Headless Chromium has no PDF viewer and downloads the framed PDF; pin
    // this wait to the ZIP export so the stray download cannot satisfy it.
    predicate: (candidate) => candidate.url().includes("/download-all"),
  });
  await viewer.getByRole("link", { name: "Download all" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect(fs.statSync(downloadPath!).size).toBeGreaterThan(100);

  // --- Revoke ----------------------------------------------------------------
  const shareId = new URL(shareUrl).pathname.split("/").pop();
  await page.goto(`/manage/${shareId}`);
  // Same hydration barrier for the builder's client controls.
  await expect(page.getByRole("combobox", { name: "Password protection" })).not.toHaveText("");
  await page.getByRole("button", { name: "Revoke link" }).click();
  await page.getByRole("button", { name: "Revoke permanently" }).click();
  await expect(page.getByText("Link revoked. Nobody can open it anymore.")).toBeVisible();

  await viewer.reload();
  await expect(viewer.getByText("This link was revoked")).toBeVisible();

  // --- Delete ---------------------------------------------------------------
  await page.getByRole("button", { name: "Delete collection" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByText("Collection deleted, including its stored files.")).toBeVisible();

  await viewer.goto(shareUrl);
  await expect(viewer.getByRole("heading", { name: "This share does not exist" })).toBeVisible();

  // No CSP violation was logged while previewing: framed/streamed bytes must
  // stay same-origin (this is the regression guard for blocked PDF previews).
  expect(viewerConsoleErrors.join("\n")).not.toMatch(
    /ERR_BLOCKED_BY_CSP|violates the following Content Security Policy/,
  );

  await viewerContext.close();
});

test("guest-only deployment explains accounts and starts new visitors empty", async ({ page }) => {
  // Brand icons ship with the app (the default Next.js favicon must not return).
  const favicon = await page.request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toContain("image/x-icon");
  const vectorIcon = await page.request.get("/icon.svg");
  expect(vectorIcon.status()).toBe(200);
  expect(vectorIcon.headers()["content-type"]).toContain("image/svg+xml");

  await page.goto("/login");
  // Accounts are optional (Supabase Auth). On deployments where they are
  // configured, the sign-in screen replaces the guest-only explainer, so this
  // scenario does not apply.
  test.skip(
    !(await page.getByText("Guest-only deployment", { exact: true }).isVisible()),
    "Supabase Auth is enabled on this deployment",
  );
  await expect(page.getByText("Guest-only deployment", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a collection" }).first()).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("No sessions on this browser yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Create a collection/ }).first()).toBeVisible();
});
