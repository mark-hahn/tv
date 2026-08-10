package com.hahnca.tvapp;

import android.util.Log;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The show list, read from tv-srvr's getAllTvdb — the same call and the same
 * hasEmby=1 filter the phone remote's show list uses, so the two lists agree.
 *
 * The reply is the whole tvdb dataset (a couple of megabytes), of which this ui
 * keeps only what the list and the panes show. It is fetched once, at startup,
 * on its own thread.
 */
class Shows {

  // Public https rather than a LAN port: tv-srvr listens on https only, and this
  // one-shot load is not latency-sensitive.
  private static final String SHOWS_URL =
      "https://hahnca.com/tv-srvr/api/getAllTvdb?hasEmby=0";
  private static final String TAG = "tvapp";

  /** One of the show's cast, for the Actors pane. */
  static class Actor {
    final String name;
    final String character;
    final String image;
    // tvdb's own mark for a regular of the show, as against a guest. Crew never
    // reaches this list -- tv-srvr keeps only peopleType "Actor" -- so this is
    // the whole of the difference between a regular and everyone else.
    final boolean featured;
    // tvdb's billing order, which is what the web client's Actors pane puts the
    // cast in. Absent is last, not first.
    final int sortOrder;

    Actor(JSONObject rec) {
      name = str(rec, "actor");
      character = str(rec, "character");
      image = str(rec, "image");
      featured = rec.optBoolean("isFeatured", false);
      sortOrder = rec.optInt("sortOrder", Integer.MAX_VALUE);
    }
  }

  /** One of the show's trailers, for the Trailers pane. */
  static class Trailer {
    final String name;
    final String url;

    Trailer(JSONObject rec) {
      String label = str(rec, "name");
      name = label.isEmpty() ? "Trailer" : label;
      url = str(rec, "url");
    }

    /** The imdb video, which is made here rather than read from the record. */
    Trailer(String name, String url) {
      this.name = name;
      this.url = url;
    }
  }

  /** The fields the list and the panes show, and nothing else. */
  static class Show {
    final String name;
    final String id;
    final String waitStr;
    final String image;
    final String firstAired;
    final String lastAired;
    final String status;
    final String originalCountry;
    final String countryLang;
    final String network;
    final String genres;
    final boolean notReady;
    // Whether any episode at all has a file on disk. The record's own noFiles
    // flag is not this -- it can still read false for a show whose episodes
    // are every one of them fileless -- so this counts the files itself.
    final boolean hasFile;
    final int averageRuntime;
    final int seasonCount;
    final int episodeCount;
    final int watchedCount; // -1 when the record has none
    final String overview;
    final String imdbId;
    final String imdbRatings;
    // TMDB's own id for the show, out of remote_ids, or empty for the few the
    // record has none for -- what the card's landscape image is looked up by.
    final String tmdbId;
    // What the header's two sort buttons order by. Both are already
    // "yyyy/MM/dd HH:mm:ss.SSS" in the record, so they sort as plain text.
    final String lastPlayedDate;
    final String dateCreated;
    // The backdated date tv-srvr stamped into Emby to hide the show, empty
    // when it never hid it. Watched sorts on this instead so a hidden show
    // sinks here as it does in Emby, leaving lastPlayedDate the real viewing.
    final String fakeLastPlayed;
    final boolean inToTry;
    final boolean inContinue;
    final boolean inMark;
    final boolean inLinda;
    final boolean inEmby;
    final List<Actor> characters;
    // The one list here that is not left as the record wrote it: TrailerList
    // adds the imdb video to it and takes the unplayable ones back out.
    final List<Trailer> trailers;
    final JSONArray episodeData;
    // What getRemotes wants to be told about the show, and whether the list
    // above has been through TrailerList yet.
    final JSONArray remoteIds;
    boolean trailersReady;

    Show(String name, JSONObject rec) {
      this.name = name;
      id = str(rec, "id");
      waitStr = str(rec, "waitStr");
      image = str(rec, "image");
      firstAired = str(rec, "firstAired");
      lastAired = str(rec, "lastAired");
      status = str(rec, "status");
      originalCountry = str(rec, "originalCountry");
      countryLang = join(" / ", originalCountry, str(rec, "originalLanguage"));
      network = str(rec, "originalNetwork");
      genres = joinArray(rec.optJSONArray("genres"));
      notReady = rec.optBoolean("notReady", !rec.optBoolean("inEmby", true));
      episodeData = rec.optJSONArray("episodeData");
      hasFile = anyFile(episodeData);
      averageRuntime = rec.optInt("averageRuntime", 0);
      seasonCount = rec.optInt("seasonCount", 0);
      episodeCount = rec.optInt("episodeCount", 0);
      watchedCount = rec.isNull("watchedCount") ? -1 : rec.optInt("watchedCount", -1);
      overview = str(rec, "overview");
      imdbId = str(rec, "imdbId");
      imdbRatings = str(rec, "imdbRatings");
      lastPlayedDate = str(rec, "lastPlayedDate");
      dateCreated = str(rec, "dateCreated");
      fakeLastPlayed = str(rec, "fakeLastPlayed");
      inToTry = rec.optBoolean("inToTry", false);
      inContinue = rec.optBoolean("inContinue", false);
      inMark = rec.optBoolean("inMark", false);
      inLinda = rec.optBoolean("inLinda", false);
      inEmby = rec.optBoolean("inEmby", true);
      characters = new ArrayList<>();
      JSONArray castNodes = rec.optJSONArray("characters");
      for (int i = 0; castNodes != null && i < castNodes.length(); i++) {
        JSONObject node = castNodes.optJSONObject(i);
        if (node != null) characters.add(new Actor(node));
      }
      trailers = new ArrayList<>();
      JSONArray trailerNodes = rec.optJSONArray("trailers");
      for (int i = 0; trailerNodes != null && i < trailerNodes.length(); i++) {
        JSONObject node = trailerNodes.optJSONObject(i);
        if (node != null) trailers.add(new Trailer(node));
      }
      remoteIds = rec.optJSONArray("remote_ids");
      tmdbId = remoteId(remoteIds, "TheMovieDB.com");
    }

