package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The related-actors display, which covers the show list while it is up: every
 * actor who has been in more than one show with the selected actor, a row per
 * number of shows shared and three cards to a line, most shared first.
 *
 * The count is drawn once at the left of its row. A card is the actor's photo,
 * their name, and under it the shows they share; it is as tall as those lines
 * need, and a line is as tall as the tallest card on it.
 *
 * Opened by the phone's down key while the Actors cardMisc has an actor under
 * its cursor, and closed by that same key -- and by back, shows, sort, filter
 * and info, which are the keys that take the screen somewhere else.
 *
 * Nothing here has a cursor: the display is read rather than moved around in.
 * Up and down walk it a screenful either way when it holds more rows than fit,
 * and back, shows, sort, filter and info are what close it -- down opened it,
 * but once it is up that key is the display's own.
 */
class RelatedActors extends ScrollView {

  // The counts worth a row of their own. One shared show is no relation at
  // all -- it is just the cast of that show -- so the rows start at two.
  private static final int MIN_COUNT = 2;
  private static final int CELLS_PER_ROW = 3;
  private static final int BACKGROUND = 0xFF000000;
  private static final float PAD_DP = 12f;
  private static final float ROW_GAP_DP = 10f;
  private static final float CELL_GAP_DP = 10f;
  private static final float PHOTO_HEIGHT_DP = 102.4f;
  private static final float PHOTO_ASPECT = 0.62f; // width / height
  private static final float CARD_PAD_DP = 8f;
  private static final float CARD_CORNER_DP = 8f;
  private static final float NAME_GAP_DP = 12f;
  private static final float NAME_TEXT_SIZE_SP = 17.28f;
  private static final float SHOW_TEXT_SIZE_SP = 12.24f;
  private static final float SHOW_LINE_GAP_DP = 2f;
  private static final float COUNT_TEXT_SIZE_SP = 21.6f;
  private static final float COUNT_GAP_DP = 8f;
  private static final float MESSAGE_TEXT_SIZE_SP = 15.3f;
  // How much of the display one press of the up key moves: nearly a screenful,
  // with the last of what was on it kept for the eye to carry over.
  private static final float SCROLL_PAGE_FRACTION = 0.85f;
  private static final int CARD_BG = 0xFF2B2B2B;
  private static final int NAME_COLOR = 0xFFFFFFFF;
  private static final int SHOW_COLOR = 0xCCFFFFFF;
  private static final int COUNT_COLOR = 0xFFFFFFFF;
  private static final int PHOTO_PLACEHOLDER_BG = 0xFF303030;
  private static final String EMPTY_LABEL = "No related actors.";

  private final LinearLayout column;

