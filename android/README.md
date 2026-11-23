# ATV launcher (Fire OS)

One screen: a full-screen `WebView` pointed at the Worker's TV client. The channel list, the player and
every stream come from the server, so this app only changes when the shell itself does.

## Why it is this small

The obvious ways to put a web app on Android were each considered first, since a bespoke shell is the
last resort:

- **Trusted Web Activity** is Google's supported answer, and it needs Chrome on the device. Fire OS
  ships Amazon's WebView and no Chrome, so a TWA cannot launch there at all.
- **Capacitor / Cordova** would add a bridge, a plugin catalogue, AndroidX and a Node build step for
  capabilities this shell never calls — more APK, more build surface, more upgrades to track.
- **`android.webkit.WebView`** is the API both of those drive underneath. It exists on Fire OS 5+
  (Android 5.1, API 22) and needs no dependency at all.

So the app is `android.app.Activity` plus `WebView`, `minSdk 21`, `compileSdk 34`, Java 17, and zero
runtime libraries. `kotlin` and AndroidX are absent on purpose: nothing here needs them.

## Build

Gradle is not vendored; CI pins it through `gradle/actions/setup-gradle`. For a local build, install
Gradle 8.9 and a JDK 17, then:

```bash
gradle -p android assembleRelease    # android/app/build/outputs/apk/release/app-release.apk
gradle -p android assembleRelease -PatvBaseUrl=http://10.0.2.2:8788   # a local Worker
```

The guide origin is compiled in (`BuildConfig.ATV_BASE_URL`) and defaults to the sandbox
`https://atv-core-v2.acidwurx.workers.dev`. CI overrides it from the `ATV_BASE_URL` repository
variable.

## Release asset

`.github/workflows/android.yml` builds on any change under `android/`, uploads the APK as a workflow
artifact, and republishes `atv-launcher.apk` on the `atv-launcher-latest` GitHub release.
`/install` on the Worker links to `/releases/latest/download/atv-launcher.apk`, so the page never needs
rebuilding when the APK changes.

Signing comes from the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` and optionally `ANDROID_KEY_PASSWORD` (a PKCS12 or JKS keystore, base64-encoded).
Without them the build is debug-signed: installable, but a later APK signed by a different runner's
debug key will not install over it — uninstall first.
