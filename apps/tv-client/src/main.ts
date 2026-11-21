import { PlayerManager } from './playerManager.js';
import { initOverlays } from './overlay.js';
const root = document.getElementById('root')!;
const pm = new PlayerManager();
pm.attach(root);
initOverlays(pm, [{ name: 'ATV News' }, { name: 'ATV Movies' }, { name: 'ATV Sports' }]);
// Resolve the id through the Worker, then hand the media URL to the player.
async function playId(id: string) {
  const r = await fetch(`/api/resolve?id=${encodeURIComponent(id)}`);
  if (!r.ok) return;
  const { url } = await r.json();
  pm.play(url);
}
// D-pad focus handling
let focusIdx = 0;
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') focusIdx++;
  if (e.key === 'ArrowLeft') focusIdx = Math.max(0, focusIdx-1);
  pm.onTileHover(`tile-${focusIdx}`);
  if (e.key === 'Enter') playId(`tile-${focusIdx}`);
});
