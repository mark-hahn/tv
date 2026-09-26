package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.util.TypedValue;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
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
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Plays a show's episode file full screen inside tvapp, straight off nginx.
 * PlayerView draws through a SurfaceView, so the frames
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
  // A seek has ended once no left/right has come for this long. The remotes
  // send no key release, and a held key repeats well inside it.
  // ponytail: ignores buffering after the seek; hold the bar through
  // STATE_BUFFERING too if it goes down before the new frame shows.
  private static final long SEEK_END_MS = 1000;
  // Each sideloaded .srt's track id is this plus its index in getPlayUrl's subs.
  private static final String SUBS_ID = "tvapp-subs";
  private static final String PLAY_FAILED_TOAST = "Video failed.";
  // Gap between the time display and the show/episode title after it.
  private static final int TITLE_GAP_DP = 24;
  // Gap between the title's parts.
  private static final int PART_GAP_DP = 15;
  // The time bar's row of text, the time included, is dimmed to 60% gray.
  private static final int BAR_TEXT_COLOR = 0xFF999999;

  private final PlayerView view;
  // The show and episode, right of the time display in the time bar.
  private final TitleRow title;
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
  // Down put the time bar up (see key).
  private boolean barUp;
  // A left/right seek has the time bar up until it ends.
  private boolean seeking;
  private final Runnable seekEnd =
      () -> {
        seeking = false;
        updateBar();
      };
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
    view.setControllerShowTimeoutMs(0);
    view.setShowNextButton(false);
    view.setShowPreviousButton(false);
    // The center buttons and the settings gear can't be reached without focus,
    // and their 5/15 s labels aren't what left/right do.
    view.setShowRewindButton(false);
    view.setShowFastForwardButton(false);
    view.findViewById(androidx.media3.ui.R.id.exo_play_pause).setVisibility(GONE);
    view.findViewById(androidx.media3.ui.R.id.exo_settings).setVisibility(GONE);
    TextView pos = view.findViewById(androidx.media3.ui.R.id.exo_position);
    LinearLayout time = view.findViewById(androidx.media3.ui.R.id.exo_time);
    for (int i = 0; i < time.getChildCount(); i++)
      ((TextView) time.getChildAt(i)).setTextColor(BAR_TEXT_COLOR);
    float density = getResources().getDisplayMetrics().density;
    title = new TitleRow(context, pos, (int) (PART_GAP_DP * density));
    title.setPadding((int) (TITLE_GAP_DP * density), 0, 0, 0);
    time.addView(title);
    addView(view, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  boolean isOpen() {
    return getVisibility() == VISIBLE;
  }

  /**
   * p is tv-srvr's getPlayUrl answer: url, showName, season, episode, posMs
   * (resume point), res (the file's height, null if unknown), seasonEps
   * (the episode count of its season), trimPosMs (where the show starts past its intro), skipDurMs
   * (the Skip key's jump), subs (the episode's .srt files as vtt, [{url,
   * label}]), subIndex (the embedded subtitle stream chksrt chose) and subPick
   * (the index in subs to start on otherwise, -1 for none). show is the
   * list's record of the show, for the time bar's show-wide parts.
   */
  void play(JSONObject p, Shows.Show show) {
    close();
    playing = p;
    ready = false;
    int res = p.optInt("res");
    title.setParts(
        p.optString("showName"),
        show.originalCountry.toUpperCase(Locale.US),
        years(show),
        String.format("S%02dE%02d", p.optInt("season"), p.optInt("episode"))
            + (p.optInt("seasonEps") > 0 ? "/" + p.optInt("seasonEps") : ""),
        show.seasonCount <= 0
            ? ""
            : show.seasonCount == 1 ? "1 Season" : show.seasonCount + " Seasons",
        show.episodeCount <= 0 || show.watchedCount < 0
            ? ""
            : "Watched " + show.watchedCount + " of " + show.episodeCount,
        show.status,
        res > 0 ? String.valueOf(res) : "");
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
            updateBar();
          }

          @Override
          public void onTracksChanged(Tracks tracks) {
            if (!subsPicked) pickSubs(tracks);
            textGroups.clear();
            for (Tracks.Group g : tracks.getGroups()) {
              if (g.getType() != C.TRACK_TYPE_TEXT) continue;
              Format f = g.getTrackFormat(0);
              if (isSideloaded(f) || isEnglish(f)) textGroups.add(g);
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
    JSONArray subs = p.optJSONArray("subs");
    List<MediaItem.SubtitleConfiguration> subConfigs = new ArrayList<>();
    for (int i = 0; subs != null && i < subs.length(); i++) {
      JSONObject sub = subs.optJSONObject(i);
      subConfigs.add(
          new MediaItem.SubtitleConfiguration.Builder(Uri.parse(sub.optString("url")))
              .setMimeType(MimeTypes.TEXT_VTT)
              .setId(SUBS_ID + i)
              .setLabel(sub.optString("label"))
              .build());
    }
    item.setSubtitleConfigurations(subConfigs);
    long resumeMs = p.optLong("posMs");
    exo.setMediaItem(item.build(), resumeMs > 0 ? resumeMs : p.optLong("trimPosMs"));
    exo.prepare();
    exo.play();
    setVisibility(VISIBLE);
  }

  /**
   * A remote key while the video is up -- tvapprc mode's arrows and ok, the
   * same keys that drive the list: ok pauses and resumes, left and right seek,
   * up jumps back to the start (trimPosMs, past the intro, when there is one),
   * skip (the remotes' Skip key) jumps over the intro by the show's skip
   * length, and down toggles the time bar. Down's bar stays until down again, any key but a seek, or the
   * video closing. A seek's is up only until the seek ends, and the bar is
   * always up while paused.
   */
  void key(String key) {
    if (exo == null) return;
    boolean seek = "left".equals(key) || "right".equals(key);
    if ("down".equals(key)) barUp = !barUp;
    else if (!seek) barUp = false;
    seeking = seek;
    ui.removeCallbacks(seekEnd);
    if (seek) ui.postDelayed(seekEnd, SEEK_END_MS);
    long pos = exo.getCurrentPosition();
    long skipDurMs = playing.optLong("skipDurMs");
    if ("ok".equals(key)) exo.setPlayWhenReady(!exo.getPlayWhenReady());
    else if ("left".equals(key)) exo.seekTo(Math.max(0, pos - SEEK_BACK_MS));
    else if ("right".equals(key)) exo.seekTo(pos + SEEK_FWD_MS);
    else if ("up".equals(key)) exo.seekTo(playing.optLong("trimPosMs"));
    else if ("skip".equals(key)) {
      // A held Skip repeats, and a second skip would land past the intro into
      // the show, so repeats inside the lockout are dropped.
      long now = SystemClock.uptimeMillis();
      if (skipDurMs > 0 && now - lastSkipAt >= SKIP_LOCKOUT_MS) {
        lastSkipAt = now;
        exo.seekTo(pos + skipDurMs);
      }
    }
    updateBar();
  }

  private void updateBar() {
    if (exo != null && (barUp || seeking || !exo.getPlayWhenReady())) view.showController();
    else view.hideController();
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
    ui.removeCallbacks(seekEnd);
    seeking = false;
    if (ready) report("stopped");
    ready = false;
    barUp = false;
    view.hideController();
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
    if (isSideloaded(f)) return "srt";
    if (f.sampleMimeType != null && f.sampleMimeType.contains("pgs")) return "pgs";
    if ((f.selectionFlags & C.SELECTION_FLAG_FORCED) != 0) return "forced";
    if ((f.roleFlags & C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND) != 0) return "sdh";
    return "embedded";
  }

  private static boolean isSideloaded(Format f) {
    return f.id != null && f.id.contains(SUBS_ID);
  }

  // Embedded tracks in other languages are left off the panel and never
  // started on. Untagged ones are kept.
  private static boolean isEnglish(Format f) {
    String lang = f.language;
    return lang == null || lang.isEmpty() || "und".equals(lang) || "en".equals(lang) || lang.startsWith("en-");
  }

  /**
   * The text track to show: the embedded one chksrt chose, else the .srt
   * tv-srvr said to start on, else the file's first English embedded one.
   * Subtitles are always on.
   */
  private void pickSubs(Tracks tracks) {
    int subIndex = playing.isNull("subIndex") ? -1 : playing.optInt("subIndex", -1);
    // ponytail: Media3 ids a Matroska track by its 1-based track number, which
    // is ffprobe's 0-based stream index + 1 in mkvmerge's files. Match on
    // language/codec instead if some other muxer breaks that.
    String embeddedId = String.valueOf(subIndex + 1);
    String pickId = SUBS_ID + playing.optInt("subPick", -1);
    Tracks.Group chosen = null;
    Tracks.Group sideloaded = null;
    Tracks.Group firstEmbedded = null;
    for (Tracks.Group g : tracks.getGroups()) {
      if (g.getType() != C.TRACK_TYPE_TEXT) continue;
      String id = g.getTrackFormat(0).id;
      if (isSideloaded(g.getTrackFormat(0))) {
        if (id.endsWith(pickId)) sideloaded = g;
        continue;
      }
      if (firstEmbedded == null && isEnglish(g.getTrackFormat(0))) firstEmbedded = g;
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

  /**
   * The time bar's parts after the time: name, country, years, episode,
   * seasons, watched, status and resolution. The ones in DROP_ORDER go,
   * in that order, until the rest fit the bar; empty ones are never shown.
   */
  private static class TitleRow extends LinearLayout {
    // Watched, seasons, status, years, country.
    private static final int[] DROP_ORDER = {5, 4, 6, 2, 1};
    private final TextView[] parts = new TextView[8];

    TitleRow(Context context, TextView like, int partGap) {
      super(context);
      for (int i = 0; i < parts.length; i++) {
        parts[i] = new TextView(context);
        parts[i].setTextSize(TypedValue.COMPLEX_UNIT_PX, like.getTextSize());
        parts[i].setTypeface(like.getTypeface());
        parts[i].setTextColor(BAR_TEXT_COLOR);
        if (i > 0) parts[i].setPadding(partGap, 0, 0, 0);
        addView(parts[i]);
      }
    }

    void setParts(String... texts) {
      for (int i = 0; i < parts.length; i++) parts[i].setText(texts[i]);
    }

    @Override
    protected void onMeasure(int widthSpec, int heightSpec) {
      float avail =
          MeasureSpec.getMode(widthSpec) == MeasureSpec.UNSPECIFIED
              ? Float.MAX_VALUE
              : MeasureSpec.getSize(widthSpec);
      boolean[] shown = new boolean[parts.length];
      float wide = getPaddingLeft();
      for (int i = 0; i < parts.length; i++) {
        shown[i] = parts[i].length() > 0;
        if (shown[i]) wide += partWidth(i);
      }
      for (int i = 0; i < DROP_ORDER.length && wide > avail; i++) {
        int d = DROP_ORDER[i];
        if (shown[d]) wide -= partWidth(d);
        shown[d] = false;
      }
      // Only a real change, so a settled row does not ask for another layout.
      for (int i = 0; i < parts.length; i++) {
        int want = shown[i] ? VISIBLE : GONE;
        if (parts[i].getVisibility() != want) parts[i].setVisibility(want);
      }
      super.onMeasure(widthSpec, heightSpec);
    }

    private float partWidth(int i) {
      return parts[i].getPaddingLeft() + parts[i].getPaint().measureText(parts[i].getText().toString());
    }
  }

  /** "premiere year-last aired year", or whichever of the two the record has. */
  private static String years(Shows.Show show) {
    String first = ShowListView.year(show.firstAired);
    String last = ShowListView.year(show.lastAired);
    if (first.equals(last)) return first;
    return first.isEmpty() || last.isEmpty() ? first + last : first + "-" + last;
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
