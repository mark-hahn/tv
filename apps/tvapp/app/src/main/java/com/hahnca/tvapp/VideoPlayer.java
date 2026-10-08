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
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.Util;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.ui.PlayerView;
import androidx.media3.ui.TimeBar;
import java.util.ArrayList;
import java.util.Formatter;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
 *
 * Subtitles are the episode's .srt files only, sideloaded; the file's embedded
 * tracks are never shown.
 */
class VideoPlayer extends FrameLayout {

  interface Events {
    void onVideoError(String text);

    /** The subtitle list (see subtitleList) on every change, null once no video is up. */
    void onSubtitles(JSONObject list);
  }

  private static final String TAG = "tvapp";
  private static final String PROGRESS_URL = "https://hahnca.com/tv-srvr/api/playProgress";
  // The .srt timing shift the subtitle panel's Apply uses.
  private static final String SHIFT_SUBS_URL = "https://hahnca.com/tv-srvr/api/applySubOffset";
  // The subtitle panel's Sync: how far the showing .srt is off, which takes
  // ASR on two clips of a video never checked.
  private static final String MEASURE_SUB_URL = "https://hahnca.com/tv-srvr/api/measureSub";
  private static final int MEASURE_SUB_TIMEOUT_MS = 180000;
  private static final String SYNC_FAILED_TOAST = "Subtitle sync failed.";
  // A cue's times in the served vtt: "00:01:02.345 --> 00:01:04.000".
  private static final Pattern CUE_TIMES =
      Pattern.compile(
          "(\\d+):(\\d{2}):(\\d{2})\\.(\\d{3})\\s*-->\\s*(\\d+):(\\d{2}):(\\d{2})\\.(\\d{3})");
  // How often the panel's caption line (see showCap) looks at the video's position.
  private static final long CAP_STEP_MS = 50;
  // How often a playing video tells tv-srvr where it is: the resume point if
  // the tv goes off mid-play, and the phone's progress bar.
  private static final long REPORT_MS = 10000;
  private static final long SEEK_BACK_MS = 10000;
  private static final long SEEK_FWD_MS = 30000;
  // A hold steps one still at a time on its own clock, as fast as its speed
  // allows: right about two minutes of video a second, left 83 s. With the
  // stills 2.5 s apart that is a still every 20 ms right (50 a second) and
  // every 30 ms left. A video with no stills steps NO_STILLS_STEP_MS. The
  // remotes' key-up ends a hold; for the tv's own remote, SEEK_END_MS with no
  // repeat does too.
  private static final double HOLD_FWD_SPEED = 125;
  private static final double HOLD_BACK_SPEED = 250 / 3.0;
  private static final long NO_STILLS_STEP_MS = 5000;
  // An up press is a tap when its key-up comes before any repeat of it (see
  // key and keyUp). A remote's key-up can go missing (its socket closing), so
  // a press with neither in this long counts as a tap too. The remotes' first
  // repeat comes 400 ms after the press plus a round trip to tv-srvr, well
  // inside it.
  private static final long UP_TAP_MS = 2000;
  // A seek has ended once no left/right has come for this long: how long a
  // press keeps the time bar up, and the dead-man of a hold whose key-up
  // never came (a held key repeats well inside it).
  // ponytail: ignores buffering after the seek; hold the bar through
  // STATE_BUFFERING too if it goes down before the new frame shows.
  private static final long SEEK_END_MS = 1000;
  // A still left up by a landing (see landStills) comes down after this
  // even if no frame was drawn.
  private static final long LAND_MAX_MS = 3000;
  // Ready at the landing, the player has handed its frame to the set, but the
  // set shows it about 100 ms later (its picture processing), and a still
  // taken down at once let the frame from before the hold flash up. It stays
  // this long past ready.
  private static final long LAND_LINGER_MS = 250;
  // ffmpeg's input seek aims 3/23 s early in any file with B-frames (its dts
  // heuristic), so a still is the keyframe at or before its mark less this.
  // A file without B-frames and a keyframe in the 130 ms before a mark lands
  // one keyframe past its still, which only carries the hold a bit further.
  private static final long FFMPEG_SEEK_BACK_MS = 130;
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
  // The time bar's position text and bar, set straight off when a still goes
  // up (see showStillTime).
  private final TextView posView;
  private final TimeBar timeBar;
  private final StringBuilder timeText = new StringBuilder();
  private final Formatter timeFormat = new Formatter(timeText, Locale.getDefault());
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
  // Down put the time bar up (see key).
  private boolean barUp;
  // A left/right seek has the time bar up until it ends.
  private boolean seeking;
  // Where the last left/right aimed. A held key steps on from it: a stills
  // hold leaves the video where it was, and while scrubbing the player's
  // position flips between the newest target and the last one it landed on.
  private long seekTarget;
  // A left/right is held (see key and hold), and which.
  private boolean holding;
  private String holdKey;
  // The hold is a remote's kh: no repeats keep it alive, so it has no
  // dead-man. Its key-up ends it, or any key press (the user stopping one
  // whose key-up never came), or its socket closing.
  private boolean remoteHold;
  // When the hold started, for placing a key-up's heldMs on tvapp's clock.
  private long holdStartedAt;
  // Where a late key-up put the landing, -1 for the still on screen.
  private long landAt = -1;
  // A hold is showing stills for seekTarget, not seeking the video.
  private boolean stillsHold;
  // A hold's landing seek is on its way (see landStills).
  private boolean landing;
  private final Stills stills;
  private final Runnable seekEnd =
      () -> {
        seeking = false;
        endHold();
        updateBar();
      };
  private final Runnable holdStep = this::stepHold;
  private final Runnable stillsDown = this::landed;
  // An up press waiting UP_TAP_MS to learn if it is a hold (see key).
  private boolean upPending;
  // An up tap: the episode is done, as if it had run to the end, so tv-srvr
  // marks it watched with its resume point back at 0.
  private final Runnable upTap =
      () -> {
        upPending = false;
        report("ended");
        ready = false;
        close();
      };
  // The video's sideloaded text tracks, in the order the remote's subtitle
  // panel lists them.
  private final List<Tracks.Group> textGroups = new ArrayList<>();
  // The text track that was on when reload reopened the video, turned back on
  // once the reopened video has its tracks.
  private String reloadSubId;
  // The remote subtitle panel's timing offset in seconds, not yet applied to
  // the playing .srt: moved by + and -, and set by Sync. It goes back to 0 on
  // Apply, a new video or another subtitle pick.
  private double subOfs;
  // An Apply's shift or a Sync's measure is on its way to tv-srvr.
  private boolean shifting;
  // The showing .srt's captions (cueStarts, cueEnds, cueTexts), read from the
  // track cueSubId names. cueSeq goes up on every read and every clear, so a
  // read for a track no longer showing is dropped.
  private String cueSubId;
  private List<Long> cueStarts = new ArrayList<>();
  private List<Long> cueEnds = new ArrayList<>();
  private List<String> cueTexts = new ArrayList<>();
  private int cueSeq;
  // The caption the panel's line shows now (see showCap).
  private String capText = "";
  private final Runnable capStep = this::showCap;

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
    // No full-screen dimming while the time bar is up; the bar keeps its own strip.
    view.findViewById(androidx.media3.ui.R.id.exo_controls_background).setBackgroundColor(Color.TRANSPARENT);
    posView = view.findViewById(androidx.media3.ui.R.id.exo_position);
    timeBar = view.findViewById(androidx.media3.ui.R.id.exo_progress);
    LinearLayout time = view.findViewById(androidx.media3.ui.R.id.exo_time);
    for (int i = 0; i < time.getChildCount(); i++)
      ((TextView) time.getChildAt(i)).setTextColor(BAR_TEXT_COLOR);
    float density = getResources().getDisplayMetrics().density;
    title = new TitleRow(context, posView, (int) (PART_GAP_DP * density));
    title.setPadding((int) (TITLE_GAP_DP * density), 0, 0, 0);
    time.addView(title);
    addView(view, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    // Over the video and its subtitles, under the time bar.
    stills = new Stills(context, this::showStillTime);
    view.getOverlayFrameLayout()
        .addView(stills, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  boolean isOpen() {
    return getVisibility() == VISIBLE;
  }

  /**
   * p is tv-srvr's getPlayUrl answer: url, showName, season, episode, posMs
   * (resume point), res (the file's height, null if unknown), seasonEps
   * (the episode count of its season), trimPosMs (where the show starts past its intro), skipDurMs
   * (the Skip key's jump), subs (the episode's .srt files as vtt, [{url,
   * label, file}]), subPick (the index in subs to start on, -1 for none) and
   * stills (the scrub stills, {urlBase, gapMs}, see Stills). show is the
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
        ShowListView.years(show),
        ShowListView.episodeText(p.optInt("season"), p.optInt("episode"), p.optInt("seasonEps")),
        ShowListView.seasonsText(show),
        ShowListView.watchedText(show),
        show.status,
        res > 0 ? String.valueOf(res) : "");
    subsPicked = false;
    subOfs = 0;
    clearCues();
    stills.open(p.optJSONObject("stills"));
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
            }
            if (state == Player.STATE_READY && landing) {
              landing = false;
              ui.removeCallbacks(stillsDown);
              ui.postDelayed(stillsDown, LAND_LINGER_MS);
            }
            if (state == Player.STATE_ENDED) {
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
            if (reloadSubId != null && !tracks.isEmpty()) {
              for (Tracks.Group g : tracks.getGroups())
                if (reloadSubId.equals(g.getTrackFormat(0).id))
                  exo.setTrackSelectionParameters(
                      exo.getTrackSelectionParameters()
                          .buildUpon()
                          .setOverrideForType(new TrackSelectionOverride(g.getMediaTrackGroup(), 0))
                          .build());
              reloadSubId = null;
            }
            textGroups.clear();
            for (Tracks.Group g : tracks.getGroups()) {
              if (g.getType() != C.TRACK_TYPE_TEXT) continue;
              Format f = g.getTrackFormat(0);
              if (isSideloaded(f)) textGroups.add(g);
            }
            loadCues();
            events.onSubtitles(subtitleList());
          }

          @Override
          public void onRenderedFirstFrame() {
            view.setKeepContentOnPlayerReset(false);
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
    // The time bar reads the position from the player it is given, about once
    // a second. During a stills hold that is the still's, not the paused video's.
    view.setPlayer(
        new ForwardingPlayer(exo) {
          @Override
          public long getCurrentPosition() {
            return stillsHold && stills.shownMs() >= 0 ? stills.shownMs() : super.getCurrentPosition();
          }

          @Override
          public long getContentPosition() {
            return stillsHold && stills.shownMs() >= 0 ? stills.shownMs() : super.getContentPosition();
          }
        });
    long resumeMs = p.optLong("posMs");
    exo.setMediaItem(mediaItem(p), resumeMs > 0 ? resumeMs : p.optLong("trimPosMs"));
    exo.prepare();
    exo.play();
    setVisibility(VISIBLE);
  }

  // getPlayUrl's video with its .srt files sideloaded, each with the id SUBS_ID
  // and its index in subs.
  private static MediaItem mediaItem(JSONObject p) {
    MediaItem.Builder item = new MediaItem.Builder().setUri(p.optString("url"));
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
    return item.setSubtitleConfigurations(subConfigs).build();
  }

  /**
   * tv-srvr's subsLate: the downloads the play could not wait for have landed.
   * A video of that episode that opened with no .srt opens again where it is
   * with them, starting on the one tv-srvr picks, as reload does. One that
   * opened with some keeps them; the rest are there next time.
   */
  void addSubs(JSONObject late) {
    if (exo == null) return;
    JSONArray subs = late.optJSONArray("subs");
    JSONArray had = playing.optJSONArray("subs");
    if (subs == null || subs.length() == 0 || had != null && had.length() > 0) return;
    if (!late.optString("showName").equals(playing.optString("showName"))
        || late.optInt("season") != playing.optInt("season")
        || late.optInt("episode") != playing.optInt("episode")) return;
    try {
      playing.put("subs", subs);
      playing.put("subPick", late.optInt("subPick", -1));
    } catch (JSONException e) {
      Log.e(TAG, "late subtitles failed: " + e);
      return;
    }
    subsPicked = false;
    view.setKeepContentOnPlayerReset(true);
    exo.setMediaItem(mediaItem(playing), exo.getCurrentPosition());
  }

  /**
   * A remote key while the video is up -- tvapprc mode's arrows and ok, the
   * same keys that drive the list: ok pauses and resumes, left and right seek,
   * a tap of up ends the episode as watched and closes the video, a held up
   * jumps back to the start (trimPosMs, past the intro, when there is one),
   * skip (the remotes' Skip key) jumps over the intro by the show's skip
   * length, and down toggles the time bar. Down's bar stays until down again, any key but a seek, or the
   * video closing. A seek's is up only until the seek ends, and the bar is
   * always up while paused. repeat: an auto-repeat of a held key (the tv's
   * own remote); a left/right's first one starts a hold. Any key during a
   * remote's hold (see hold) only ends it.
   */
  void key(String key, boolean repeat) {
    if (exo == null) return;
    if (remoteHold) {
      finishHold();
      return;
    }
    boolean seek = "left".equals(key) || "right".equals(key);
    if ("down".equals(key)) barUp = !barUp;
    else if (!seek) barUp = false;
    boolean hold = seek && repeat;
    if (!hold) endHold();
    seeking = seek;
    ui.removeCallbacks(seekEnd);
    if (seek) ui.postDelayed(seekEnd, SEEK_END_MS);
    if (hold) {
      // A repeat of the held key (the tv's own remote) only keeps the hold
      // alive (seekEnd above): the hold steps on its own clock. The first one
      // starts it, and a repeat of the other key turns it round.
      if (!holding || !key.equals(holdKey)) startHold(key);
    } else {
      long pos = exo.getCurrentPosition();
      long skipDurMs = playing.optLong("skipDurMs");
      if ("ok".equals(key)) exo.setPlayWhenReady(!exo.getPlayWhenReady());
      else if ("left".equals(key)) seekBy(false, pos, -SEEK_BACK_MS);
      else if ("right".equals(key)) seekBy(false, pos, SEEK_FWD_MS);
      else if ("up".equals(key)) {
        // The press waits for a repeat to say it is a hold, or its key-up
        // (or UP_TAP_MS) to say it is a tap. Later repeats do nothing.
        if (!repeat) {
          upPending = true;
          ui.removeCallbacks(upTap);
          ui.postDelayed(upTap, UP_TAP_MS);
        } else if (upPending) {
          upPending = false;
          ui.removeCallbacks(upTap);
          exo.seekTo(playing.optLong("trimPosMs"));
        }
      }
      else if ("skip".equals(key)) {
        if (skipDurMs > 0) exo.seekTo(pos + skipDurMs);
      }
    }
    updateBar();
  }

  /**
   * The held key let go: its hold ends now. The time bar stays until seekEnd.
   * heldMs is how long the remote had the key held, -1 for the tv's own
   * remote. The key-up can come in late, and the hold has gone on stepping
   * meanwhile; heldMs past the hold's start is when the key came up, so the
   * hold lands on the still that was up then.
   */
  void keyUp(String key, long heldMs) {
    if ("up".equals(key) && upPending) {
      ui.removeCallbacks(upTap);
      upTap.run();
      return;
    }
    if (!holding || !key.equals(holdKey)) return;
    if (heldMs >= 0 && stillsHold) landAt = stills.shownAt(holdStartedAt + heldMs);
    finishHold();
  }

  /** A remote's left/right held (kh): a hold with no repeats, until its key-up. */
  void hold(String key) {
    if (exo == null) return;
    barUp = false;
    seeking = true;
    ui.removeCallbacks(seekEnd);
    remoteHold = true;
    if (!holding || !key.equals(holdKey)) startHold(key);
    updateBar();
  }

  /** A remote's socket closed: its hold gets no key-up now. */
  void dropHold() {
    if (remoteHold) finishHold();
  }

  // A hold ends, and the time bar stays up SEEK_END_MS more.
  private void finishHold() {
    endHold();
    ui.removeCallbacks(seekEnd);
    ui.postDelayed(seekEnd, SEEK_END_MS);
  }

  // A hold starts (a remote's kh, or the tv's own remote's first repeat) or
  // turns round: steps now and every holdTickMs until endHold.
  private void startHold(String key) {
    ui.removeCallbacks(holdStep);
    holding = true;
    holdKey = key;
    holdStartedAt = SystemClock.uptimeMillis();
    setScrub(true);
    stepHold();
  }

  private void stepHold() {
    if (!holding || exo == null) return;
    boolean left = "left".equals(holdKey);
    seekBy(true, seekTarget, left ? -holdStepMs() : holdStepMs());
    ui.postDelayed(holdStep, holdTickMs(left));
  }

  // A hold's step, one still, and how often it steps to keep its speed.
  private long holdStepMs() {
    return stills.has() ? stills.gapMs() : NO_STILLS_STEP_MS;
  }

  private long holdTickMs(boolean left) {
    return Math.round(holdStepMs() / (left ? HOLD_BACK_SPEED : HOLD_FWD_SPEED));
  }

  // The key-up, a fresh key, or SEEK_END_MS with no repeat.
  private void endHold() {
    if (!holding) return;
    holding = false;
    remoteHold = false;
    ui.removeCallbacks(holdStep);
    setScrub(false);
    landStills();
  }

  // A left/right, stepMs from pos. A hold shows the stills for its target
  // when the video has a set, and seeks the video when it has none.
  private void seekBy(boolean hold, long pos, long stepMs) {
    seekTarget = Math.max(0, pos + stepMs);
    if (!hold || !stills.has()) {
      exo.seekTo(seekTarget);
      return;
    }
    stillsHold = true;
    // Each step lands on a still's mark.
    long grid = Math.abs(stepMs);
    seekTarget = Math.round(seekTarget / (double) grid) * grid;
    long dur = exo.getDuration();
    if (dur > 0) seekTarget = Math.min(seekTarget, dur);
    stills.show(seekTarget, stepMs, dur);
  }

  // A still went up: the time bar says where it is now, not at its next
  // refresh, which reads the same off the player play() gave it.
  private void showStillTime() {
    long ms = stills.shownMs();
    posView.setText(Util.getStringForTime(timeText, timeFormat, ms));
    timeBar.setPosition(ms);
  }

  // A stills hold ends: the video seeks to the still on screen (the target if
  // none got there), and the still stays up until the player is ready there,
  // its frame drawn. Not at the first frame drawn: turning scrubbing off (the
  // caller does it first) brings the audio back, and that track change redraws
  // the paused video where the hold started. A still is the keyframe at or
  // before its mark (stills.js, see FFMPEG_SEEK_BACK_MS), so the seek goes to
  // that keyframe through the file's index too: an exact seek to the mark
  // started the video up to a few seconds past the still's picture.
  private void landStills() {
    if (!stillsHold || exo == null) return;
    stillsHold = false;
    landing = true;
    long ms = landAt >= 0 ? landAt : stills.shownMs() < 0 ? seekTarget : stills.shownMs();
    landAt = -1;
    stills.settle(ms);
    exo.setSeekParameters(SeekParameters.PREVIOUS_SYNC);
    exo.seekTo(Math.max(0, ms - FFMPEG_SEEK_BACK_MS));
    exo.setSeekParameters(SeekParameters.DEFAULT);
    ui.removeCallbacks(stillsDown);
    ui.postDelayed(stillsDown, LAND_MAX_MS);
  }

  // A landing's frame is on screen (LAND_LINGER_MS past ready, or LAND_MAX_MS
  // passed): the still comes down, unless a new hold has it up again.
  private void landed() {
    landing = false;
    if (!stillsHold) stills.hide();
  }

  // On for a hold (a remote's kh, or a repeat from the tv's own remote).
  // Scrubbing mode keeps playback and audio off until the hold ends,
  // under its stills. For a video with no stills it also holds each seek back
  // until the one before has drawn its frame; plain seeks each dropped the one
  // before them undrawn, and the picture froze through a hold.
  private void setScrub(boolean on) {
    if (exo != null) exo.setScrubbingModeEnabled(on);
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

  /**
   * The video opens again where it is, so its .srt files are fetched again and
   * an edit to one shows, on the subtitle track that was on. The frame on
   * screen stays up until the reopened video draws its first one, at the same
   * spot; the sound drops out meanwhile.
   */
  void reload() {
    if (exo == null) return;
    reloadSubId = null;
    for (Tracks.Group g : textGroups) if (g.isSelected()) reloadSubId = g.getTrackFormat(0).id;
    clearCues();
    view.setKeepContentOnPlayerReset(true);
    exo.setMediaItem(mediaItem(playing), exo.getCurrentPosition());
  }

  void close() {
    if (exo == null) return;
    ui.removeCallbacks(reportTick);
    ui.removeCallbacks(seekEnd);
    ui.removeCallbacks(holdStep);
    ui.removeCallbacks(stillsDown);
    ui.removeCallbacks(upTap);
    clearCues();
    upPending = false;
    seeking = false;
    holding = false;
    remoteHold = false;
    stillsHold = false;
    landing = false;
    stills.close();
    if (ready) report("stopped");
    ready = false;
    barUp = false;
    view.hideController();
    view.setKeepContentOnPlayerReset(false);
    reloadSubId = null;
    view.setPlayer(null);
    exo.release();
    exo = null;
    playing = null;
    textGroups.clear();
    setVisibility(GONE);
    events.onSubtitles(null);
  }

  /**
   * For the remote's subtitle panel: {title, tracks: [{label, type}], selected,
   * subOfs, canSync, cap}, selected -1 when subtitles are off. canSync with a
   * subtitle on, until the episode's subtitles have all been checked
   * (subsChecked), and not while a measure or a shift is on its way. Null when
   * no video is up.
   */
  JSONObject subtitleList() {
    if (exo == null || playing == null) return null;
    JSONObject out = new JSONObject();
    try {
      JSONArray tracks = new JSONArray();
      int selected = -1;
      for (int i = 0; i < textGroups.size(); i++) {
        Tracks.Group g = textGroups.get(i);
        // tv-srvr's label as it is now: its check mark follows Apply and Sync.
        JSONObject t = new JSONObject();
        t.put("label", playingSub(i).optString("label", "Track " + (i + 1)));
        t.put("type", "srt");
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
      out.put("subOfs", subOfs);
      out.put("canSync", selected >= 0 && !shifting && !playing.optBoolean("subsChecked"));
      out.put("cap", capText);
    } catch (JSONException e) {
      Log.e(TAG, "subtitle list failed: " + e);
      return null;
    }
    return out;
  }

  /** The remote's pick from subtitleList's tracks; -1 turns subtitles off. */
  void selectSubtitle(int index) {
    if (exo == null || index == selectedSub()) return;
    subOfs = 0;
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

  // The index in textGroups of the track that is on, -1 for none.
  private int selectedSub() {
    for (int i = 0; i < textGroups.size(); i++) if (textGroups.get(i).isSelected()) return i;
    return -1;
  }

  /** The panel's + and -: subOfs moves by sec; nothing is shifted until Apply. */
  void subOffset(double sec) {
    if (exo == null) return;
    // To the ms, so tenths that net to nothing come back to exactly 0.
    subOfs = Math.round((subOfs + sec) * 1000) / 1000.0;
    capText = capNow();
    events.onSubtitles(subtitleList());
  }

  /**
   * The panel's Apply: tv-srvr shifts the playing .srt on disk by subOfs, which
   * goes back to 0, and the video reloads to show it. The file is timed by hand
   * now: tv-srvr judges it again, and its label keeps the check mark only when
   * it fits, as does the episode's subsChecked. With no subtitle on there is no
   * file to shift.
   */
  void applySubOfs() {
    int sel = selectedSub();
    if (exo == null || shifting || sel < 0 || subOfs == 0) return;
    JSONObject entry = playingSub(sel);
    Uri sub = Uri.parse(entry.optString("url"));
    double target = subOfs;
    JSONObject body = new JSONObject();
    try {
      body.put("videoPath", sub.getQueryParameter("path"));
      body.put("srtFile", sub.getQueryParameter("file"));
      body.put("offsetMs", Math.round(target * 1000));
    } catch (JSONException e) {
      Log.e(TAG, "subtitle shift body failed: " + e);
      return;
    }
    shifting = true;
    JSONObject was = playing;
    new Thread(
            () -> {
              JSONObject res = null;
              try {
                res = new JSONObject(Http.postJson(SHIFT_SUBS_URL, body.toString()));
              } catch (Exception e) {
                Log.e(TAG, "subtitle shift failed: " + e);
              }
              JSONObject shifted = res;
              ui.post(
                  () -> {
                    shifting = false;
                    if (shifted == null || playing != was) return;
                    // A + or - pressed while the shift was on its way stays.
                    subOfs -= target;
                    try {
                      if (!shifted.optString("label").isEmpty())
                        entry.put("label", shifted.optString("label"));
                      playing.put("subsChecked", shifted.optBoolean("subsChecked"));
                    } catch (JSONException e) {
                      Log.e(TAG, "shifted subtitle label failed: " + e);
                    }
                    reload();
                    events.onSubtitles(subtitleList());
                  });
            },
            "sub-shift")
        .start();
  }

  /**
   * The panel's Sync: tv-srvr measures how far the showing .srt is off the
   * words of the video (subPrepare.js), and that becomes the offset, as if set
   * with + and -: the panel's caption line shows the captions it puts here, and
   * nothing is shifted until Apply; a file that fits as it is gets its check
   * mark. When no one shift fits (another cut, another rate), or none can be
   * told, a toast says why and the offset stays.
   */
  void syncSubs() {
    int sel = selectedSub();
    if (exo == null || shifting || sel < 0 || playing.optBoolean("subsChecked")) return;
    JSONObject entry = playingSub(sel);
    Uri sub = Uri.parse(entry.optString("url"));
    JSONObject body = new JSONObject();
    try {
      body.put("videoPath", sub.getQueryParameter("path"));
      body.put("srtFile", sub.getQueryParameter("file"));
    } catch (JSONException e) {
      Log.e(TAG, "subtitle measure body failed: " + e);
      return;
    }
    shifting = true;
    events.onSubtitles(subtitleList());
    JSONObject was = playing;
    new Thread(
            () -> {
              JSONObject res = null;
              try {
                res =
                    new JSONObject(
                        Http.postJson(MEASURE_SUB_URL, body.toString(), MEASURE_SUB_TIMEOUT_MS));
              } catch (Exception e) {
                Log.e(TAG, "subtitle measure failed: " + e);
              }
              JSONObject measured = res;
              ui.post(
                  () -> {
                    shifting = false;
                    if (playing != was) return;
                    if (measured != null) {
                      // A file that fits as it is was marked so.
                      try {
                        if (!measured.optString("label").isEmpty())
                          entry.put("label", measured.optString("label"));
                        playing.put("subsChecked", measured.optBoolean("subsChecked"));
                      } catch (JSONException e) {
                        Log.e(TAG, "measured subtitle label failed: " + e);
                      }
                    }
                    if (measured == null) {
                      events.onVideoError(SYNC_FAILED_TOAST);
                    } else if (measured.isNull("offsetMs")) {
                      events.onVideoError("Sync: " + measured.optString("why"));
                    } else if (selectedSub() == sel) {
                      subOfs = measured.optLong("offsetMs") / 1000.0;
                      capText = capNow();
                    }
                    events.onSubtitles(subtitleList());
                  });
            },
            "sub-measure")
        .start();
  }

  /**
   * Reads the showing .srt's captions for the panel's line, when the showing
   * track is not the one last read. reload clears cueSubId, so an edited file
   * is read again.
   */
  private void loadCues() {
    int sel = selectedSub();
    String id = sel < 0 ? null : textGroups.get(sel).getTrackFormat(0).id;
    if (Objects.equals(id, cueSubId)) return;
    clearCues();
    cueSubId = id;
    if (id == null) return;
    int seq = cueSeq;
    String url = playingSub(sel).optString("url");
    new Thread(
            () -> {
              List<String> texts = new ArrayList<>();
              List<Long> starts = new ArrayList<>();
              List<Long> ends = new ArrayList<>();
              try {
                String[] lines = Http.get(url).split("\\r?\\n");
                for (int i = 0; i < lines.length; i++) {
                  Matcher m = CUE_TIMES.matcher(lines[i]);
                  if (!m.lookingAt()) continue;
                  StringBuilder text = new StringBuilder();
                  while (i + 1 < lines.length && !lines[i + 1].trim().isEmpty())
                    text.append(text.length() > 0 ? "\n" : "").append(lines[++i].trim());
                  texts.add(text.toString().replaceAll("<[^>]*>|\\{[^}]*\\}", ""));
                  starts.add(cueMs(m, 1));
                  ends.add(cueMs(m, 5));
                }
              } catch (Exception e) {
                Log.e(TAG, "subtitle captions failed: " + e);
                return;
              }
              ui.post(
                  () -> {
                    if (cueSeq != seq) return;
                    cueStarts = starts;
                    cueEnds = ends;
                    cueTexts = texts;
                    showCap();
                  });
            },
            "sub-cues")
        .start();
  }

  /**
   * The caption line's step: the captions now (see capNow), sent to the remote
   * when they change. It follows a pause, a seek, and a + or -.
   */
  private void showCap() {
    if (exo == null) return;
    String text = capNow();
    if (!text.equals(capText)) {
      capText = text;
      events.onSubtitles(subtitleList());
    }
    ui.postDelayed(capStep, CAP_STEP_MS);
  }

  // The captions the offset not yet applied puts at the video's position, one
  // line each as on screen, "" for none. At offset 0 they are the ones on screen.
  private String capNow() {
    if (exo == null) return "";
    long pos = exo.getCurrentPosition() - Math.round(subOfs * 1000);
    StringBuilder text = new StringBuilder();
    for (int i = 0; i < cueStarts.size(); i++)
      if (cueStarts.get(i) <= pos && pos < cueEnds.get(i))
        text.append(text.length() > 0 ? "\n" : "").append(cueTexts.get(i));
    return text.toString();
  }

  private void clearCues() {
    cueSeq++;
    cueSubId = null;
    cueStarts = new ArrayList<>();
    cueEnds = new ArrayList<>();
    cueTexts = new ArrayList<>();
    capText = "";
    ui.removeCallbacks(capStep);
  }

  // The time in ms the four groups from g on in a CUE_TIMES match spell.
  private static long cueMs(Matcher m, int g) {
    return ((Long.parseLong(m.group(g)) * 60 + Long.parseLong(m.group(g + 1))) * 60
                + Long.parseLong(m.group(g + 2)))
            * 1000
        + Long.parseLong(m.group(g + 3));
  }

  // getPlayUrl's entry for the text track at this index in textGroups.
  private JSONObject playingSub(int index) {
    String id = textGroups.get(index).getTrackFormat(0).id;
    int i = Integer.parseInt(id.substring(id.indexOf(SUBS_ID) + SUBS_ID.length()));
    return playing.optJSONArray("subs").optJSONObject(i);
  }

  private static boolean isSideloaded(Format f) {
    return f.id != null && f.id.contains(SUBS_ID);
  }

  /**
   * The text track to show: the .srt tv-srvr said to start on. With none,
   * subtitles are off, so the player never falls back on an embedded track.
   */
  private void pickSubs(Tracks tracks) {
    if (tracks.isEmpty()) return;
    String pickId = SUBS_ID + playing.optInt("subPick", -1);
    Tracks.Group chosen = null;
    for (Tracks.Group g : tracks.getGroups()) {
      if (g.getType() != C.TRACK_TYPE_TEXT) continue;
      Format f = g.getTrackFormat(0);
      if (isSideloaded(f) && f.id.endsWith(pickId)) chosen = g;
    }
    subsPicked = true;
    TrackSelectionParameters.Builder b = exo.getTrackSelectionParameters().buildUpon();
    if (chosen == null) {
      b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
    } else {
      b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
          .setOverrideForType(new TrackSelectionOverride(chosen.getMediaTrackGroup(), 0));
    }
    exo.setTrackSelectionParameters(b.build());
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
      // The .srt that is showing; tv-srvr keeps the one showing at the stop as
      // the episode's chosen one.
      int sel = selectedSub();
      body.put("sub", sel < 0 ? "" : playingSub(sel).optString("file"));
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
