// @vitest-environment happy-dom
//
// The only file in this package that renders JSX. The panel hides its
// decorations — a folder emoji, a breadcrumb slash, a link-state icon, a pending
// dash — with `aria-hidden`, and no logic test can see that. `spoken()` drops
// everything marked hidden, so a decoration that loses its wrapper shows up in an
// assertion with the glyph in it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { LINK_ICON } from "../src/links";

// React only runs act() outside a renderer when this is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FOLDERS = ["Idents", "News", "Lineup", "Backups"];

// Three channels, one per link state, so all three icons render.
const HEALTH = {
  status: "ok",
  config: { seeded: true, channels: 3, schemaMatches: true, checksumMatches: true },
  resolve: { configured: 1, invalid: 1, missing: 1 },
};

const GUIDE = {
  channels: [
    { id: "a", name: "ATV One", country: "US", category: "news", genres: [] },
    { id: "b", name: "ATV Two", country: "US", category: "news", genres: [] },
    { id: "c", name: "ATV Three", country: "US", category: "news", genres: [] },
  ],
  nextCursor: null,
};

const RESOLVE = { resolved: [{ id: "a" }], missing: ["b"], invalid: ["c"] };

let container: HTMLDivElement;
let root: Root;

/** The announcement: anything inside `aria-hidden` is not part of it. */
function spoken(el: Element | null): string {
  if (!el) throw new Error("expected an element");
  const copy = el.cloneNode(true) as Element;
  for (const hidden of Array.from(copy.querySelectorAll('[aria-hidden="true"]'))) hidden.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** What is on screen, decoration included. */
function shown(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** A fetch that answers like the worker without a network. */
function stubFetch(handler: (url: string) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = handler(String(url));
      const answer = body instanceof Promise ? await body : body;
      return { ok: true, status: 200, json: async () => answer } as Response;
    }),
  );
}

function never() {
  return new Promise<never>(() => {});
}

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) await act(async () => {});
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (candidate) => spoken(candidate) === label,
  );
  if (!found) throw new Error(`no button announced as "${label}"`);
  return found;
}

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<App />);
  });
  await flush();
}

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("the panel's decorations", () => {
  // The dash is the value of every card until /api/health answers. It says a
  // count is missing, which the spoken text has to say in words.
  it("shows the pending dash and says what it means instead of reading it out", async () => {
    stubFetch(never);
    await render();

    const dashes = Array.from(container.querySelectorAll('[aria-hidden="true"]')).filter(
      (node) => node.textContent === "—",
    );

    expect(dashes).toHaveLength(4);
    for (const dash of dashes) {
      expect(shown(dash.parentElement)).toBe("—not checked yet");
      expect(spoken(dash.parentElement)).toBe("not checked yet");
    }
    // One placeholder per card, and no more: a fifth would be a stray. (The
    // token label has an em dash of its own, which is prose, not a value.)
    expect(container.textContent?.match(/not checked yet/g)).toHaveLength(4);
  });

  it("names a folder row without its emoji and the root crumb without its slash", async () => {
    stubFetch(never);
    await render();

    const rows = FOLDERS.map((folder) => button(folder));
    expect(rows.map(spoken)).toEqual(FOLDERS);
    for (const row of rows) expect(shown(row)).toBe(`📁 ${spoken(row)}`);

    const crumbs = Array.from(container.querySelectorAll("nav button"));
    expect(crumbs.map(spoken)).toEqual(["ATV Network"]);
    expect(crumbs.map(shown)).toEqual(["/ATV Network"]);
  });

  it("speaks each breadcrumb step as the folder and leaves the slash on screen", async () => {
    stubFetch(never);
    await render();

    await act(async () => button("Idents").click());
    await act(async () => button("News").click());

    const crumbs = Array.from(container.querySelectorAll("nav button")) as HTMLButtonElement[];
    expect(crumbs.map(spoken)).toEqual(["ATV Network", "Idents", "News"]);
    expect(crumbs.map(shown)).toEqual(["/ATV Network", "/Idents", "/News"]);
    // The step you are on is disabled, which is what keeps it out of the Tab
    // order; the ones above it are the way back.
    expect(crumbs.map((crumb) => crumb.disabled)).toEqual([false, false, true]);
  });

  it("says whether the Drive proxy is live, and explains the off state", async () => {
    stubFetch((url) => (url === "/api/health" ? { ...HEALTH, streamSigningKeySet: false } : GUIDE));
    await render();

    const line =
      Array.from(container.querySelectorAll("p")).find((element) =>
        shown(element).startsWith("Drive proxy:"),
      ) ?? null;
    // `LIVE`/`OFF` is the whole point: a deployment with no key still answers
    // `ok`, so the channel counts alone cannot show a dead proxy.
    expect(spoken(line)).toBe("Drive proxy: OFF");
    expect(spoken(container)).toContain("Drive proxy is off");
  });

  it("keeps the link-state icon on screen and out of the announcement", async () => {
    stubFetch((url) => {
      if (url === "/api/health") return HEALTH;
      if (url.startsWith("/api/guide")) return GUIDE;
      return RESOLVE;
    });
    await render();

    expect(shown(container)).not.toContain("not checked yet");

    await act(async () => button("Check stream links").click());
    await flush();

    // Scoped by `code`: the unhealthy-coverage fixture also renders a problems list.
    const list = Array.from(container.querySelectorAll("ul")).find((ul) =>
      ul.querySelector("code"),
    );
    const items = Array.from(list?.querySelectorAll("li") ?? []);

    expect(items.map(spoken)).toEqual([
      "ATV One a - link ready",
      "ATV Two b - no link",
      "ATV Three c - link is not a usable https URL",
    ]);
    expect(items.map(shown)).toEqual([
      "✅ ATV One a - link ready",
      "❌ ATV Two b - no link",
      "⚠️ ATV Three c - link is not a usable https URL",
    ]);
    // Every icon the panel knows about, not a list repeated here.
    for (const item of items) {
      for (const icon of Object.values(LINK_ICON)) expect(spoken(item)).not.toContain(icon);
    }
  });
});
