import { PlayerManager } from './playerManager.js';
import { initOverlays } from './overlay.js';
const root = document.getElementById('root')!;
const pm = new PlayerManager();
pm.attach(root);
initOverlays(pm, [{ name: 'ATV News' }, { name: 'ATV Movies' }, { name: 'ATV Sports' }]);
// D-pad focus handling
let focusIdx = 0;
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') focusIdx++;
  if (e.key === 'ArrowLeft') focusIdx = Math.max(0, focusIdx-1);
  pm.onTileHover(`tile-${focusIdx}`);
  if (e.key === 'Enter') pm.play(`/api/resolve?id=tile-${focusIdx}`);
});
