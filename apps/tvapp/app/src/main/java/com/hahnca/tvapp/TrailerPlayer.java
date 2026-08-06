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
  // What one press of left or right moves, the same ten seconds Emby's d-pad
  // seek uses.
  private static final int SEEK_SECONDS = 10;

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

  /**
   * A remote key while the video owns the screen: ok pauses and resumes, left
   * seeks. Anything else is not the player's; right and back are the
   * activity's -- both close.
   */
  void key(String remoteKey) {
    if (!isPlaying()) return;
    if (!"ok".equals(remoteKey) && !"left".equals(remoteKey)) return;
    web.evaluateJavascript("window.tvKey&&tvKey('" + remoteKey + "'," + SEEK_SECONDS + ")", null);
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
      // close() is what tells the activity, so a video that ended by itself and
      // one a key closed leave by the same door.
      ui.post(TrailerPlayer.this::close);
    }
  }

  /**
   * The iframe api for a YouTube url, a plain video element for anything else.
   * Either way the page ends up with one controller object the remote keys
   * drive, and its own scrub bar: YouTube's controls are off, and there is no
   * pointer on this screen to work them with anyway, so the only feedback a
   * seek or a pause gets is the one drawn here.
   */
  private static String page(String url) {
    String videoId = Trailers.youtubeId(url);
    String body =
        videoId == null
            ? "<video id='v' src='"
                + url
                + "' autoplay playsinline class='fill' onended='"
                + BRIDGE
                + ".onEnded()'></video>"
                + "<script>var v=document.getElementById('v');"
                // No captions on a trailer: any the file carries are off, and
                // stay off through the load that can add them late.
                + "function nocc(){var t=v.textTracks;"
                + "for(var i=0;i<t.length;i++)t[i].mode='disabled';}"
                + "nocc();v.addEventListener('loadedmetadata',nocc);ctrl({"
                + "pos:function(){return v.currentTime;},"
                + "dur:function(){return v.duration;},"
                + "paused:function(){return v.paused;},"
                + "seek:function(t){v.currentTime=t;},"
                + "toggle:function(){if(v.paused)v.play();else v.pause();}});"
                + "v.addEventListener('pause',osd);v.addEventListener('play',osd);</script>"
            : "<div id='p' class='fill'></div>"
                + "<script>function nocc(y){try{y.unloadModule('captions');"
                + "y.unloadModule('cc');y.setOption('captions','track',{});}catch(e){}}</script>"
                + "<script src='https://www.youtube.com/iframe_api'></script>"
                + "<script>function onYouTubeIframeAPIReady(){new YT.Player('p',{"
                + "videoId:'"
                + videoId
                + "',width:'100%',height:'100%',"
                + "playerVars:{autoplay:1,controls:0,rel:0,playsinline:1,"
                + "disablekb:1,fs:0,iv_load_policy:3,cc_load_policy:0,modestbranding:1,origin:'"
                + BASE_URL
                + "'},"
                // cc_load_policy alone leaves captions on for an account that
                // asks for them everywhere, so the module goes as well. It is
                // not loaded yet at onReady and comes back with the video, so
                // nocc runs again on every state change the player reports.
                + "events:{onReady:function(e){var y=e.target;nocc(y);ctrl({"
                + "pos:function(){return y.getCurrentTime();},"
                + "dur:function(){return y.getDuration();},"
                + "paused:function(){return y.getPlayerState()===YT.PlayerState.PAUSED;},"
                + "seek:function(t){y.seekTo(t,true);},"
                + "toggle:function(){if(y.getPlayerState()===YT.PlayerState.PLAYING)"
                + "y.pauseVideo();else y.playVideo();}});},"
                + "onStateChange:function(e){nocc(e.target);"
                + "if(e.data===YT.PlayerState.ENDED)"
                + BRIDGE
                + ".onEnded();else osd();}}});}</script>";
    return "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
        + "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}"
        + "body{position:relative}"
        + ".fill{position:absolute;top:0;left:0;width:100%;height:100%}"
        + "#osd{position:absolute;left:0;right:0;bottom:0;padding:24px 40px 32px;"
        + "background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;"
        + "font:400 28px sans-serif;opacity:0;transition:opacity .2s}"
        + "#bar{height:6px;border-radius:3px;background:rgba(255,255,255,.35)}"
        + "#fill{height:100%;width:0;border-radius:3px;background:#fff}"
        + "#txt{margin-top:12px}"
        + "</style></head><body>"
        + "<div id='osd'><div id='bar'><div id='fill'></div></div><div id='txt'></div></div>"
        + "<script>"
        + CONTROLLER_JS
        + "</script>"
        + body
        + "</body></html>";
  }

  /**
   * The half of the page both sources share: whichever one loaded hands its
   * controller to `ctrl`, and from there the remote keys and the scrub bar work
   * the same for a YouTube video and a file.
   */
  private static final String CONTROLLER_JS =
      "var C=null,hideT=null;"
          + "function ctrl(c){C=c;osd();}"
          + "function fmt(s){s=Math.max(0,Math.floor(s||0));var m=Math.floor(s/60),x=s%60;"
          + "return m+':'+(x<10?'0':'')+x;}"
          + "function osd(){if(!C)return;var t=C.pos()||0,d=C.dur()||0;"
          + "document.getElementById('fill').style.width=(d?100*t/d:0)+'%';"
          + "document.getElementById('txt').textContent="
          + "(C.paused()?'⏸':'▶')+'  '+fmt(t)+' / '+fmt(d);"
          + "document.getElementById('osd').style.opacity=1;"
          + "clearTimeout(hideT);"
          // A paused video keeps its bar up; a playing one is only interrupted
          // for as long as it takes to read where the seek landed.
          + "if(!C.paused())hideT=setTimeout(function(){"
          + "document.getElementById('osd').style.opacity=0;},2500);}"
          + "window.tvKey=function(k,step){if(!C)return;"
          + "if(k==='ok')C.toggle();"
          + "else C.seek(Math.max(0,(C.pos()||0)+(k==='right'?step:-step)));"
          // The position a pause or a seek reports only settles a moment after
          // the call, so the bar is drawn from what took effect, not what was
          // asked for.
          + "setTimeout(osd,80);};";
}
