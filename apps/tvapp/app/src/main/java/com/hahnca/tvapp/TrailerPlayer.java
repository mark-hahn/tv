package com.hahnca.tvapp;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

/**
 * Plays a trailer inside tvapp, full screen, rather than handing the url to
 * YouTube. Two reasons: the tv app gives no signal when a video ends and no way
 * back except whatever task happens to be underneath, and this is what the web
 * client does too — an embedded player, not a launch.
 *
 * A WebView because the YouTube iframe api is the only way to play a YouTube
 * url and be told it finished; the same page handles a plain video file, whose
 * `ended` event says the same thing.
 */
class TrailerPlayer extends FrameLayout {

  // The page is loaded against our own domain: the iframe api checks the
  // embedding origin, about:blank is not one, and youtube.com itself is refused
  // as an embedder ("This video is unavailable, error 152").
  private static final String BASE_URL = "https://hahnca.com";
  private static final String BRIDGE = "TvApp";

  /** Told whenever the player takes the screen or gives it back. */
  interface OpenListener {
    void onPlayerOpen(boolean open);
  }

  private final Handler ui = new Handler(Looper.getMainLooper());
  private final WebView web;
  private OpenListener openListener;

  @SuppressLint("SetJavaScriptEnabled")
  TrailerPlayer(Context context) {
    super(context);
    setBackgroundColor(Color.BLACK);
    setVisibility(GONE);

    web = new WebView(context);
    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    // Nothing here is a user gesture: the play is one already, on the phone.
    settings.setMediaPlaybackRequiresUserGesture(false);
    web.setBackgroundColor(Color.BLACK);
    web.addJavascriptInterface(new Bridge(), BRIDGE);
    addView(web, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  void setOpenListener(OpenListener listener) {
    openListener = listener;
  }

  boolean isPlaying() {
    return getVisibility() == VISIBLE;
  }

  void play(String url) {
    setOpen(true);
    web.loadDataWithBaseURL(BASE_URL, page(url), "text/html", "utf-8", null);
  }

  void close() {
    if (!isPlaying()) return;
    // Blank first: a WebView left holding a playing video keeps its audio.
    web.loadUrl("about:blank");
    setOpen(false);
  }

  /**
   * The one place the player's visibility changes, so the listener hears about
   * a video that ended by itself as well as one a click closed.
   */
  private void setOpen(boolean open) {
    setVisibility(open ? VISIBLE : GONE);
    if (openListener != null) openListener.onPlayerOpen(open);
  }

  private class Bridge {
    @JavascriptInterface
    public void onEnded() {
      ui.post(TrailerPlayer.this::close);
    }
  }

  /**
   * The iframe api for a YouTube url, a plain video element for anything else.
   * Nothing is drawn over the picture in either case: there is no pointer on
   * this screen to work a control bar with — a click closes the player — so a
   * scrub bar, a title card or an annotation would only ever be in the way.
   */
  private static String page(String url) {
    String videoId = Trailers.youtubeId(url);
    String body =
        videoId == null
            ? "<video id='v' src='"
                + url
                + "' autoplay playsinline"
                + " style='width:100%;height:100%' onended='"
                + BRIDGE
                + ".onEnded()'></video>"
            : "<div id='p' style='width:100%;height:100%'></div>"
                + "<script src='https://www.youtube.com/iframe_api'></script>"
                + "<script>function onYouTubeIframeAPIReady(){new YT.Player('p',{"
                + "videoId:'"
                + videoId
                + "',width:'100%',height:'100%',"
                + "playerVars:{autoplay:1,controls:0,rel:0,playsinline:1,"
                + "disablekb:1,fs:0,iv_load_policy:3,modestbranding:1,origin:'"
                + BASE_URL
                + "'},"
                + "events:{onStateChange:function(e){if(e.data===YT.PlayerState.ENDED)"
                + BRIDGE
                + ".onEnded();}}});}</script>";
    return "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
        + "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style>"
        + "</head><body>"
        + body
        + "</body></html>";
  }
}
