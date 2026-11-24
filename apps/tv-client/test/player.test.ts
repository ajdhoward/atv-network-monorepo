// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerManager } from "../src/playerManager.js";

beforeEach(() => {
  document.body.replaceChildren();
  // happy-dom does not implement media playback; the manager only needs these
  // calls not to throw, and individual tests spy on the instance they use.
  HTMLMediaElement.prototype.play = async () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.load = () => {};
});

describe("PlayerManager", () => {
  it("binds the ended listener once per element", () => {
    const pm = new PlayerManager();
    const video = document.createElement("video");
    const swap = vi.spyOn(pm, "swap");

    pm.bind(video);
    pm.bind(video);
    video.dispatchEvent(new Event("ended"));

    expect(swap).toHaveBeenCalledTimes(1);
    expect(video.dataset.atvEnded).toBe("1");
  });

  it("swaps the active and buffer elements and shows the new one", () => {
    const pm = new PlayerManager();
    pm.attach(document.createElement("div"));
    const active = pm.active;
    const buffer = pm.buffer;

    pm.swap();

    expect(pm.active).toBe(buffer);
    expect(pm.buffer).toBe(active);
    expect(pm.active.style.visibility).toBe("visible");
    expect(pm.buffer.style.visibility).toBe("hidden");
  });

  it("plays the resolved url on the active element", () => {
    const pm = new PlayerManager();
    pm.attach(document.createElement("div"));
    const play = vi.spyOn(pm.active, "play");

    pm.play("https://cdn.example/live.m3u8");

    expect(pm.active.getAttribute("src")).toBe("https://cdn.example/live.m3u8");
    expect(play).toHaveBeenCalled();
  });

  // A stream that 403s or hits a codec the TV cannot decode fires `error` on the
  // element. The grid is hidden by then, so without this the TV is a black screen.
  it("reports a media error with the channel that failed", () => {
    const onError = vi.fn();
    const pm = new PlayerManager({ onError });
    pm.attach(document.createElement("div"));
    pm.play("https://cdn.example/live.m3u8", "News 24");

    pm.active.dispatchEvent(new Event("error"));

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("News 24");
  });

  it("still swaps when no error handler was given", () => {
    const pm = new PlayerManager();
    pm.attach(document.createElement("div"));
    const swap = vi.spyOn(pm, "swap");

    pm.active.dispatchEvent(new Event("error"));
    pm.active.dispatchEvent(new Event("ended"));

    expect(swap).toHaveBeenCalledTimes(1);
  });

  // The overlay banner reads this; without it the paused banner named the first
  // channel in the lineup whatever was on screen.
  it("remembers the channel it was asked to play", () => {
    const pm = new PlayerManager();
    pm.attach(document.createElement("div"));

    pm.play("https://cdn.example/live.m3u8", "News 24");

    expect(pm.nowPlaying).toBe("News 24");
  });
});
