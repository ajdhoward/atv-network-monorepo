/**
 * Two <video> elements, one visible. `swap()` promotes the hidden one when the
 * current stream ends, so a channel change does not blank the screen; `play()`
 * replaces the visible one when a tile is picked.
 */
export class PlayerManager {
  /**
   * @param {{ onError?: (name: string | null) => void }} [options]
   *   `onError` fires when the element the viewer is watching fails to load or
   *   play: an expired link, a 403, a codec the TV cannot decode. The player owns
   *   no UI, so the caller decides what to show; without it the screen stays black.
   */
  constructor({ onError } = {}) {
    this.onError = onError ?? null;
    this.active = document.createElement("video");
    this.buffer = document.createElement("video");
    [this.active, this.buffer].forEach((v) => {
      v.crossOrigin = "anonymous";
      v.playsInline = true;
      v.preload = "auto";
      v.style.position = "absolute";
      v.style.inset = "0";
      v.style.width = "100%";
      v.style.height = "100%";
    });
    this.buffer.style.visibility = "hidden";
    this.hoverTimer = null;
    // What is on screen, for the overlays: the paused banner used to name the
    // first channel in the lineup because nothing recorded this.
    this.nowPlaying = null;
  }
  attach(root) {
    root.append(this.active, this.buffer);
    this.bind(this.active);
  }
  // Swap() replaces this.active, so every transition has to re-bind the handler.
  bind(video) {
    if (video.dataset.atvEnded) return;
    video.dataset.atvEnded = "1";
    video.addEventListener("ended", () => this.swap());
    // The grid is hidden while a stream plays, so a media error would otherwise
    // leave a black screen with nothing on it but the Back key.
    video.addEventListener("error", () => this.onError?.(this.nowPlaying));
  }
  detectProfile() {
    const is4K = window.screen.width >= 3840 || window.devicePixelRatio >= 2;
    return is4K
      ? { res: 2160, codec: "hevc", audio: "dd51" }
      : { res: 1080, codec: "hevc", audio: "stereo" };
  }
  onTileHover(id) {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(async () => {
      const r = await fetch(`/api/resolve?id=${encodeURIComponent(id)}`);
      if (r.ok) {
        const { url } = await r.json();
        this.prebuffer(url);
      }
    }, 350);
  }
  prebuffer(url) {
    this.buffer.src = url;
    this.buffer.load();
  }
  /**
   * Plays a resolved URL and remembers which channel it is for.
   *
   * @param {string} url the resolved stream URL; kept only in the element, never
   *   stored or logged
   * @param {string} [name] channel name for the overlays. Omitted leaves the
   *   previous name in place, which is what a swap between segments wants
   */
  play(url, name) {
    if (name) this.nowPlaying = name;
    this.bind(this.active);
    this.active.src = url;
    // textTracks is empty until metadata loads.
    this.active.addEventListener("loadedmetadata", () => this.setupForcedSubs(), { once: true });
    this.active.play();
  }
  /**
   * Promotes the hidden element and plays what it holds: normally nothing, or the
   * last thing `prebuffer` loaded, which is a tile hover and not necessarily the
   * channel that just ended.
   */
  swap() {
    const tmp = this.active;
    this.active = this.buffer;
    this.buffer = tmp;
    this.active.style.visibility = "visible";
    this.buffer.style.visibility = "hidden";
    this.bind(this.active);
    this.active.play();
  }
  setupForcedSubs() {
    for (const track of this.active.textTracks) {
      const label = (track.label || "").toLowerCase();
      const lang = (track.language || "").toLowerCase();
      if (
        (label.includes("forced") || label.includes("foreign")) &&
        (lang === "eng" || lang === "en")
      )
        track.mode = "showing";
      else track.mode = "disabled";
    }
  }
}
