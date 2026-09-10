package com.hahnca.tvapp;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * A live camera filling the screen, over everything else.
 *
 * All this owns is a WebView and whether it is visible. The url it is handed
 * renders the video, chooses its own codec, falls back on its own, and reports
 * its own health to whoever served it — none of which is here, because the
 * stream belongs to another project (hvac2) and the contract between the two is
 * a url and nothing more. Changing the camera, the encoder, or the fallback
 * never touches this file. See docs/tv-videostream-contract.md.
 *
 * A WebView rather than a player for the same reason TrailerPlayer is one: the
 * page already exists, it already solves the live-edge and buffer-trimming
 * problems for the wall tablet, and TrailerPlayer is standing proof that a
 * WebView plays video on this television.
 */
class CamOverlay extends FrameLayout {

  /** Told when the overlay closes itself, so what was paused can be put back. */
  interface CloseListener {
    void onCamDismissed();
  }

  private final WebView web;
  private CloseListener closeListener;
  private boolean showing;

  @SuppressLint("SetJavaScriptEnabled")
  CamOverlay(Context context) {
    super(context);
    setBackgroundColor(Color.BLACK);
    setVisibility(GONE);

    web = new WebView(context);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    // Nothing here is a user gesture: the decision to put this on the screen
    // was made in another app, on another machine.
    settings.setMediaPlaybackRequiresUserGesture(false);
    web.setBackgroundColor(Color.BLACK);
    addView(web, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  void setCloseListener(CloseListener listener) {
    this.closeListener = listener;
  }

  boolean isShowing() {
    return showing;
  }

  void show(String url) {
    showing = true;
    setVisibility(VISIBLE);
    bringToFront();
    web.loadUrl(url);
  }

  /**
   * about:blank rather than only hiding the view: loading it aborts the page's
   * fetch, and that closed socket is what ends the ffmpeg and the camera
   * session at the far end. A hidden WebView still sitting on the page would
   * leave the camera live with nobody watching it.
   *
   * `dismissed` is true when this was the remote's Back key rather than an
   * instruction from tv-tv — the one case where the far end does not already
   * know the view is over and has a paused show to put back.
   */
  void close(boolean dismissed) {
    if (!showing) return;
    showing = false;
    web.loadUrl("about:blank");
    setVisibility(GONE);
    if (dismissed && closeListener != null) closeListener.onCamDismissed();
  }
}
