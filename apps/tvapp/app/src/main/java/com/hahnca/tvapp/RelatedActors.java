package com.hahnca.tvapp;

import android.content.Context;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
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
 * The count is drawn once at the left of its row, and a card's lines are the
 * shows the two share.
 *
 * Opened by the phone's down key while the Actors cardMisc has an actor under
 * its cursor. Once it is up, up and down are the display's own -- see
 * {@link ActorOverlay} -- and back, shows, sort, filter and info close it.
 */
class RelatedActors extends ActorOverlay {

  // The counts worth a row of their own. One shared show is no relation at
  // all -- it is just the cast of that show -- so the rows start at two.
  private static final int MIN_COUNT = 2;
  private static final int CARDS_PER_LINE = 3;
  private static final float COUNT_TEXT_SIZE_SP = 21.6f;
  private static final float COUNT_GAP_DP = 8f;
  private static final int COUNT_COLOR = 0xFFFFFFFF;
  private static final String EMPTY_LABEL = "No related actors.";

  RelatedActors(Context context) {
    super(context);
  }

  /**
   * Builds the display for this actor out of the whole show list -- every show,
   * not just the ones the list is currently narrowed to, since the point is
   * what the actor has been in rather than what is on screen.
   */
  void open(List<Shows.Show> shows, String actorName) {
    begin();
    List<Row> rows = rowsFor(shows, actorName);
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
   * cards, three to a line. The count belongs to the row rather than to any one
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

    List<View> cards = new ArrayList<>();
    for (Person person : row.people) cards.add(actorCard(person.actor, person.shows));
    LinearLayout lines = new LinearLayout(getContext());
    lines.setOrientation(LinearLayout.VERTICAL);
    for (int start = 0; start < cards.size(); start += CARDS_PER_LINE) {
      int end = Math.min(start + CARDS_PER_LINE, cards.size());
      LinearLayout.LayoutParams lineParams =
          new LinearLayout.LayoutParams(
              ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
      if (start > 0) lineParams.topMargin = (int) dp(CELL_GAP_DP);
      lines.addView(cardLine(cards.subList(start, end), CARDS_PER_LINE), lineParams);
    }
    view.addView(
        lines, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    return view;
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
