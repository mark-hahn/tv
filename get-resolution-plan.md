# getResolution Refactor Plan

## 1. Current State — Inventory

### Resolution Functions

| Function                                | File                    | Lines     | Behavior                                                                                                                              | 576 included?       |
| --------------------------------------- | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `parseFileQuality(src)`                 | `apps/srvr/index.js`    | 2781–2789 | Regex match for `2160p/1080p/720p/576p/480p/384p` in a string; returns integer or `null` (no default)                                 | yes                 |
| `normalizeVideoHeightToQuality(height)` | `apps/srvr/index.js`    | 2794–2804 | Maps raw pixel height to standard res; `>= 528` maps to `576`                                                                         | yes                 |
| `probeFileQuality(filePath)`            | `apps/srvr/index.js`    | 2806–2831 | Runs `ffprobe` synchronously on a full path; applies `normalizeVideoHeightToQuality`; caches result in `probedVideoQualityByPath` Map | yes (via normalize) |
| `flexgetResolution(quality, title)`     | `apps/srvr/index.js`    | 6185–6195 | Like `parseFileQuality` but takes two strings; returns `480` as fallback default                                                      | yes                 |
| `flexResolution(s)`                     | `apps/down/src/main.js` | 2870–2878 | Same checks as above; returns `480` as fallback default                                                                               | yes                 |

### Call Sites

**Quality stored/saved (prime refactor targets):**

- `srvr/index.js:2881` (`getShowsFromDisk`): `const quality = parseFileQuality(fname) || probeFileQuality(path);`
- `srvr/index.js:2986` (`getShowDiskInfo`): `const quality = parseFileQuality(fname) || probeFileQuality(dirPath);`

**Quality compared between two candidates (secondary targets):**

- `srvr/index.js:6220–6221` (`flexgetIsBetterSameRun`): `flexgetResolution(a.quality, a.title)` vs same for `b`
- `srvr/index.js:6240–6241` (`flexgetIsBetterCrossRun`): same
- `down/src/main.js:3181–3182`: `flexResolution(diskFile)` vs `flexResolution(fname)`
- `down/src/main.js:3260–3261`: same pattern

---

## 2. Remove 576 from Standard Resolutions

**`apps/srvr/index.js` — `parseFileQuality`:**
Remove: `if (/576p/i.test(text)) return 576;`

**`apps/srvr/index.js` — `flexgetResolution`:**
Remove: `if (/576p/i.test(src)) return 576;`

**`apps/srvr/index.js` — `normalizeVideoHeightToQuality`:**
Remove: `if (parsedHeight >= 528) return 576;`

After removal, the `>= 400 → 480` bracket absorbs the 528–647px range. No other brackets need changing.

**`apps/down/src/main.js` — `flexResolution`:**
Remove: `if (/576p/i.test(src)) return 576;`

---

## 3. Add `normalizeVideoHeightToQuality` and `getResolution` to `packages/share/src/index.js`

### 3a. Browser-Compatibility Constraint

`packages/share/src/index.js` is imported by the browser client (`apps/client/src/util.js`). It cannot contain `import fs` or `import { execFileSync } from 'child_process'`; doing so would break the Vite build. **The file I/O for step 2 must be injectable via callback parameters.**

### 3b. Export `normalizeVideoHeightToQuality` from `share`

This is a pure math function — no Node.js dependencies. Export it from `share/src/index.js`. Remove the definition from `srvr/index.js` and import from `@tv/share`.

The updated function (576 removed):

```js
export function normalizeVideoHeightToQuality(height) {
  const parsedHeight = Number.parseInt(height, 10);
  if (!Number.isFinite(parsedHeight) || parsedHeight <= 0) return null;
  if (parsedHeight >= 1620) return 2160;
  if (parsedHeight >= 900) return 1080;
  if (parsedHeight >= 648) return 720;
  // 576 removed — 528–647px falls through to 480
  if (parsedHeight >= 400) return 480;
  if (parsedHeight >= 340) return 384;
  return null;
}
```

Also export a set of standard resolutions so callers can do `isStandard` checks without magic numbers:

```js
export const STANDARD_RESOLUTIONS = new Set([2160, 1080, 720, 480, 384]);
```

### 3c. Export `getResolution` from `share`

