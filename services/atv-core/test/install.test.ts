import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { APK_ASSET, QR_CELL, QR_MARGIN, apkUrl } from "../src/install";

// /install touches no KV: it renders a static page for whatever owner the
// deployment is configured with.
function makeEnv(username = "ajdhoward"): Env {
  return { GITHUB_USERNAME: username, SYSTEM_ENV: "test" } as unknown as Env;
}

async function get(path: string, env: Env = makeEnv()) {
  const res = await worker.fetch(new Request(`https://atv.test${path}`), env);
  return { res, text: await res.text() };
}

// Decodes the SVG the Worker actually served, not a matrix rebuilt in the test:
// the point is to catch a page whose code looks right but whose picture a phone
// cannot read. qrcode-generator draws each dark module as a path command, so the
// grid is recoverable from the markup.
function gridFromSvg(svg: string): { grid: boolean[][]; size: number; origin: number } {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  if (!viewBox) throw new Error("the QR SVG has no viewBox");
  const coords = [...svg.matchAll(/M(\d+),(\d+)l/g)].map((m) => [Number(m[1]), Number(m[2])]);
  if (!coords.length) throw new Error("the QR SVG has no modules");
  const origin = Math.min(...coords.map(([x]) => x));
  const modules = (Math.max(...coords.map(([x]) => x)) - origin) / QR_CELL + 1;
  const grid = Array.from({ length: modules }, () => new Array<boolean>(modules).fill(false));
  for (const [x, y] of coords) grid[(y - origin) / QR_CELL][(x - origin) / QR_CELL] = true;
  return { grid, size: Number(viewBox[1]), origin };
}

function decode(grid: boolean[][]): string | null {
  const quiet = 4;
  const scale = 4;
  const side = (grid.length + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid.length; col++) {
      if (!grid[row][col]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = (col + quiet) * scale + dx;
          const y = (row + quiet) * scale + dy;
          const at = (y * side + x) * 4;
          pixels[at] = pixels[at + 1] = pixels[at + 2] = 0;
          pixels[at + 3] = 255;
        }
      }
    }
  }
  return jsQR(pixels, side, side)?.data ?? null;
}

describe("install page", () => {
  it("links the release asset and the QR, and explains the sideload", async () => {
    const { res, text } = await get("/install");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(text).toContain(apkUrl("ajdhoward"));
    expect(text).toContain(`/install/qr.svg`);
    expect(text).toContain(APK_ASSET);
    // The two routes a phone user actually needs, and the two tools that do it.
    expect(text).toContain("Apps2Fire");
    expect(text).toContain("adb install -r");
  });

  it("does not let the page load anything it did not serve", async () => {
    const { res } = await get("/install");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("img-src 'self'");
  });

  it("answers the trailing-slash form a QR scanner may produce", async () => {
    const { res, text } = await get("/install/");
    expect(res.status).toBe(200);
    expect(text).toContain(apkUrl("ajdhoward"));
  });

  it("serves a QR that decodes back to the APK URL", async () => {
    const { res, text } = await get("/install/qr.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(text.startsWith("<svg")).toBe(true);

    const { grid, size, origin } = gridFromSvg(text);
    expect(grid.length).toBeGreaterThan(20);
    // A scanner needs the quiet zone, and the viewBox has to include it.
    expect(origin).toBe(QR_MARGIN);
    expect(size).toBe((grid.length + (QR_MARGIN / QR_CELL) * 2) * QR_CELL);
    expect(decode(grid)).toBe(apkUrl("ajdhoward"));
  });

  it("names the short /a address, which only the request's host can give", async () => {
    const { text } = await get("/install");
    expect(text).toContain("atv.test/a");
  });

  it("follows the GitHub owner the deployment is configured with", async () => {
    const env = makeEnv("another-owner");
    const page = await get("/install", env);
    expect(page.text).toContain(apkUrl("another-owner"));

    const qr = await get("/install/qr.svg", env);
    expect(decode(gridFromSvg(qr.text).grid)).toBe(apkUrl("another-owner"));
  });
});
