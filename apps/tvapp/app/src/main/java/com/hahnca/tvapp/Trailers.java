package com.hahnca.tvapp;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** What both the trailer card and the player need to know about a trailer url. */
class Trailers {

  private static final Pattern YOUTUBE_ID =
      Pattern.compile("(?:[?&]v=|youtu\\.be/|/embed/)([A-Za-z0-9_-]{6,})");
  // A file the player's video element can take. Not .m3u8: the WebView has no
  // HLS of its own, so those play as nothing at all.
  private static final Pattern VIDEO_FILE =
      Pattern.compile("\\.(mp4|webm|ogg|mov)(\\?|$)", Pattern.CASE_INSENSITIVE);
  // YouTube's own still for a video. hqdefault is 4:3 with the picture letter-
  // boxed inside it, which a 16:9 card crops back off.
  private static final String THUMBNAIL_URL = "https://img.youtube.com/vi/%s/hqdefault.jpg";

  /** The video id, or null when the url is not a YouTube one. */
  static String youtubeId(String url) {
    Matcher matcher = YOUTUBE_ID.matcher(url);
    return matcher.find() ? matcher.group(1) : null;
  }

  static boolean isYoutube(String url) {
    return youtubeId(url) != null;
  }

  /** Whether the player has anything to do with this url at all. */
  static boolean isVideoFile(String url) {
    return VIDEO_FILE.matcher(url).find();
  }

  /** The still to show on the card, or "" when there is none to be had. */
  static String thumbnail(String url) {
    String videoId = youtubeId(url);
    return videoId == null ? "" : String.format(THUMBNAIL_URL, videoId);
  }
}