```js
/**
 * getResolution(nameOrPath, options) → number | null
 *
 * @param {string} nameOrPath
 *   A torrent title, bare filename, or full absolute path to a video file.
 *   Presence of '/' indicates a full path.
 *
 * @param {object} [options]
 * @param {(fullPath: string) => number | null} [options.probeFileFn]
 *   Injected by server callers. Given a full file path, runs ffprobe/mediainfo
 *   and returns the RAW vertical pixel height (e.g. 1080, 716, 576) or null.
 *   Must be synchronous. Omit in browser contexts.
 * @param {(showName: string) => string | null} [options.findShowFileFn]
 *   Injected by server callers. Given a show name, returns the full path to
 *   any representative video file in /mnt/media/tv/<showName>/ or null.
 *   Used only when nameOrPath has no '/' (i.e. is a bare filename/torrent title).
 *   Must be synchronous. Omit in browser contexts.
 *
 * @returns {number | null}
 */
export function getResolution(
  nameOrPath,
  { probeFileFn, findShowFileFn } = {},
) {
  const src = String(nameOrPath || "");

  // ── Step 1: parse <N>p from the name ──────────────────────────────────────
  let nameResolution = null;
  const nameMatch = src.match(/\b(\d{3,4})p\b/i);
  if (nameMatch) {
    nameResolution = Number.parseInt(nameMatch[1], 10);
    if (!Number.isFinite(nameResolution)) nameResolution = null;
  }
  if (nameResolution !== null && STANDARD_RESOLUTIONS.has(nameResolution)) {
    return nameResolution;
  }

  // ── Step 2: probe the actual file ─────────────────────────────────────────
  let fileResolution = null;
  if (probeFileFn) {
    let fullPath = null;
    const hasSlash = src.includes("/");

    if (hasSlash) {
      fullPath = src;
    } else if (findShowFileFn) {
      const showName = parseTitleFromFilename(src, "", null);
      if (showName) {
        fullPath = findShowFileFn(showName) ?? null;
      }
    }

    if (fullPath) {
      try {
        const rawHeight = probeFileFn(fullPath);
        if (rawHeight != null) fileResolution = Number.parseInt(rawHeight, 10);
        if (!Number.isFinite(fileResolution)) fileResolution = null;
      } catch {
        fileResolution = null;
      }
    }
  }

  if (fileResolution !== null && STANDARD_RESOLUTIONS.has(fileResolution)) {
    return fileResolution;
  }

  // ── Step 3: normalize whichever non-null value we have ────────────────────
  const heightToNormalize =
    nameResolution !== null
      ? nameResolution
      : fileResolution !== null
        ? fileResolution
        : null;

  if (heightToNormalize === null) return null;
  return normalizeVideoHeightToQuality(heightToNormalize) ?? null;
}
```

---

## 4. Update `apps/srvr/index.js`

### 4a. Add imports from `@tv/share`

```js
import {
  parseFileSeasonEpisode,
  smartTitleMatch,
  parseTitleFromFilename,
  normalizeVideoHeightToQuality, // add
  getResolution, // add
  STANDARD_RESOLUTIONS, // add
} from "@tv/share";
```

### 4b. Remove `normalizeVideoHeightToQuality` local definition (lines 2794–2804)

Already replaced by the `share` import.

### 4c. Change `probeFileQuality` to return raw height

The current `probeFileQuality` calls `normalizeVideoHeightToQuality(probeOut)` and stores the result. In the new design, the injected `probeFileFn` should return the **raw pixel height** (the integer that ffprobe outputs), not the normalized value. `getResolution` applies normalization internally.

Create a thin `probeRawHeight(filePath)` function to replace `probeFileQuality`:

```js
// Returns raw vertical pixel height (e.g. 1080, 716) or null. No normalization.
const probedRawHeightByPath = new Map();
function probeRawHeight(filePath) {
  if (!filePath) return null;
  if (probedRawHeightByPath.has(filePath))
    return probedRawHeightByPath.get(filePath);
  let h = null;
  try {
    const out = runFfprobe(
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=height",
        "-of",
        "csv=p=0",
        String(filePath),
      ],
      1024 * 1024,
    ).trim();
    const parsed = Number.parseInt(out, 10);
    h = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    h = null;
  }
  probedRawHeightByPath.set(filePath, h);
  return h;
}
```

Remove the old `probedVideoQualityByPath` Map and `probeFileQuality` function.

### 4d. Replace `parseFileQuality(fname) || probeFileQuality(path)` call sites

**Line 2881** and **line 2986** both become:

```js
const quality = getResolution(path, { probeFileFn: probeRawHeight });
```

The full path is already available at both call sites, so `findShowFileFn` is not needed there.

### 4e. Remove `parseFileQuality` local definition

No longer needed once both call sites use `getResolution`.

### 4f. Update `flexgetResolution` call sites

`flexgetResolution(a.quality, a.title)` currently returns 480 as a fallback (never null). The new `getResolution` returns null for unknown quality. When comparing flexget candidates, null should be treated as "unknown, possibly worst." Replace with:

