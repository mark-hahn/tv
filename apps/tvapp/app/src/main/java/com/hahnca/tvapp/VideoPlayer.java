package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.widget.FrameLayout;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Plays a show's episode file full screen inside tvapp, straight off nginx --
 * Emby is not involved. PlayerView draws through a SurfaceView, so the frames
 * take the tv's hardware video path and get its picture processing, which a
 * GL-drawn player (mpv) did not. The ExoPlayer is built per play and released
 * on close, so nothing holds a decoder while the list is up.
 *
 * tv-srvr owns the play state: getPlayUrl says where to start, and this
 * reports back how far it got -- the resume point, and the watched mark when
 * the video runs to its end.
 */
class VideoPlayer extends FrameLayout {

  interface Events {
    void onVideoError(String text);

    /** The subtitle list (see subtitleList) on every change, null once no video is up. */
    void onSubtitles(JSONObject list);
  }

  private static final String TAG = "tvapp";
  private static final String PROGRESS_URL = "https://hahnca.com/tv-srvr/api/playProgress";
  // How often a playing video tells tv-srvr where it is: the resume point if
  // the tv goes off mid-play, and the phone's progress bar.
  private static final long REPORT_MS = 10000;
  private static final long SEEK_BACK_MS = 10000;
  private static final long SEEK_FWD_MS = 30000;
  private static final long SKIP_LOCKOUT_MS = 2000;
  // How long the time bar stays up after a key while playing; paused, it
  // stays until play resumes.
  private static final int BAR_SHOW_MS = 3000;
  private static final String SUBS_ID = "tvapp-subs";
  private static final String SUBS_LABEL = "External";
  private static final String PLAY_FAILED_TOAST = "Video failed.";

  private final PlayerView view;
  private final Events events;
  private final Handler ui = new Handler(Looper.getMainLooper());
  private final Runnable reportTick =
      new Runnable() {
        @Override
        public void run() {
          if (exo == null) return;
          if (exo.getPlayWhenReady()) report("playing");
          ui.postDelayed(this, REPORT_MS);
        }
      };
  private ExoPlayer exo;
  // getPlayUrl's answer for the video that is up.
  private JSONObject playing;
  // Past its first STATE_READY: the position is real and worth reporting.
  private boolean ready;
  private boolean subsPicked;
  private long lastSkipAt;
  // The video's text tracks, in the order the remote's subtitle panel lists
  // them.
  private final List<Tracks.Group> textGroups = new ArrayList<>();