    boolean isComedy() {
      return genres.contains("Comedy");
    }

    boolean isDrama() {
      return !isComedy();
    }
  }

  /**
   * The orders the list header's two buttons offer, plus the alphabetical one
   * that is what neither of them being on means. They are the web client's
   * sort selector choices — WATCHING is the one it shows as "Watched".
   */
  enum Sort {
    ALPHA,
    WATCHING,
    ADDED;

    /** Reading back what was remembered, which may name a sort we dropped. */
    static Sort of(String name) {
      for (Sort sort : values()) {
        if (sort.name().equals(name)) return sort;
      }
      return ALPHA;
    }
  }

  /**
   * The client's own ordering: alphabetically ascending, every other sort by
   * its date with the most recent first and no date at all at the end, and
   * ties broken by show name ascending.
   */
  static Comparator<Show> order(Sort sort) {
    return (a, b) -> {
      int result;
      if (sort == Sort.ALPHA) {
        result = sortKey(a.name).compareTo(sortKey(b.name));
      } else if (sort == Sort.WATCHING) {
        result = newestFirst(watchedKey(a), watchedKey(b));
      } else {
        result = newestFirst(a.dateCreated, b.dateCreated);
      }
      return result != 0 ? result : sortKey(a.name).compareTo(sortKey(b.name));
    };
  }

  /** The date Emby holds for the show, which is the stamped one once hidden. */
  private static String watchedKey(Show show) {
    return show.fakeLastPlayed.isEmpty() ? show.lastPlayedDate : show.fakeLastPlayed;
  }

  /** Descending, but an empty date is undated rather than ancient: it goes last. */
  private static int newestFirst(String a, String b) {
    if (a.isEmpty() || b.isEmpty()) return a.isEmpty() ? (b.isEmpty() ? 0 : 1) : -1;
    return b.compareTo(a);
  }

  interface Callback {
    /** Called on the loader thread, so post to the ui yourself. */
    void onShows(List<Show> shows);
  }

  static void load(Callback callback) {
    new Thread(
            () -> {
              try {
                callback.onShows(parse(Http.get(SHOWS_URL)));
              } catch (Exception e) {
                Log.e(TAG, "show list load failed: " + e);
              }
            },
            "shows-load")
        .start();
  }

  private static List<Show> parse(String body) throws Exception {
    JSONObject all = new JSONObject(body);
    List<Show> shows = new ArrayList<>();
    for (Iterator<String> it = all.keys(); it.hasNext(); ) {
      String name = it.next();
      shows.add(new Show(name, all.getJSONObject(name)));
    }
    // Same order as the phone's list: leading "the" ignored, case ignored.
    Collections.sort(shows, order(Sort.ALPHA));
    Log.i(TAG, "loaded " + shows.size() + " shows");
    return shows;
  }

  private static String str(JSONObject rec, String key) {
    return rec.isNull(key) ? "" : rec.optString(key, "");
  }

  /** The id one of the other databases knows this show by, or empty. */
  private static String remoteId(JSONArray remoteIds, String sourceName) {
    for (int i = 0; remoteIds != null && i < remoteIds.length(); i++) {
      JSONObject node = remoteIds.optJSONObject(i);
      if (node != null && sourceName.equals(node.optString("sourceName"))) {
        return str(node, "id");
      }
    }
    return "";
  }

  // episodeData is [season][episode] of [aired, watched, embyId, file, res],
  // seasons and episodes alike left null where there is none. A non-empty file
  // slot anywhere is what "this show has something to play" means.
  private static final int EPISODE_FILE_SLOT = 3;

  private static boolean anyFile(JSONArray episodeData) {
    if (episodeData == null) return false;
    for (int season = 0; season < episodeData.length(); season++) {
      JSONArray episodes = episodeData.optJSONArray(season);
      if (episodes == null) continue;
      for (int episode = 0; episode < episodes.length(); episode++) {
        JSONArray fields = episodes.optJSONArray(episode);
        if (fields == null || fields.isNull(EPISODE_FILE_SLOT)) continue;
        if (!fields.optString(EPISODE_FILE_SLOT, "").isEmpty()) return true;
      }
    }
    return false;
  }

  private static String join(String sep, String... parts) {
    StringBuilder out = new StringBuilder();
    for (String part : parts) {
      if (part.isEmpty()) continue;
      if (out.length() > 0) out.append(sep);
      out.append(part);
    }
    return out.toString();
  }

  private static String joinArray(JSONArray array) {
    if (array == null) return "";
    String[] parts = new String[array.length()];
    for (int i = 0; i < array.length(); i++) {
      parts[i] = array.optString(i, "");
    }
    return join(", ", parts);
  }

  static String sortKey(String name) {
    String key = name.toLowerCase();
    return key.startsWith("the ") ? key.substring(4) : key;
  }

  /** So the same actor typed or read two different ways still compares equal. */
  static String normalizeName(String name) {
    return name == null ? "" : name.trim().toLowerCase().replaceAll("\\s+", " ");
  }
}
