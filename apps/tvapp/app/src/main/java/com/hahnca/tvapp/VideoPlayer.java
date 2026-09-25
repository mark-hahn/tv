package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.util.Log;
import android.widget.FrameLayout;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import java.util.Collections;

/**
 * Plays a show's episode file full screen inside tvapp, straight off nginx --
 * Emby is not involved. PlayerView draws through a SurfaceView, so the frames
 * take the tv's hardware video path and get its picture processing, which a
 * GL-drawn player (mpv) did not. The ExoPlayer is built per play and released
 * on close, so nothing holds a decoder while the list is up.
 */
class VideoPlayer extends FrameLayout {

  private static final String TAG = "tvapp";

  private final PlayerView view;
  private ExoPlayer exo;

  VideoPlayer(Context context) {
    super(context);
    setBackgroundColor(Color.BLACK);
    setVisibility(GONE);
    // Only counts while this view is visible, so the screensaver is held off
    // for exactly as long as a video is up.
    setKeepScreenOn(true);
    view = new PlayerView(context);
    // No on-screen controls: the keys are tvapp's, and it swallows them while
    // a video is up.
    view.setUseController(false);
    addView(view, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
  }

  boolean isOpen() {
    return getVisibility() == VISIBLE;
  }

  /**
   * subsUrl is an .srt to show over the video, or null for none. It is flagged
   * default, so it is the text track picked; embedded ones are left off unless
   * the file flags one default itself.
   */
  void play(String url, String subsUrl) {
    close();
    exo = new ExoPlayer.Builder(getContext()).build();
    exo.addListener(
        new Player.Listener() {
          @Override
          public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_ENDED) close();
          }

          @Override
          public void onPlayerError(PlaybackException e) {
            Log.e(TAG, "video failed for " + url + ": " + e);
            close();
          }
        });
    view.setPlayer(exo);
    MediaItem.Builder item = new MediaItem.Builder().setUri(url);
    if (subsUrl != null) {
      item.setSubtitleConfigurations(
          Collections.singletonList(
              new MediaItem.SubtitleConfiguration.Builder(Uri.parse(subsUrl))
                  .setMimeType(MimeTypes.APPLICATION_SUBRIP)
                  .setSelectionFlags(C.SELECTION_FLAG_DEFAULT)
                  .build()));
    }
    exo.setMediaItem(item.build());
    exo.prepare();
    exo.play();
    setVisibility(VISIBLE);
  }

  void close() {
    if (exo == null) return;
    view.setPlayer(null);
    exo.release();
    exo = null;
    setVisibility(GONE);
  }
}
