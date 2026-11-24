// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel } from "../src/guide.js";
import { createGrid } from "../src/grid";

function channel(id: string): Channel {
  return { id, name: id.toUpperCase(), country: "US", category: "news", genres: [] };
}

const channels = [channel("a"), channel("b"), channel("c")];

function makeGrid() {
  const onFocus = vi.fn();
  const onPlay = vi.fn();
  const grid = createGrid({ onFocus, onPlay });
  document.body.replaceChildren(grid.el);
  return { grid, onFocus, onPlay };
}

const tiles = (el: HTMLElement) => Array.from(el.querySelectorAll("button"));

beforeEach(() => {
  document.body.replaceChildren();
});

describe("createGrid", () => {
  it("renders one tile per channel and focuses the first", () => {
    const { grid, onFocus } = makeGrid();

    grid.setChannels(channels);

    expect(tiles(grid.el)).toHaveLength(3);
    expect(tiles(grid.el)[0].getAttribute("aria-current")).toBe("true");
    expect(tiles(grid.el)[1].getAttribute("aria-current")).toBe("false");
    expect(onFocus).toHaveBeenCalledWith(channels[0]);
  });

  // The D-pad wraps; a move that fell off the end would leave the viewer on a
  // tile they cannot see highlighted.
  it("wraps focus forwards and backwards", () => {
    const { grid, onFocus } = makeGrid();
    grid.setChannels(channels);
    onFocus.mockClear();

    grid.move(1, 0);
    grid.move(1, 0);
    grid.move(1, 0);
    expect(onFocus).toHaveBeenLastCalledWith(channels[0]);

    grid.move(-1, 0);
    expect(onFocus).toHaveBeenLastCalledWith(channels[2]);
  });

  it("plays the focused channel", () => {
    const { grid, onPlay } = makeGrid();
    grid.setChannels(channels);

    grid.move(1, 0);
    grid.playFocused();

    expect(onPlay).toHaveBeenCalledWith(channels[1]);
  });

  it("does nothing on an empty lineup", () => {
    const { grid, onFocus, onPlay } = makeGrid();

    grid.setChannels([]);

    expect(() => grid.move(1, 0)).not.toThrow();
    expect(() => grid.playFocused()).not.toThrow();
    expect(tiles(grid.el)).toHaveLength(0);
    expect(onFocus).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();
  });

  // The guide is the one payload the client does not control, so a missing
  // `channels` array must paint an empty grid rather than throw.
  it("treats a non-array lineup as empty", () => {
    const { grid } = makeGrid();

    expect(() => grid.setChannels(undefined as unknown as Channel[])).not.toThrow();
    expect(tiles(grid.el)).toHaveLength(0);
  });

  it("shows a notice, then clears it", () => {
    const { grid } = makeGrid();

    grid.notice("Tuning News 24…");
    expect(grid.el.textContent).toContain("Tuning News 24…");

    grid.notice("");
    expect(grid.el.textContent).not.toContain("Tuning News 24…");
  });

  it("toggles visibility", () => {
    const { grid } = makeGrid();

    grid.hide();
    expect(grid.visible).toBe(false);
    expect(grid.el.style.display).toBe("none");

    grid.show();
    expect(grid.visible).toBe(true);
    expect(grid.el.style.display).toBe("flex");
  });

  // A click focuses and plays, but the hover prefetch is driven by `mouseenter`:
  // `onFocus` is not re-fired on click, and a test that expects it would encode a
  // behaviour the grid does not have.
  it("plays the tile that was clicked and marks it current", () => {
    const { grid, onPlay } = makeGrid();
    grid.setChannels(channels);

    tiles(grid.el)[2].click();

    expect(onPlay).toHaveBeenCalledWith(channels[2]);
    expect(tiles(grid.el)[2].getAttribute("aria-current")).toBe("true");
    expect(tiles(grid.el)[0].getAttribute("aria-current")).toBe("false");
  });
});
