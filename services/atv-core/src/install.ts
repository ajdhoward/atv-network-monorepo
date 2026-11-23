import qrcode from "qrcode-generator";
import type { Env } from "./env";
import { escapeHtml, htmlResponse, renderPage } from "./page";

// The Android workflow republishes one release and replaces its asset, so this
// path stays valid without the page being rebuilt: GitHub resolves "latest" to
// the release the last run created or updated.
const REPO_NAME = "atv-network-monorepo";
export const APK_ASSET = "atv-launcher.apk";

// QR geometry, in SVG units. Four modules of quiet zone is the smallest a phone
// camera should be asked to work with, which is also the encoder's own default
// (4 * cellSize). Kept here so the page, the test and anyone reading the SVG
// agree on what the numbers mean.
export const QR_CELL = 4;
export const QR_MARGIN = QR_CELL * 4;

export function apkUrl(username: string): string {
  return `https://github.com/${encodeURIComponent(username.trim())}/${REPO_NAME}/releases/latest/download/${APK_ASSET}`;
}

// Server-side rather than in the page: no CDN, no client script, and the same
// SVG for every visitor, so it can be cached at the edge.
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: QR_CELL, margin: QR_MARGIN, scalable: true });
}

// Fire OS has no Chrome, so there is no Trusted Web Activity here: the APK is a
// WebView shell that is sideloaded once. The page exists because a TV remote is
// a poor way to type a release URL.
export function installPage(env: Env): string {
  const apk = escapeHtml(apkUrl(env.GITHUB_USERNAME));
  return renderPage(
    "Install ATV Network on Fire TV",
    `<h1>ATV Network for Fire TV</h1>
  <p class="lede">A small WebView shell that loads the live guide from this Worker. Line-up and stream
    changes reach the TV without a new install.</p>

  <a class="button" href="${apk}">Download the APK</a>
  <p class="url">${apk}</p>

  <figure class="qr">
    <img src="/install/qr.svg" width="220" height="220" alt="QR code for the APK download">
    <figcaption>Scan with your phone to download the same file.</figcaption>
  </figure>

  <h2>Sideload it</h2>
  <ol class="steps">
    <li>
      <strong>Get the APK onto your phone</strong>
      Tap the button above. Android may ask to allow installs from the browser; the file is the signed
      release asset from this repository.
    </li>
    <li>
      <strong>Allow unknown apps on the TV</strong>
      On the Fire TV: <em>Settings &#8594; My Fire TV &#8594; About</em>, then press the remote's centre
      button on <em>Fire TV Stick</em> seven times. Go back to
      <em>My Fire TV &#8594; Developer Options</em> and turn on <em>Install unknown apps</em> for the app
      you will use.
    </li>
    <li>
      <strong>Push it across</strong>
      On the same Wi-Fi, install <em>Apps2Fire</em> or <em>Bugjaeger</em> from the Play Store, pick the
      Fire TV in its device list, and upload <code>${APK_ASSET}</code>.
    </li>
    <li>
      <strong>Or fetch it on the TV</strong>
      Install <em>Downloader</em> on the Fire TV, open it, type the APK link above, and choose Install.
    </li>
    <li>
      <strong>Open ATV Network</strong>
      It appears in <em>Your Apps and Channels</em> on the Fire TV home screen. The first launch can
      take a few seconds while the guide loads.
    </li>
  </ol>

  <h2>Over ADB instead</h2>
  <pre>adb connect 192.168.1.42:5555
adb install -r ${APK_ASSET}</pre>
  <p class="note">That address is the TV's, not this Worker's, and port 5555 has to be enabled on it
    (Developer Options &#8594; ADB debugging).</p>

  <h2>What the app does</h2>
  <ul>
    <li>Loads this Worker's guide and player full-screen; no channel list is bundled.</li>
    <li>Stream links are resolved by the Worker and played over HTTPS; the TV never holds a token.</li>
    <li>No account, no local storage, no background service.</li>
    <li>If the Worker is unreachable it shows a retry screen instead of a blank TV.</li>
  </ul>

  <h2>If it will not install</h2>
  <ul>
    <li><strong>"App not installed"</strong> &mdash; an older copy was signed with a different key.
      Uninstall ATV Network (Settings &#8594; Applications &#8594; Manage Installed Applications) and
      install again.</li>
    <li><strong>Retry screen</strong> &mdash; the TV cannot reach the Worker. Check its Wi-Fi, then press
      Retry.</li>
  </ul>`,
  );
}

export function handleInstall(env: Env): Response {
  return htmlResponse(installPage(env));
}

export function handleInstallQr(env: Env): Response {
  return new Response(qrSvg(apkUrl(env.GITHUB_USERNAME)), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