```js
const aRes = getResolution(a.quality || a.title || "") ?? 480;
const bRes = getResolution(b.quality || b.title || "") ?? 480;
```

Remove the `flexgetResolution` local definition.

---

## 5. Update `apps/down/src/main.js`

### 5a. Add import from `@tv/share`

```js
import {
  smartTitleMatch,
  parseFileSeasonEpisode,
  parseTitleFromFilename,
  postHistory,
  TV_BLOCKED,
  getResolution, // add
} from "@tv/share";
```

### 5b. Replace `flexResolution` call sites

`down` only deals with filenames (USB filenames and filenames found on the local disk via `fs.readdirSync`). No full paths are available at the comparison sites. Step 2 (file probing) is skipped since `probeFileFn` is not injected.

Use `getResolution(src) ?? 480` as a drop-in replacement for `flexResolution(src)`:

```js
// Before:
var diskRes = flexResolution(diskFile);
var usbRes = flexResolution(fname);

// After:
var diskRes = getResolution(diskFile) ?? 480;
var usbRes = getResolution(fname) ?? 480;
```

This preserves the existing 480-fallback comparison behavior.

Remove the `flexResolution` local function definition.

---

## 6. Summary of Files Changed

| File                          | Change                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/share/src/index.js` | Add `normalizeVideoHeightToQuality`, `STANDARD_RESOLUTIONS`, `getResolution` exports                                                                                                            |
| `apps/srvr/index.js`          | Import new exports from `@tv/share`; remove `normalizeVideoHeightToQuality`, `parseFileQuality`, `probeFileQuality`, `flexgetResolution` definitions; add `probeRawHeight`; update 4 call sites |
| `apps/down/src/main.js`       | Import `getResolution` from `@tv/share`; remove `flexResolution` definition; update 4 call sites with `?? 480` fallback                                                                         |

---

## 7. Ambiguities, Contradictions, and Issues

### A. `share` package cannot contain Node.js built-ins

The spec says "maybe put `getResolution` in `packages/share/src/index.js`." The share package is imported by the browser client and must not use `fs` or `child_process`. The plan above resolves this with injected callbacks (`probeFileFn`, `findShowFileFn`). If the injectable-callback approach is rejected, the alternative is to put `getResolution` in a new server-only module (e.g., `apps/srvr/src/resolution.js`) and re-export only the pure parts from `@tv/share`.

### B. `findShowFileFn` not needed at current call sites

Both existing `parseFileQuality + probeFileQuality` call sites already have the full file path. The `findShowFileFn` (step 2 "search show folder by filename") would only be needed if a new call site existed with only a bare filename. No current call site needs this. The plan includes it for completeness per spec but it adds complexity with no immediate use. It could be deferred.

### C. 576p in name → `getResolution` returns 480

With 576 removed from `STANDARD_RESOLUTIONS`, a file named `Show.S01E01.576p.mkv` will not early-return at step 1 (576 is not standard), will not probe a file (no `/` in name at comparison sites), and will reach step 3 → `normalizeVideoHeightToQuality(576)` = 480. This is the intended behavior but is worth confirming: **576p content will be classified as 480p everywhere.**

### D. 528–647px physical height → maps to 480

`normalizeVideoHeightToQuality` currently maps physical heights 528–647 to 576. After removing that bracket, those heights silently map to 480. If a file physically measures, say, 576 pixels tall, its stored quality changes from 576 to 480 on the next scan. Old `flexget-history.json` entries that stored `576` will compare as higher quality than newly-stored `480` for the same content. This is likely acceptable but worth noting.

### E. `probedVideoQualityByPath` cache stores normalized quality; new cache stores raw height

The existing cache stores the post-normalize result. The replacement `probedRawHeightByPath` stores raw height. This is fine since `getResolution` applies normalization at call time. The cache key (file path) is unchanged.

### F. `flexResolution` always returns a number; `getResolution` can return null

Covered by the `?? 480` fallback at all `down` call sites. No behavior change.

### G. `flexgetResolution` takes two args; `getResolution` takes one

`flexgetResolution(a.quality, a.title)` checks the `quality` field first (a string like `"1080p"` from flexget metadata), then the title. The plan collapses this to `getResolution(a.quality || a.title || "")`, which is semantically equivalent since the regex checks the combined string either way.

---

## 8. Suggestions

- **`STANDARD_RESOLUTIONS` export**: Makes it easy for any caller to do `STANDARD_RESOLUTIONS.has(res)` without hardcoding the set.
- **`parseResolutionFromName(src)` export** (optional): A separate export for just the step-1 regex match, useful for callers that only need name-based extraction without probing overhead.
- **Defer `findShowFileFn`**: Implement it only when a real call site needs it, to avoid dead code.
