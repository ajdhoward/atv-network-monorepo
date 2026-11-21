export function initOverlays(playerManager, channels) {
  const dog = document.createElement("div");
  dog.textContent = "ATV";
  dog.className = "dog";
  dog.style.cssText =
    "position:absolute;top:24px;right:24px;opacity:0;transition:opacity .4s,transform .4s;background:rgba(0,0,0,.4);padding:4px 10px;border-radius:8px;color:white;font-weight:700;z-index:10;";
  // Capture on document: the player swaps video elements, so a listener bound to
  // the initial one stops firing after the first transition.
  document.addEventListener(
    "play",
    () => {
      dog.style.opacity = "0.7";
      setTimeout(() => (dog.style.opacity = "0"), 4000);
    },
    true,
  );
  document.body.appendChild(dog);
  let paused = false;
  const identHub = document.createElement("div");
  identHub.style.cssText =
    "position:absolute;inset:0;background:rgba(0,0,0,.6);display:none;place-items:center;z-index:20;";
  identHub.innerHTML = `<video id="identLoop" loop muted autoplay style="width:60%;border-radius:16px"></video>`;
  document.body.appendChild(identHub);
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:absolute;bottom:0;left:0;right:0;transform:translateY(100%);transition:.3s;background:#101010;color:#fff;padding:16px;z-index:30;";
  banner.innerHTML = `<div id="bannerNow"></div><div id="bannerNext" style="display:flex;gap:12px;margin-top:8px;overflow:auto"></div>`;
  document.body.appendChild(banner);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      paused = !paused;
      if (paused) {
        playerManager.active.pause();
        identHub.style.display = "grid";
        document.getElementById("identLoop").src = "/api/idents/random";
      } else {
        identHub.style.display = "none";
        playerManager.active.play();
      }
    }
    if (paused && e.key !== " ") {
      banner.style.transform = "translateY(0)";
      document.getElementById("bannerNow").textContent = `Now Paused: ${channels[0]?.name}`;
      // textContent, never innerHTML: names come from the seeded lineup and must
      // not be parsed as markup.
      document.getElementById("bannerNext").replaceChildren(
        ...channels.map((c) => {
          const chip = document.createElement("span");
          chip.style.cssText = "border:1px solid #333;padding:6px 10px;border-radius:20px";
          chip.textContent = c.name;
          return chip;
        }),
      );
      setTimeout(() => (banner.style.transform = "translateY(100%)"), 4000);
    }
  });
}
