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

  /**
   * Why the overlay came off, which is the whole of what tv-tv needs to know:
   * whether it was told already, and whether to put back what the view
   * interrupted.
   */
  enum CloseReason {
    /** tv-tv asked for it. It knows, and there is nothing to report. */
    TOLD,
    /** Back, or tvapp going to the background: put back what was interrupted. */
    BACK,
    /**
     * The Shows key, which means a clean tvapp screen. The view is over, but
     * restoring would bring a paused show forward over the list the key just
     * asked for.
     */
    SHOWS,
  }

  /** Told when the overlay closes for any reason but TOLD. */
  interface CloseListener {
    void onCamDismissed(CloseReason reason);
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
   * Anything but TOLD is a close the far end does not know about yet, so it is
   * reported; the reason says what it should do about the show underneath.
   */
  void close(CloseReason reason) {
    if (!showing) return;
    showing = false;
    web.loadUrl("about:blank");
    setVisibility(GONE);
    if (reason != CloseReason.TOLD && closeListener != null) {
      closeListener.onCamDismissed(reason);
    }
  }
}