  VideoPlayer(Context context, Events events) {
    super(context);
    this.events = events;
    setBackgroundColor(Color.BLACK);
    setVisibility(GONE);
    // Only counts while this view is visible, so the screensaver is held off
    // for exactly as long as a video is up.
    setKeepScreenOn(true);
    view = new PlayerView(context);
    // The keys are tvapp's and come in over its ctrl socket, never as focus
    // on this view; the controller is only the time bar a key puts up.
    view.setUseController(true);
    view.setControllerAutoShow(false);
    view.setShowNextButton(false);
    view.setShowPreviousButton(false);
    addView(view, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  boolean isOpen() {
    return getVisibility() == VISIBLE;
  }

  /**
   * p is tv-srvr's getPlayUrl answer: url, showName, season, episode, posMs
   * (resume point), trimPosMs (where the show starts past its intro), skipDurMs
   * (the Skip key's jump), subsUrl (an .srt as vtt) and subIndex (the embedded
   * subtitle stream chksrt chose).
   */
  void play(JSONObject p) {
    close();
    playing = p;
    ready = false;
    subsPicked = false;
    String url = p.optString("url");
    exo = new ExoPlayer.Builder(getContext()).build();
    exo.addListener(
        new Player.Listener() {
          @Override
          public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_READY && !ready) {
              ready = true;
              report("playing");
              ui.postDelayed(reportTick, REPORT_MS);
            } else if (state == Player.STATE_ENDED) {
              report("ended");
              ready = false;
              close();
            }
          }

          @Override
          public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
            if (ready) report(playWhenReady ? "playing" : "paused");
          }

          @Override
          public void onTracksChanged(Tracks tracks) {
            if (!subsPicked) pickSubs(tracks);
            textGroups.clear();
            for (Tracks.Group g : tracks.getGroups()) {
              if (g.getType() == C.TRACK_TYPE_TEXT) textGroups.add(g);
            }
            events.onSubtitles(subtitleList());
          }

          @Override
          public void onPlayerError(PlaybackException e) {
            Log.e(TAG, "video failed for " + url + ": " + e);
            // The position is not to be trusted after a failure, so the
            // last periodic report stands as the resume point.
            ready = false;
            close();
            events.onVideoError(PLAY_FAILED_TOAST);
          }
        });
    view.setPlayer(exo);
    MediaItem.Builder item = new MediaItem.Builder().setUri(url);
    if (!p.isNull("subsUrl")) {
      item.setSubtitleConfigurations(
          Collections.singletonList(
              new MediaItem.SubtitleConfiguration.Builder(Uri.parse(p.optString("subsUrl")))
                  .setMimeType(MimeTypes.TEXT_VTT)
                  .setId(SUBS_ID)
                  .setLabel(SUBS_LABEL)
                  .build()));
    }
    long resumeMs = p.optLong("posMs");
    exo.setMediaItem(item.build(), resumeMs > 0 ? resumeMs : p.optLong("trimPosMs"));
    exo.prepare();
    exo.play();
    setVisibility(VISIBLE);
  }

  /**
   * A remote key while the video is up -- tvapprc mode's arrows and ok, the
   * same keys that drive the list: ok pauses and resumes, left and right seek,
   * up jumps over the intro by the show's skip length, and down only puts the
   * time bar up.
   */
  void key(String key) {
    if (exo == null) return;
    long pos = exo.getCurrentPosition();
    long skipDurMs = playing.optLong("skipDurMs");
    if ("ok".equals(key)) exo.setPlayWhenReady(!exo.getPlayWhenReady());
    else if ("left".equals(key)) exo.seekTo(Math.max(0, pos - SEEK_BACK_MS));
    else if ("right".equals(key)) exo.seekTo(pos + SEEK_FWD_MS);
    else if ("up".equals(key)) {
      // A held up repeats, and a second skip would land past the intro into
      // the show, so repeats inside the lockout are dropped.
      long now = SystemClock.uptimeMillis();
      if (skipDurMs <= 0 || now - lastSkipAt < SKIP_LOCKOUT_MS) return;
      lastSkipAt = now;
      exo.seekTo(pos + skipDurMs);
    } else if (!"down".equals(key)) return;
    view.setControllerShowTimeoutMs(exo.getPlayWhenReady() ? BAR_SHOW_MS : 0);
    view.showController();
  }

  /** Pauses a video that is playing; true when it did. */
  boolean pause() {
    if (exo == null || !exo.getPlayWhenReady()) return false;
    exo.setPlayWhenReady(false);
    return true;
  }

  void resume() {
    if (exo != null) exo.setPlayWhenReady(true);
  }

  void close() {
    if (exo == null) return;
    ui.removeCallbacks(reportTick);
    if (ready) report("stopped");
    ready = false;
    view.setPlayer(null);
    exo.release();
    exo = null;
    playing = null;
    textGroups.clear();
    setVisibility(GONE);
    events.onSubtitles(null);
  }

  /**
   * For the remote's subtitle panel: {title, tracks: [{label, type}], selected},
   * selected -1 when subtitles are off. Null when no video is up.
   */
  JSONObject subtitleList() {
    if (exo == null || playing == null) return null;
    JSONObject out = new JSONObject();
    try {
      JSONArray tracks = new JSONArray();
      int selected = -1;
      for (int i = 0; i < textGroups.size(); i++) {
        Tracks.Group g = textGroups.get(i);
        Format f = g.getTrackFormat(0);
        JSONObject t = new JSONObject();
        t.put("label", f.label != null ? f.label : f.language != null ? f.language : "Track " + (i + 1));
        t.put("type", trackType(f));
        tracks.put(t);
        if (g.isSelected()) selected = i;
      }
      out.put(
          "title",
          String.format(
              "%s S%02dE%02d",
              playing.optString("showName"), playing.optInt("season"), playing.optInt("episode")));
      out.put("tracks", tracks);
      out.put("selected", selected);
    } catch (JSONException e) {
      Log.e(TAG, "subtitle list failed: " + e);
      return null;
    }
    return out;
  }

  /** The remote's pick from subtitleList's tracks; -1 turns subtitles off. */
  void selectSubtitle(int index) {
    if (exo == null) return;
    TrackSelectionParameters.Builder b = exo.getTrackSelectionParameters().buildUpon();
    if (index < 0 || index >= textGroups.size()) {
      b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
    } else {
      b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
          .setOverrideForType(
              new TrackSelectionOverride(textGroups.get(index).getMediaTrackGroup(), 0));
    }
    exo.setTrackSelectionParameters(b.build());
  }

  // The kinds the remote's panel marks each track with.
  private static String trackType(Format f) {
    if (f.id != null && f.id.endsWith(SUBS_ID)) return "srt";
    if (f.sampleMimeType != null && f.sampleMimeType.contains("pgs")) return "pgs";
    if ((f.selectionFlags & C.SELECTION_FLAG_FORCED) != 0) return "forced";
    if ((f.roleFlags & C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND) != 0) return "sdh";
    return "embedded";
  }

  /**
   * The text track to show: the embedded one chksrt chose, else the .srt
   * tv-srvr sent, else the file's first embedded one. Subtitles are always
   * on, as they were in Emby.
   */
  private void pickSubs(Tracks tracks) {
    int subIndex = playing.isNull("subIndex") ? -1 : playing.optInt("subIndex", -1);
    // ponytail: Media3 ids a Matroska track by its 1-based track number, which
    // is ffprobe's 0-based stream index + 1 in mkvmerge's files. Match on
    // language/codec instead if some other muxer breaks that.
    String embeddedId = String.valueOf(subIndex + 1);
    Tracks.Group chosen = null;
    Tracks.Group sideloaded = null;
    Tracks.Group firstEmbedded = null;
    for (Tracks.Group g : tracks.getGroups()) {
      if (g.getType() != C.TRACK_TYPE_TEXT) continue;
      String id = g.getTrackFormat(0).id;
      if (id != null && id.endsWith(SUBS_ID)) {
        sideloaded = g;
        continue;
      }
      if (firstEmbedded == null) firstEmbedded = g;
      if (subIndex >= 0 && id != null && (id.equals(embeddedId) || id.endsWith(":" + embeddedId)))
        chosen = g;
    }
    if (chosen == null) chosen = sideloaded != null ? sideloaded : firstEmbedded;
    if (chosen == null) return;
    subsPicked = true;
    exo.setTrackSelectionParameters(
        exo.getTrackSelectionParameters()
            .buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setOverrideForType(new TrackSelectionOverride(chosen.getMediaTrackGroup(), 0))
            .build());
  }

  private void report(String state) {
    if (exo == null || playing == null) return;
    JSONObject body = new JSONObject();
    try {
      body.put("showName", playing.getString("showName"));
      body.put("season", playing.getInt("season"));
      body.put("episode", playing.getInt("episode"));
      body.put("posMs", exo.getCurrentPosition());
      body.put("durMs", exo.getDuration());
      body.put("state", state);
    } catch (JSONException e) {
      Log.e(TAG, "playProgress body failed: " + e);
      return;
    }
    new Thread(
            () -> {
              try {
                Http.postJson(PROGRESS_URL, body.toString());
              } catch (Exception e) {
                Log.e(TAG, "playProgress " + state + " failed: " + e);
              }
            },
            "play-progress")
        .start();
  }
}
