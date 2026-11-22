import { PlayerManager } from "./playerManager.js";
import { initOverlays } from "./overlay.js";
import { loadGuide, type Channel } from "./guide.js";
import { createGrid } from "./grid.js";
import { DEFAULT_RETRY_MS, resolveWithRetry } from "./resolve.js";

const root = document.getElementById("root")!;
const pm = new PlayerManager();
pm.attach(root);

const grid = createGrid({
  onFocus: (channel) => pm.onTileHover(channel.id),
  onPlay: (channel) => void play(channel),
});
root.appendChild(grid.el);

async function play(channel: Channel) {
  grid.notice(`Tuning ${channel.name}…`);
  try {
    const result = await resolveWithRetry(channel.id, {
      maxWaitMs: DEFAULT_RETRY_MS,
      onRetry: () => grid.notice(`${channel.name} is busy — retrying…`),
    });
    if (result.kind === "retry") {
      // Still limited after the retry: the channel is fine, the allowance is
      // not, so keep the grid up and let Enter try again rather than saying it
      // is unavailable.
      grid.notice(`${channel.name} is busy — press Enter to try again`);
      return;
    }
    if (result.kind === "unavailable") {
      grid.notice(`${channel.name} is unavailable right now`);
      return;
    }
    if (result.kind === "missing") {
      grid.notice(`${channel.name} has no stream configured`);
      return;
    }
    grid.notice("");
    grid.hide();
    pm.play(result.url);
  } catch {
    grid.notice(`${channel.name} is unavailable right now`);
  }
}

loadGuide()
  .then(({ channels, stale }) => {
    grid.setChannels(channels);
    initOverlays(pm, channels.length ? channels : [{ name: "ATV" }]);
    if (!channels.length) grid.notice("No channels available right now.");
    else if (stale) grid.notice("Showing the last saved guide — reconnecting…");
  })
  .catch(() => {
    grid.notice("Guide unavailable — reload to retry.");
  });

// D-pad / remote handling: the grid owns focus while it is on screen.
document.addEventListener("keydown", (e) => {
  switch (e.key) {
    case "ArrowRight":
    case "ArrowLeft":
    case "ArrowUp":
    case "ArrowDown":
      e.preventDefault();
      if (!grid.visible) {
        grid.show();
        return;
      }
      if (e.key === "ArrowRight") grid.move(1, 0);
      if (e.key === "ArrowLeft") grid.move(-1, 0);
      if (e.key === "ArrowDown") grid.move(0, 1);
      if (e.key === "ArrowUp") grid.move(0, -1);
      return;
    case "Enter":
      e.preventDefault();
      if (grid.visible) grid.playFocused();
      else grid.show();
      return;
    case "Escape":
    case "Backspace":
    case "BrowserBack":
      e.preventDefault();
      grid.show();
      return;
  }
});
