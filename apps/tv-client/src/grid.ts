import type { Channel } from './guide.js';

type Options = {
  onFocus: (channel: Channel) => void;
  onPlay: (channel: Channel) => void;
};

export type Grid = {
  el: HTMLElement;
  readonly visible: boolean;
  setChannels(channels: Channel[]): void;
  move(dx: number, dy: number): void;
  playFocused(): void;
  notice(text: string): void;
  show(): void;
  hide(): void;
};

const ACCENT = '#d3e429';

export function createGrid(opts: Options): Grid {
  const root = document.createElement('div');
  root.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:40', 'display:flex', 'flex-direction:column',
    'gap:24px', 'padding:48px', 'overflow:auto', 'color:#fff',
    'background:radial-gradient(circle at 50% -10%,#161616,#000 70%)',
    'font-family:Inter,system-ui,sans-serif',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'ATV';
  title.style.cssText = 'font-size:34px;font-weight:800;letter-spacing:8px;';

  const status = document.createElement('div');
  status.style.cssText = 'font-size:15px;color:#9a9a9a;min-height:20px;';

  const list = document.createElement('div');
  list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;';

  const hint = document.createElement('div');
  hint.textContent = '← → ↑ ↓ move   ·   Enter play   ·   Back menu';
  hint.style.cssText = 'margin-top:auto;font-size:14px;color:#666;letter-spacing:1px;';

  root.append(title, status, list, hint);

  let channels: Channel[] = [];
  let focused = 0;
  let visible = true;

  function paint() {
    Array.from(list.children).forEach((node, i) => {
      const tile = node as HTMLElement;
      const active = i === focused;
      tile.style.borderColor = active ? ACCENT : '#242424';
      tile.style.transform = active ? 'scale(1.04)' : 'scale(1)';
      tile.style.boxShadow = active ? `0 0 0 2px ${ACCENT}` : 'none';
      tile.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }

  function focus(index: number) {
    if (!channels.length) return;
    focused = ((index % channels.length) + channels.length) % channels.length;
    paint();
    opts.onFocus(channels[focused]);
  }

  function render() {
    list.replaceChildren(
      ...channels.map((channel, i) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.style.cssText = [
          'display:flex', 'flex-direction:column', 'align-items:flex-start', 'gap:6px',
          'padding:18px 20px', 'background:#0d0d0d', 'border:1px solid #242424',
          'border-radius:14px', 'color:#fff', 'cursor:pointer', 'text-align:left',
          'transition:transform .12s ease, border-color .12s ease, box-shadow .12s ease',
          'font:inherit',
        ].join(';');

        const name = document.createElement('span');
        name.textContent = channel.name;
        name.style.cssText = 'font-size:20px;font-weight:600;';

        const meta = document.createElement('span');
        meta.textContent = [channel.category, channel.country].filter(Boolean).join(' · ');
        meta.style.cssText = 'font-size:13px;color:#8a8a8a;letter-spacing:1px;text-transform:uppercase;';

        tile.append(name, meta);
        tile.addEventListener('click', () => {
          focused = i;
          paint();
          opts.onPlay(channel);
        });
        tile.addEventListener('mouseenter', () => {
          focused = i;
          paint();
          opts.onFocus(channel);
        });
        return tile;
      }),
    );
    focused = 0;
    paint();
  }

  return {
    el: root,
    get visible() {
      return visible;
    },
    setChannels(next) {
      channels = Array.isArray(next) ? next : [];
      render();
      if (channels.length) opts.onFocus(channels[0]);
    },
    move(dx, dy) {
      if (!channels.length) return;
      const width = list.clientWidth || root.clientWidth;
      const columns = Math.max(1, Math.floor(width / 278));
      focus(focused + dx + dy * columns);
    },
    playFocused() {
      if (channels[focused]) opts.onPlay(channels[focused]);
    },
    notice(text) {
      status.textContent = text;
    },
    show() {
      visible = true;
      root.style.display = 'flex';
    },
    hide() {
      visible = false;
      root.style.display = 'none';
    },
  };
}
