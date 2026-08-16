package com.hahnca.tvapp;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The show-count display, which covers the show list while it is up: the
 * actors in the most shows, four cards to a line, the most shows first. A
 * card's one line under the name is how many shows that actor is in.
 *
 * One card is always under the cursor, the four arrow keys move it, and ok
 * narrows the show list to that actor -- which is the activity's to do, and
 * the same filter the cast strip in cardMisc puts on. Opened by the phone's up
 * key while the Actors cardMisc has the focus, and closed by back, shows,
 * sort, filter and info.
 */
class ShowCounts extends ActorOverlay {

  private static final int CARDS_PER_LINE = 4;
  // The far end of the list is actors in one or two shows, of which there are
  // thousands: only the head of it is worth drawing.
  private static final int ACTOR_LIMIT = 100;
  // The cursor, in the same red the cast strip in cardMisc draws its own with.
  private static final int FOCUS_BORDER = 0xFFFF0000;
  private static final float FOCUS_BORDER_DP = 3f;
  private static final String EMPTY_LABEL = "No actors.";

  // The cards, in the order the cursor steps through them, and which of them
  // it is on -- or -1 while the display has none.
  private final List<View> cards = new ArrayList<>();
  private final List<Person> shown = new ArrayList<>();
  private int focusIndex = -1;

  ShowCounts(Context context) {
    super(context);
  }

  @Override
  void close() {
    super.close();
    cards.clear();
    shown.clear();
    focusIndex = -1;
  }

  /** The four arrow keys: one card either way, and a line either way. */
  @Override
  void arrowKey(String key) {
    int step;
    if ("left".equals(key)) step = -1;
    else if ("right".equals(key)) step = +1;
    else if ("up".equals(key)) step = -CARDS_PER_LINE;
    else if ("down".equals(key)) step = +CARDS_PER_LINE;
    else return;
    if (focusIndex < 0) return;
    int next = Math.max(0, Math.min(cards.size() - 1, focusIndex + step));
    if (next == focusIndex) return;
    focusIndex = next;
    paintFocus();
    scrollFocusIntoView();
  }

  @Override
  String focusedActorName() {
    if (focusIndex < 0 || focusIndex >= shown.size()) return null;
    return shown.get(focusIndex).actor.name;
  }

  /**
   * Builds the display out of the whole show list -- every show, not just the
   * ones the list is currently narrowed to.
   */
  void open(List<Shows.Show> shows) {
    begin();
    cards.clear();
    shown.clear();
    focusIndex = -1;
    shown.addAll(peopleFor(shows));
    if (shown.isEmpty()) {
      column.addView(message(EMPTY_LABEL), rowParams(true));
      return;
    }
    for (Person person : shown) {
      cards.add(actorCard(person.actor, Arrays.asList(countLabel(person.count))));
    }
    for (int start = 0; start < cards.size(); start += CARDS_PER_LINE) {
      int end = Math.min(start + CARDS_PER_LINE, cards.size());
      column.addView(
          cardLine(cards.subList(start, end), CARDS_PER_LINE),
          rowParams(column.getChildCount() == 0));
    }
    focusIndex = 0;
    paintFocus();
  }

  private void paintFocus() {
    for (int i = 0; i < cards.size(); i++) {
      GradientDrawable bg = (GradientDrawable) cards.get(i).getBackground();
      bg.setStroke(i == focusIndex ? (int) dp(FOCUS_BORDER_DP) : 0, FOCUS_BORDER);
    }
  }

  /** Brings the line the cursor just moved onto into the display's own window. */
  private void scrollFocusIntoView() {
    if (focusIndex < 0 || focusIndex >= cards.size()) return;
    View parent = (View) cards.get(focusIndex).getParent();
    post(
        () -> {
          int top = parent.getTop();
          int bottom = parent.getBottom();
          if (top < getScrollY()) smoothScrollTo(0, top);
          else if (bottom > getScrollY() + getHeight()) smoothScrollTo(0, bottom - getHeight());
        });
  }

  private static String countLabel(int count) {
    return count + (count == 1 ? " show" : " shows");
  }

  /**
   * Every actor in the whole dataset by how many shows they are in, most
   * first, and only as far down that list as is worth drawing. An actor with
   * two roles in one show is still one show, so each show counts each of its
   * cast once.
   */
  private static List<Person> peopleFor(List<Shows.Show> shows) {
    Map<String, Person> people = new HashMap<>();
    for (Shows.Show show : shows) {
      Set<String> counted = new HashSet<>();
      for (Shows.Actor actor : show.characters) {
        String key = Shows.normalizeName(actor.name);
        if (key.isEmpty() || !counted.add(key)) continue;
        Person person = people.get(key);
        if (person == null) {
          person = new Person(actor);
          people.put(key, person);
        }
        person.keepBetter(actor);
        person.count++;
      }
    }
    List<Person> ranked = new ArrayList<>(people.values());
    Collections.sort(
        ranked,
        (a, b) -> {
          int byCount = Integer.compare(b.count, a.count);
          return byCount != 0 ? byCount : a.actor.name.compareToIgnoreCase(b.actor.name);
        });
    return ranked.subList(0, Math.min(ACTOR_LIMIT, ranked.size()));
  }

  /** One actor, and how many shows they are in. */
  private static class Person {
    Shows.Actor actor;
    int count;

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
