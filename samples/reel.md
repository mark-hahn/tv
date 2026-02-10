# Reel Endpoints

These endpoints manage the "Reel" feature, which scrapes Reelgood.com to suggest new TV shows.

## 1. Start Reel

Initializes a new Reel session. It fetches the Reelgood homepage and prepares the iterator.

- **URL**: `/api/startreel`
- **Method**: `POST`
- **Content-Type**: `application/json`

### Request Body

| Field        | Type       | Description                                                                      |
| ------------ | ---------- | -------------------------------------------------------------------------------- |
| `showTitles` | `string[]` | Array of show titles the user already has. Used to filter out "Have It" results. |

### Logic

1.  **Persistence**: Reloads `reel-shows.json` (processed cursor) and `reelgood-titles.json` (history of results).
2.  **Fetch HTML**: Fetches the Reelgood homepage HTML and caches it in memory (`homeHtml`).
3.  **Check Availability**: Runs a sanity check (`checkReel`) to see if there are any unprocessed titles on the page.
    - Iterates through shows in the HTML.
    - Skips shows present in `reelShows` (already processed).
    - Skips shows present in `resultTitles` (recently returned).
    - Returns `true` if a candidate is found.
4.  **Response**: Returns the history of recent results (`resultTitles`). If no candidates are found, appends a special "no more" message.

### Response

Returns an array of status strings representing the history of results.

```json
[
  "ok|Breaking Bad",
  "Have It|Game of Thrones",
  "reality|Survivor",
  "anime|One Piece"
]
```

Or if no more titles are available:

```json
["...", "msg|-- no more titles --"]
```

---

## 2. Get Reel

Retrieves the next show candidate from the current session.

- **URL**: `/api/getreel`
- **Method**: `GET`

### Logic

**Prerequisite**: `startReel` must be called first to populate `homeHtml`.

1.  **Iterator**: Parses the cached `homeHtml` to find the next show validation.
2.  **Filter - Processed**: Skips shows marked as `true` in `reelShows` (database of all checked shows).
3.  **Filter - History**: Skips shows present in `resultTitles` (recent output cache).
4.  **Mark Processed**: Marks the current candidate as processed in `reelShows` and saves to disk immediately.
5.  **Filter - Have It**: Checks if the title exists in the `showTitles` list provided during `startReel`.
    - If matched: Returns `Have It|Title`.
6.  **Fetch Details**: Fetches the specific show page from Reelgood (e.g. `https://reelgood.com/show/slug`).
7.  **Filter - Genres**: Scrapes genres from the show page.
    - Rejects if genre matches the blocklist: `anime`, `children`, `documentary`, `family`, `food`, `game Show`, `history`, `home & garden`, `musical`, `reality`, `sport`, `talk`, `stand-up`, `travel`.
    - If rejected: Returns `[genre]|Title`.
8.  **Success**: If all checks pass, returns `ok|Title`.

### Response

Returns an array of strings representing the result of the processing. Usually contains just one entry unless errors occurred or multiple skips happened.

**Success:**

```json
["ok| The Wire"]
```

**Rejection:**

```json
["reality| The Bachelor"]
```

**Already Owned:**

```json
["Have It| The Sopranos"]
```

**Error:**

```json
["error| Failed to fetch show page"]
```