  RelatedActors(Context context) {
    super(context);
    setBackgroundColor(BACKGROUND);
    setVisibility(View.GONE);
    column = new LinearLayout(context);
    column.setOrientation(LinearLayout.VERTICAL);
    int pad = (int) dp(PAD_DP);
    column.setPadding(pad, pad, pad, pad);
    addView(
        column,
        new ScrollView.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
  }

  boolean isOpen() {
    return getVisibility() == View.VISIBLE;
  }

  void close() {
    setVisibility(View.GONE);
    column.removeAllViews();
  }

  /**
   * The up and down keys: a screenful either way through the rows, stopping at
   * their two ends -- the scroll does nothing at all when they all fit
   * already. direction is -1 for up and +1 for down.
   */
  void scrollPage(int direction) {
    int step = Math.max(1, Math.round(getHeight() * SCROLL_PAGE_FRACTION));
    smoothScrollBy(0, direction * step);
  }

  /**
   * Builds the display for this actor out of the whole show list -- every show,
   * not just the ones the list is currently narrowed to, since the point is
   * what the actor has been in rather than what is on screen.
   */
  void open(List<Shows.Show> shows, String actorName) {
    column.removeAllViews();
    List<Row> rows = rowsFor(shows, actorName);
    setVisibility(View.VISIBLE);
    scrollTo(0, 0);
    for (Row row : rows) column.addView(rowView(row), rowParams(column.getChildCount() == 0));
    // Under the selected actor's own row, which is always there.
    if (rows.size() <= 1) column.addView(message(EMPTY_LABEL), rowParams(rows.isEmpty()));
  }

  /**
   * The shows the actor is in, gathering for each of the rest of their casts
   * the shows that person shares with them, and then a row per number of
   * shared shows, biggest first. An actor with two roles in one show is still
   * one show, so each show counts each person once.
   *
   * The actor the rows are about leads them off in a row of their own,
   * counting every show they are in.
   */
  private static List<Row> rowsFor(List<Shows.Show> shows, String actorName) {
    String target = Shows.normalizeName(actorName);
    Map<String, Person> related = new HashMap<>();
    Person own = new Person(null);
    for (Shows.Show show : shows) {
      boolean inShow = false;
      for (Shows.Actor actor : show.characters) {
        if (Shows.normalizeName(actor.name).equals(target)) {
          inShow = true;
          own.keepBetter(actor);
          break;
        }
      }
      if (!inShow) continue;
      own.shows.add(show.name);
      Set<String> counted = new HashSet<>();
      for (Shows.Actor actor : show.characters) {
        String key = Shows.normalizeName(actor.name);
        if (key.isEmpty() || key.equals(target) || !counted.add(key)) continue;
        Person person = related.get(key);
        if (person == null) {
          person = new Person(actor);
          related.put(key, person);
        }
        person.keepBetter(actor);
        person.shows.add(show.name);
      }
    }

    Map<Integer, Row> byCount = new HashMap<>();
    for (Person person : related.values()) {
      int count = person.shows.size();
      if (count < MIN_COUNT) continue;
      Collections.sort(person.shows, String.CASE_INSENSITIVE_ORDER);
      Row row = byCount.get(count);
      if (row == null) {
        row = new Row(count);
        byCount.put(count, row);
      }
      row.people.add(person);
    }
    List<Row> rows = new ArrayList<>(byCount.values());
    Collections.sort(rows, (a, b) -> Integer.compare(b.count, a.count));
    for (Row row : rows) {
      Collections.sort(row.people, (a, b) -> a.actor.name.compareToIgnoreCase(b.actor.name));
    }
    if (own.actor != null) {
      Collections.sort(own.shows, String.CASE_INSENSITIVE_ORDER);
      Row ownRow = new Row(own.shows.size());
      ownRow.people.add(own);
      rows.add(0, ownRow);
    }
    return rows;
  }

  /**
   * The count, drawn once at the left of the whole row, and then the row's
   * cards, two to a line. The count belongs to the row rather than to any one
   * card, so a new count is a new row.
   */
  private View rowView(Row row) {
    LinearLayout view = new LinearLayout(getContext());
    view.setOrientation(LinearLayout.HORIZONTAL);

    TextView label = new TextView(getContext());
    label.setText(row.count + ":");
    label.setTextColor(COUNT_COLOR);
    label.setTextSize(TypedValue.COMPLEX_UNIT_SP, COUNT_TEXT_SIZE_SP);
    LinearLayout.LayoutParams labelParams =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    labelParams.rightMargin = (int) dp(COUNT_GAP_DP);
    labelParams.topMargin = (int) dp(CARD_PAD_DP);
    view.addView(label, labelParams);

    LinearLayout lines = new LinearLayout(getContext());
    lines.setOrientation(LinearLayout.VERTICAL);
    for (int start = 0; start < row.people.size(); start += CELLS_PER_ROW) {
      int end = Math.min(start + CELLS_PER_ROW, row.people.size());
      LinearLayout.LayoutParams lineParams =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      if (start > 0) lineParams.topMargin = (int) dp(CELL_GAP_DP);
      lines.addView(cardLine(row.people.subList(start, end)), lineParams);
    }
    view.addView(
        lines, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    return view;
  }

  /**
   * One line of cards, each taking the same half of the width whether or not
   * it has an actor in it -- the odd card at the end of a row is as wide as
   * every other one.
   */
  private View cardLine(List<Person> people) {
    LinearLayout line = new LinearLayout(getContext());
    line.setOrientation(LinearLayout.HORIZONTAL);
    for (int i = 0; i < CELLS_PER_ROW; i++) {
      View card = i < people.size() ? actorCard(people.get(i)) : new View(getContext());
      LinearLayout.LayoutParams params =
          new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
      if (i > 0) params.leftMargin = (int) dp(CELL_GAP_DP);
      line.addView(card, params);
    }
    return line;
  }

  private View actorCard(Person row) {
    LinearLayout card = new LinearLayout(getContext());
    card.setOrientation(LinearLayout.HORIZONTAL);
    int pad = (int) dp(CARD_PAD_DP);
    card.setPadding(pad, pad, pad, pad);
    GradientDrawable bg = new GradientDrawable();
    bg.setCornerRadius(dp(CARD_CORNER_DP));
    bg.setColor(CARD_BG);
    card.setBackground(bg);

    int photoHeight = (int) dp(PHOTO_HEIGHT_DP);
    int photoWidth = Math.max(1, Math.round(photoHeight * PHOTO_ASPECT));
    ImageView photo = new ImageView(getContext());
    photo.setScaleType(ImageView.ScaleType.CENTER_CROP);
    photo.setBackgroundColor(PHOTO_PLACEHOLDER_BG);
    card.addView(photo, new LinearLayout.LayoutParams(photoWidth, photoHeight));
    if (row.actor.image.isEmpty()) {
      // The same TMDB lookup the cast strip does for the actors tvdb has no
      // picture of, so a face here is as likely as a face there.
      ActorPhotos.get(
          row.actor.name,
          url -> {
            if (!url.isEmpty()) Images.into(photo, url, photo);
          });
    } else {
      Images.into(photo, row.actor.image, photo);
    }

    LinearLayout lines = new LinearLayout(getContext());
    lines.setOrientation(LinearLayout.VERTICAL);
    TextView name = new TextView(getContext());
    name.setText(row.actor.name);
    name.setTextColor(NAME_COLOR);
    name.setTextSize(TypedValue.COMPLEX_UNIT_SP, NAME_TEXT_SIZE_SP);
    lines.addView(
        name,
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    for (String showName : row.shows) {
      TextView line = new TextView(getContext());
      line.setText(showName);
      line.setTextColor(SHOW_COLOR);
      line.setTextSize(TypedValue.COMPLEX_UNIT_SP, SHOW_TEXT_SIZE_SP);
      LinearLayout.LayoutParams lineParams =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      lineParams.topMargin = (int) dp(SHOW_LINE_GAP_DP);
      lines.addView(line, lineParams);
    }
    LinearLayout.LayoutParams linesParams =
        new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    linesParams.leftMargin = (int) dp(NAME_GAP_DP);
    card.addView(lines, linesParams);
    return card;
  }

  private TextView message(String value) {
    TextView view = new TextView(getContext());
    view.setText(value);
    view.setTextColor(SHOW_COLOR);
    view.setTextSize(TypedValue.COMPLEX_UNIT_SP, MESSAGE_TEXT_SIZE_SP);
    return view;
  }

  private LinearLayout.LayoutParams rowParams(boolean first) {
    LinearLayout.LayoutParams params =
        new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    if (!first) params.topMargin = (int) dp(ROW_GAP_DP);
    return params;
  }

  private float dp(float value) {
    return TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics());
  }

  /** One count, and everyone who shares that many shows with the selected actor. */
  private static class Row {
    final int count;
    final List<Person> people = new ArrayList<>();

    Row(int count) {
      this.count = count;
    }
  }

  /** One actor, and the shows they share with the selected one. */
  private static class Person {
    Shows.Actor actor;
    final List<String> shows = new ArrayList<>();

    Person(Shows.Actor actor) {
      this.actor = actor;
    }

    /** The record that carries a photo is the one worth keeping. */
    void keepBetter(Shows.Actor candidate) {
      if (actor == null || (actor.image.isEmpty() && !candidate.image.isEmpty())) {
        actor = candidate;
      }
    }
  }
}
