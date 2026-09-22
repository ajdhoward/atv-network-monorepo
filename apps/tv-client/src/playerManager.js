export class PlayerManager {
  constructor() {
    this.active = document.createElement('video');
    this.buffer = document.createElement('video');
    [this.active, this.buffer].forEach(v => {
      v.crossOrigin = "anonymous"; v.playsInline = true; v.preload = "auto";
      v.style.position = "absolute"; v.style.inset = "0"; v.style.width="100%"; v.style.height="100%";
    });
    this.buffer.style.visibility = "hidden";
    this.hoverTimer = null;
  }
  attach(root) { root.append(this.active, this.buffer);
    this.active.addEventListener('ended', () => this.swap());
  }
  detectProfile() {
    const is4K = window.screen.width >= 3840 || window.devicePixelRatio >= 2;
    return is4K ? { res: 2160, codec: "hevc", audio: "dd51" } : { res: 1080, codec: "hevc", audio: "stereo" };
  }
  onTileHover(id) {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(async () => {
      const r = await fetch(`/api/resolve?id=${encodeURIComponent(id)}`);
      if (r.ok) { const { url } = await r.json(); this.prebuffer(url); }
    }, 350);
  }
  prebuffer(url) { this.buffer.src = url; this.buffer.load(); }
  play(url) { this.active.src = url; this.active.play(); this.setupForcedSubs(); }
  swap() {
    const tmp = this.active; this.active = this.buffer; this.buffer = tmp;
    this.active.style.visibility = "visible"; this.buffer.style.visibility = "hidden"; this.active.play();
  }
  setupForcedSubs() {
    for (const track of this.active.textTracks) {
      const label = (track.label || "").toLowerCase();
      const lang = (track.language || "").toLowerCase();
      if ((label.includes("forced") || label.includes("foreign")) && (lang === "eng" || lang === "en")) track.mode = "showing";
      else track.mode = "disabled";
    }
  }
}
