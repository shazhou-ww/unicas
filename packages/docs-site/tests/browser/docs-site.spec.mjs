import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const DIST = resolve(import.meta.dirname, "../../dist");
/** @type {Record<string, string>} */
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** @type {import("node:http").Server} */
let server;
let baseUrl = "";

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.endsWith("/")) pathname += "index.html";
    else if (!extname(pathname)) pathname += "/index.html";
    const filePath = resolve(DIST, pathname.replace(/^\/+/, ""));
    const relativePath = relative(DIST, filePath);
    if (relativePath === ".." || relativePath.startsWith("../")
      || relativePath.startsWith("..\\") || isAbsolute(relativePath)) {
      response.writeHead(400).end();
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile(join(DIST, "404.html")));
    }
  });
  await new Promise((resolveListen) => {
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolveListen(undefined));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("docs test server did not bind a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise((resolveClose, reject) => server.close((error) => (
    error ? reject(error) : resolveClose(undefined)
  )));
});

test("keeps desktop navigation and article content within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${baseUrl}/cas-architecture/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator("article.document h1")).toContainText("CAS Architecture");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const sidebar = await page.locator(".sidebar").boundingBox();
  const article = await page.locator("article.document").boundingBox();
  if (!sidebar || !article) throw new Error("desktop documentation layout is not measurable");
  expect(sidebar.x + sidebar.width).toBeLessThanOrEqual(article.x);
});

test("opens and closes mobile navigation without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/cas-architecture/`, { waitUntil: "domcontentloaded" });
  const menu = page.locator(".menu-button");
  await expect(menu).toHaveAccessibleName("Open documentation navigation");
  await expect(menu).toBeVisible();
  await expect(page.locator(".sidebar")).not.toBeInViewport();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".sidebar")).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel("Documentation navigation", { exact: true })
    .getByRole("link", { name: "CAS Binary Format" })
    .click();
  await expect(page).toHaveURL(/\/cas-binary-format\/$/);
  await expect(page.locator("body")).not.toHaveClass(/nav-open/);
});

test("mounts the interactive API reference from the generated OpenAPI artifact", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/app-user-api/reference/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("#api-reference")?.childElementCount ?? 0) > 0);
  await expect(page.locator("#api-reference")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const openApiResponse = await page.request.get(`${baseUrl}/openapi/app-space-v1.openapi.json`);
  expect(openApiResponse.ok()).toBe(true);
  expect((await openApiResponse.json()).info.title).toBe("UniCAS Space API");
});
