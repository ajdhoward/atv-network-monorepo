// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { initOverlays } from "../src/overlay.js";

const channel = (name: string) => ({
  id: name,
  name,
  country: "US",
  category: "news",
  genres: [],
});

beforeEach(() => {
  document.body.replaceChildren();
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
});

describe("initOverlays", () => {
  it("renders channel chips as text, never as markup", () => {
    const player = { active: document.createElement("video") };
    const hostile = '<img src=x onerror="alert(1)">';
    initOverlays(player, [channel(hostile)]);

    // Space pauses and opens the ident hub; the next key renders the banner.
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));

    const next = document.getElementById("bannerNext");
    expect(next).not.toBeNull();
    expect(next!.querySelector("img")).toBeNull();
    expect(next!.textContent).toBe(hostile);
    // The chip exists, so the text assertion is not passing on an empty banner.
    expect(next!.children).toHaveLength(1);
  });
});
