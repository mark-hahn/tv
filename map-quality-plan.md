# Map quality plan

## Scope and constraints

- Only plan output in this file. No code changes in this step.
- Apply quality-cell behavior in both web and Android map UIs (workspace rule: tv pane UI changes must be mirrored).

## Current code touchpoints

- Web load of show records: apps/client/src/emby.js (loadAllShows)
- Web map series assembly and filesOnDisk override: apps/client/src/components/list.vue (seriesMapAction)
- Web map cell text rendering: apps/client/src/components/map.vue (template cell spans)
- Android show list load: apps/android/App.js (fetch getAllTvdb)
- Android map rendering and cell text/bg: apps/android/App.js (renderMapContent, getCellText, getCellBg)

## Implementation plan

1. Add normalized fileQuality on show objects during loadAllShows.

- In apps/client/src/emby.js loadAllShows, ensure each show record has fileQuality as an object (default {}).
- Keep values as integers only; do not infer from legacy fields.
- Because allShows is derived from allTvdb values, this ensures allShows/shows consumers can read show.fileQuality directly.

2. Extend web series map build to include per-cell quality marker source.

- In apps/client/src/components/list.vue seriesMapAction, read fileQuality from allTvdb[show.name].fileQuality (fallback to show.fileQuality or {}).
- While applying filesOnDisk override, compute episode key SxxExx for each cell and attach cell.quality.
- For existing Emby cells and filesOnDisk-only cells, set quality if key exists; if key missing, leave quality undefined.

3. Replace web map plus sign with quality char for available-file cells.

- In apps/client/src/components/map.vue, replace current avail '+' rendering with quality digit mapping:
  - 480->4, 576->5, 720->7, 1080->1, 2160->2
  - unknown/missing quality for an available-file cell -> 0
- Preserve watched/unaired prefixes exactly as today:
  - watched prefix remains W/w as currently rendered
  - unaired prefix remains U/u as currently rendered
- Preserve no-file rendering exactly as today:
  - '-' remains for noFile cells
  - existing background logic remains
- Preserve missing-episode behavior:
  - if no cell object exists, render blank text and white background

4. Mirror the same behavior in Android map cells.

- In apps/android/App.js, during initial show list load, ensure selected show carries fileQuality object from tvdb records (default {}).
- Update getCellText to output:
  - prefix (U or W) exactly as current logic
  - suffix for available-file cells: mapped quality char, else 0 when quality missing
  - suffix for no-file cells: '-'
- Keep getCellBg unchanged so no-file and blank behaviors stay the same.
- Ensure blank/nonexistent episode cells remain empty and white.

5. Shared utility approach (optional but preferred).

- Add a small helper in each client (or shared util if feasible) to:
  - build SxxExx key from season/episode
  - map quality integer to display char
- This avoids drift between web and Android implementations.

6. Validation checklist.

- Available + watched 1080 renders as W1.
- Available + unwatched 2160 renders as 2.
- Available + missing quality renders as 0 (or W0 if watched).
- No-file watched remains W-.
- No-file unaired remains U- (matching existing prefix rules).
- Nonexistent episode cell remains blank on white background.
- Web and Android show identical map-cell text behavior.

## Ambiguities / contradictions / impossibilities

- Contradiction between prior instruction and map instruction:
  - Prior: unknown quality should not be added to fileQuality.
  - Current map instruction: unknown quality char should be 0.
  - Resolution: keep fileQuality sparse (no unknown entries), and render 0 when an available-file cell has no quality entry.
- Case of available-file cell without a valid season/episode key in fileQuality is possible; this should map to 0 by rule.
- Web currently uses lowercase display letters in template (w/u). If exact uppercase W/U is required in UI text, that is a separate explicit styling/content change decision.

## Suggestions

- Add one small debug-only log for first N cells where avail=true and quality is missing, to detect parser misses.
- Consider exposing fileQuality in any map API payload in future, so map rendering can avoid joining from separate show arrays.
