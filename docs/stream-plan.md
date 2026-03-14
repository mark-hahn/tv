# Stream Feature Plan

## Overview

Add a **Stream** button to the tor pane header (between Tabs and Cookies) that toggles a streaming overlay pane. The pane shows which streaming providers carry the selected show. Clicking a provider opens the show's page on that provider's website.

## Data Sources

Phase 1 (now): **TMDb Watch Providers** only

- TMDb API endpoint: `GET /tv/{id}/watch/providers`
- The `moviedb-promise` library already has `moviedb.tvWatchProviders({ id })`
- Returns per-country results with categories: `flatrate`, `rent`, `buy`, `ads`, `free`
- Each provider entry has: `provider_id`, `provider_name`, `logo_path`, `display_priority`
- Also returns a `link` per country — this is a TMDb deeplink to JustWatch
- We use the US results (`results.US`)

Future phases (not implemented now):

- Watchmode API (documented API at watchmode.com)
- JustWatch (unofficial/undocumented API)
- Reelgood scraping (old code exists in codebase)
- Direct provider site searches (Netflix, Hulu, Max, Disney+, Apple TV+, Peacock, Paramount+, Amazon Prime, AMC+)

## Architecture

All searching runs concurrently (Promise.all) even though phase 1 has only one source.

```
Client (stream.vue)                  srvr (index.js)           tmdb.js
    |                                     |                       |
    |-- POST /api/getStreamProviders ---->|                       |
    |     { showName, year?, imdbId? }    |-- getStreamProviders-->|
    |                                     |   (Promise.all)       |
    |                                     |                       |-- tvWatchProviders({id})
    |                                     |                       |   (first: searchTv to get id)
    |                                     |<--- merged results ---|
    |<---- JSON response -----------------|
    |
    |  (user clicks provider)
    |-- window.open(provider deep link) -->  browser tab
```

## Files to Change

### 1. `apps/srvr/src/tmdb.js` — add `getStreamProviders()`

New exported function:

```js
export async function getStreamProviders(params) {
  const { showName, year, imdbId } = params;

  // Step 1: Find TMDb series ID (reuse existing searchTv logic)
  const searchRes = await moviedb.searchTv({ query: showName });
  const match = smartTitleMatch(showName, searchRes.results || [], year, false);
  if (!match?.id)
    return { providers: [], source: "tmdb", error: "show not found" };

  // Step 2: Get watch providers for US
  const wpRes = await moviedb.tvWatchProviders({ id: match.id });
  const us = wpRes.results?.US;
  if (!us) return { providers: [], source: "tmdb", tmdbId: match.id };

  // Step 3: Normalize into unified provider list
  //   Merge flatrate + ads + free (skip rent/buy for now)
  //   Each entry: { name, logoUrl, type, tmdbLink }
  const IMG_BASE = "https://image.tmdb.org/t/p/original";
  const providers = [];
  for (const type of ["flatrate", "ads", "free"]) {
    for (const p of us[type] || []) {
      providers.push({
        name: p.provider_name,
        logoUrl: p.logo_path ? IMG_BASE + p.logo_path : null,
        type, // "flatrate" | "ads" | "free"
        providerId: p.provider_id,
        source: "tmdb",
      });
    }
  }

  return { providers, tmdbLink: us.link, tmdbId: match.id };
}
```

### 2. `apps/srvr/index.js` — register endpoint

```js
app.post("/api/getStreamProviders", apiWrapper(tmdb.getStreamProviders));
```

Add between existing `getTmdb` and `getNote` endpoint registrations (around line 2680).

### 3. `apps/client/src/srvr.js` — add client helper

```js
export function getStreamProviders(params) {
  return httpCall("/api/getStreamProviders", params, "POST");
}
```

### 4. `apps/client/src/components/stream.vue` — new component

Props: `show` (the activeShow object), `visible` (Boolean)

Template structure:

```
<div v-if="visible" class="stream-overlay">
  <div v-if="loading">Loading...</div>
  <div v-else-if="error">{{ error }}</div>
  <div v-else>
    <div v-for="p in providers" class="stream-provider-row" @click="openProvider(p)">
      <img v-if="p.logoUrl" :src="p.logoUrl" class="provider-logo" />
      <span>{{ p.name }}</span>
      <span class="provider-type">{{ p.type }}</span>
    </div>
    <div v-if="!providers.length">No streaming providers found</div>
  </div>
</div>
```

Behavior:

- When `visible` becomes true AND `show` is set, call `srvr.getStreamProviders({ showName, year, imdbId })`
- Cache results per show name so re-toggling doesn't refetch
- `openProvider(p)` opens `tmdbLink` (the JustWatch deeplink from TMDb) in a new tab
  - TMDb's `link` field goes to JustWatch where the user can pick the provider
  - This is the most reliable way to get a direct link to the show on the provider

Styling:

- Overlay: absolute positioned inside tor pane, below the top header row
- Background: white, full width/height of tor pane minus header
- Provider rows: flexbox with logo (32x32), name, type badge
- z-index above tor content but below header

### 5. `apps/client/src/components/tor.vue` — integrate

Template changes:

- Add Stream button between Tabs and Cookies buttons (same style)
- When `showStream` is true, give button `background-color: lightgray` instead of `whitesmoke`
- Import and render `<Stream>` component after the header div, before tor content
- Pass `:show="currentShow"` and `:visible="showStream"`

Data:

- `showStream: false`

Methods:

- `toggleStream() { this.showStream = !this.showStream; }`

## Provider Deep Links

TMDb watch provider response includes a `link` field per country (US). This links to JustWatch, which has deep links to each streaming provider. This is the recommended approach since:

- TMDb doesn't provide direct provider URLs
- JustWatch handles the mapping to actual provider pages
- The link is specific to the show

When future sources (Watchmode, JustWatch API) are added, they may provide direct provider URLs.

## Deployment

Only srvr changes:

```bash
./srvr srvr
```

Client changes are handled by Vite dev server during development.

## Testing

1. Select a show in the app
2. Open tor pane
3. Click Stream button — should show overlay with loading then provider list
4. Click a provider — should open JustWatch page for the show in new tab
5. Click Stream button again — should hide overlay
6. Select different show, click Stream — should fetch new providers

## Future Enhancements

- Add Watchmode API as second concurrent source
- Add JustWatch unofficial API as third source
- Add direct provider site search links (like Tabs button does for torrent sites)
- Reelgood scraping
- Cache provider data in tvdb.json per show
- Show rent/buy providers in a separate section
