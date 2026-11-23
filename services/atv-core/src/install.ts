import qrcode from "qrcode-generator";
import type { Env } from "./env";

// The Android workflow republishes one release and replaces its asset, so this
// path stays valid without the page being rebuilt: GitHub resolves "latest" to
// the release the last run created or updated.
const REPO_NAME = "atv-network-monorepo";
export const APK_ASSET = "atv-launcher.apk";

// QR geometry, in SVG units. Four modules of quiet zone is the smallest a
// phone camera should be asked to work with, which is also the encoder's own
// default (4 * cellSize). Kept here so the page, the test and anyone reading
// the SVG agree on what the numbers mean.
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Fire OS has no Chrome, so there is no Trusted Web Activity here: the APK is a
// WebView shell that is sideloaded once. The page exists because a TV remote is
// a poor way to type a release URL.
export function installPage(env: Env): string {
  const apk = escapeHtml(apkUrl(env.GITHUB_USERNAME));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Install ATV Network on Fire TV</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0b0f; color: #f5f5f7;
    font: 17px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 40px 22px 64px; }
  h1 { font-size: 32px; line-height: 1.15; margin: 0 0 10px; }
  h2 { font-size: 21px; margin: 40px 0 12px; }
  p { margin: 0 0 16px; color: #c9c9d4; }
  .lede { color: #9d9dac; }
  a.button { display: inline-block; margin: 10px 0 8px; padding: 16px 30px; border-radius: 12px;
    background: #f6821f; color: #0b0b0f; font-weight: 700; font-size: 19px; text-decoration: none; }
  .url { font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all;
    color: #8b8b9a; }
  figure.qr { margin: 26px 0; }
  figure.qr img { width: 220px; height: 220px; display: block; border-radius: 10px; background: #fff; }
  figure.qr figcaption { margin-top: 10px; color: #9d9dac; font-size: 15px; }
  ol { padding-left: 22px; }
  ol > li { margin-bottom: 18px; color: #c9c9d4; }
  ol > li strong { display: block; margin-bottom: 4px; color: #f5f5f7; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
  pre { background: #15151d; border: 1px solid #26262f; border-radius: 10px; padding: 14px 16px;
    overflow-x: auto; }
  ul { padding-left: 20px; color: #c9c9d4; }
  ul li { margin-bottom: 8px; }
  .note { border-left: 3px solid #f6821f; padding: 2px 0 2px 14px; color: #9d9dac; font-size: 15px; }
</style>
</head>
<body>
<main>
  <h1>ATV Network for Fire TV</h1>
  <p class="lede">A small WebView shell that loads the live guide from this Worker. Line-up and stream
    changes reach the TV without a new install.</p>

  <a class="button" href="${apk}">Download the APK</a>
  <p class="url">${apk}</p>

  <figure class="qr">
    <img src="/install/qr.svg" width="220" height="220" alt="QR code for the APK download">
    <figcaption>Scan with your phone to download the same file.</figcaption>
  </figure>

  <h2>Sideload it</h2>
  <ol>
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
  </ul>
</main>
</body>
</html>`;
}

// The page loads no script and nothing off-origin, so it gets a policy that says
// exactly that rather than living without one.
const PAGE_CSP =
  "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

export function handleInstall(env: Env): Response {
  return new Response(installPage(env), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The asset URL is resolved by GitHub on every visit, so a stale page only
      // risks a stale APK name, never a stale link.
      "Cache-Control": "public, max-age=300, s-maxage=600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": PAGE_CSP,
    },
  });
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
