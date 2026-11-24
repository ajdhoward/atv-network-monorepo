# Playback formats: what the lineup serves, and what the shell can play

Objective 1 is "it plays". This document is what is known about the two halves of that sentence —
the format a channel resolves to, and whether the thing on the TV can decode it — and, more
importantly, which half is currently unproven.

## What the answer is today

- **The lineup's format is whatever the provider gives.** `ATV_GDRIVE_MAP` / KV `gdrive_map` links are
  handed to the TV verbatim (unless they are Drive links, which the Worker proxies), and a TorBox
  mapping is exchanged for a CDN link at resolve time. Nothing in `resolver.ts` or `torbox.ts` looks at
  the container or the codec, so the Worker cannot tell you what format a channel is.
- **`profile` is not a format.** `/api/resolve` answers `profile: "1080p_hevc"` for every channel — it is
  a fixed string in `resolver.ts`, not a report from the provider. Do not read it as "this link is HEVC".
- **The repository's own expectation is HLS.** Every fixture, every route test and `check-streams`' own
  content-type branch speaks `.m3u8`: `scripts/fixtures/ci-lineup.json` maps both channels to playlists,
  and `services/atv-core/src/stream.ts` describes a `.m3u8` as "a playlist it cannot follow". That is
  the shape the code was written against, not a measurement of the operator's lineup.
- **The measurable answer is the audit.** `pnpm streams --probe` follows each resolved link, prints its
  content type, and now ends with a `Formats:` tally plus a warning when any link is an HLS playlist.
  That is the command that answers "what does this lineup actually serve", because it is the only one
  that looks at the bytes. Run it after L4 seeds real links.

## What the player is

`apps/tv-client/src/playerManager.js` is two `<video>` elements with a `src` and a `play()`. There is no
Media Source Extensions code, no HLS library, and no capability detection; `apps/tv-client/package.json`
has one devDependency (`vite`) and no runtime dependency at all. A bare `<video src>` plays the
progressive formats the platform decodes (MP4/H.264, typically), and it plays HLS only if the WebView
implements HLS natively for that element. A media error is reported as "would not play — press Enter to
try again", which is the same sentence for a dead link, a 403 and an unsupported container.

## What the shell is

`android/.../MainActivity.java` is a full-screen `WebView` loading the Worker: JavaScript and DOM storage
on, `mediaPlaybackRequiresUserGesture(false)` so a programmatic `play()` is not blocked, mixed content
never allowed, no user-agent override, no debugging bridge. `android/app/build.gradle` declares
`minSdk 21` (with the comment that Fire OS 5 — Fire TV Stick gen 1/2 — is API 22) through `targetSdk 34`.

That range is the problem: the WebView is Amazon's Chromium fork (AWV), its version is whatever the
device and Fire OS update installed, and this app cannot choose or query it. A gen-1/2 Stick runs a
WebView several years older than a current 4K Max. The same page therefore runs on different media
stacks in the same household.

## What Chromium actually does with `<video src="….m3u8">`

There is no single answer, which is why this is written down rather than assumed:

- **Not standard.** Native HLS in a `<video>` element is a Safari feature. Chromium's playbook is MSE
  plus a JavaScript library. Wowza's own guide says native HLS is "possible, but unreliable" on Android
  and flatly unavailable in desktop Chromium.
- **Chromium has been adding its own HLS player.** A built-in HLS implementation landed behind a flag
  and was enabled around Chromium 135, and its gaps are public: one issue reports HEVC-in-MPEG-TS
  playing audio only, where the previous Android media path worked; another reports playlists failing
  to demux at all. Availability and behaviour therefore depend on the WebView build.
- **MSE plus `hls.js` is the portable path.** hls.js requires MSE with `video/mp4` input and lists
  Chrome for Android 5+ as supported — which is a lower bar than any AWV build's native HLS, and it is
  MIT-licensed. It is a real dependency (bundle weight, and a second code path for MP4 links), so it is
  a `decisions.md` question, not something to slip into a client change.

## What this means, stated honestly

**Nothing here has been played on a Fire TV.** The two claims that matter — "the shell plays HLS" and
"the shell does not play HLS" — are both unverified, and they are not even one claim: they can differ
per device in the same household. `PASS … hls playlist` from `pnpm streams --probe` proves the CDN
answered a playlist; it says nothing about whether the TV can follow it.

The only test that settles it is on hardware, and it is cheap once a TV is in hand (L5):

1. Resolve one HLS channel and one MP4 channel, and play each for a minute.
2. Record which played. If the HLS one fails, the `<video>` error code is the evidence: `4`
   (`MEDIA_ERR_SRC_NOT_SUPPORTED`) means this element cannot handle the source at all, as opposed to a
   network or decode error.
3. Record the WebView build, so the answer can be attached to a device and a Fire OS version:
   `adb shell dumpsys package com.amazon.webview.chromium | grep versionName`.
4. Repeat on a second device type if the household has one, because "the TV" is not one media stack.

## If HLS does not play

Three options, in the order they are cheapest to justify — the first two need no new dependency:

- **Say so.** Have the client name the cause instead of "would not play": a resolved playlist the
  element cannot handle should read as "this TV cannot play this channel's format". That needs
  capability detection and a client change, and it turns a mystery into a sentence.
- **Serve only what plays.** If the lineup can be MP4 (TorBox direct files, for instance), prefer those
  and treat `.m3u8` mappings as unsupported. No code change to the player; a rule for the operator.
- **Bundle `hls.js`.** The general fix: MSE plus a JavaScript player covers every AWV build that has
  MSE, at the cost of a dependency and a second playback path. Worth it only if the lineup is largely
  HLS and the hardware is old enough to lack native support — which is exactly what L5 measures.

The proposal and the three options are in [`agents/decisions.md`](agents/decisions.md) (2026-11-24,
"the player cannot tell you the TV cannot play this format").

## What is known for certain

- The Worker does not filter or transcode: whatever the provider returns is what the TV is asked to
  play, in whatever container it arrives.
- The player has no HLS support of its own, so a playlist depends entirely on the WebView.
- The audit can now report the format mix of the whole lineup in one line, without printing a link.
- No device has been tested. L5's notes are where the per-device answer belongs, not this document.
