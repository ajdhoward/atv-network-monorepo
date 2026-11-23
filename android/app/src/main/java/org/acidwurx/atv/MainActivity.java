package org.acidwurx.atv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * The whole TV client: a full-screen WebView pointed at the Worker, which serves
 * the guide and the player. Nothing is bundled and nothing is cached beyond the
 * WebView's own HTTP cache, so a change on the server reaches the TV on the next
 * launch without a new APK.
 *
 * Fire TV sends D-pad and media keys as ordinary key events; the page's own key
 * handling receives them once the WebView holds focus, which is why this class
 * only has to claim focus and keep the screen on.
 */
public class MainActivity extends Activity {
  private static final String RELOAD_URL = "atv-reload://home";
  private WebView webView;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    // A paused video must not blank the TV, and the remote has no way to wake it.
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    webView = new WebView(this);
    webView.setBackgroundColor(Color.BLACK);
    webView.setLayoutParams(
        new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    // The guide memoises nothing locally, but the admin panel and any player
    // state use localStorage, so the shell has to allow it.
    settings.setDomStorageEnabled(true);
    // Playback starts on a D-pad press, not a touch, and some streams begin on
    // their own; without this a programmatic play() is blocked as autoplay.
    settings.setMediaPlaybackRequiresUserGesture(false);
    // Streams are HTTPS-only upstream (the resolver refuses anything else), so a
    // page that tries to downgrade is a bug, not something to allow.
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

    webView.setWebViewClient(
        new WebViewClient() {
          @SuppressWarnings("deprecation")
          @Override
          public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(url);
          }

          @Override
          public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl().toString());
          }

          @Override
          public void onReceivedError(
              WebView view, WebResourceRequest request, WebResourceError error) {
            // Subresource failures (a thumbnail, a font) must not replace a
            // working guide with an error page.
            if (request.isForMainFrame()) showOffline();
          }
        });

    setContentView(webView);
    // Without focus the remote's key presses go nowhere.
    webView.requestFocus();
    loadHome();
  }

  private void loadHome() {
    webView.loadUrl(BuildConfig.ATV_BASE_URL);
  }

  /**
   * Keeps the guide and the player inside this WebView, sends anything else
   * (market://, intent://, mailto:) to the system, and answers the retry link on
   * the offline page. Returning false means "let the WebView load it".
   */
  private boolean handleUrl(String url) {
    if (url.startsWith(RELOAD_URL)) {
      loadHome();
      return true;
    }
    if (url.startsWith("http://") || url.startsWith("https://")) return false;
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    } catch (Exception ignored) {
      // No handler for this scheme on a Fire TV; the key press simply does nothing.
    }
    return true;
  }

  /**
   * A TV gives no way to see why a page is blank, so an unreachable Worker has to
   * say so and offer a retry. The link uses a scheme of our own, which avoids a
   * JavaScript bridge and keeps this shell free of script injection surface.
   */
  private void showOffline() {
    String html =
        "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<style>"
            + "html,body{margin:0;height:100%;background:#0b0b0f;color:#f5f5f7;"
            + "font-family:system-ui,sans-serif;display:flex;align-items:center;"
            + "justify-content:center;text-align:center}"
            + "h1{font-size:34px;margin:0 0 12px}p{color:#b9b9c6;margin:0 0 28px;font-size:20px}"
            + "a{display:inline-block;padding:16px 34px;border-radius:12px;background:#f6821f;"
            + "color:#0b0b0f;font-weight:700;font-size:22px;text-decoration:none}"
            + "a:focus{outline:4px solid #f5f5f7;outline-offset:4px}"
            + "</style></head><body><main>"
            + "<h1>Can't reach ATV Network</h1>"
            + "<p>Check the TV's Wi-Fi, then try again.</p>"
            + "<a href=\""
            + RELOAD_URL
            + "\">Retry</a>"
            + "</main></body></html>";
    webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    webView.requestFocus();
  }

  /**
   * Back steps through the page history first, as a remote user expects, and only
   * leaves the app from the guide.
   */
  @Override
  public boolean onKeyDown(int keyCode, KeyEvent event) {
    if (keyCode == KeyEvent.KEYCODE_BACK && webView != null && webView.canGoBack()) {
      webView.goBack();
      return true;
    }
    return super.onKeyDown(keyCode, event);
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (webView != null) webView.onResume();
  }

  @Override
  protected void onPause() {
    // Stops media and timers while the TV shows something else.
    if (webView != null) webView.onPause();
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    if (webView != null) {
      webView.setWebViewClient(null);
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }
}
