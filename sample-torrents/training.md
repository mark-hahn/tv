# Caption Detection Training Results

Generated: 2025-12-11T01:52:21.809Z

## Algorithm

### Keyword Detection

Searches for weighted patterns in the HTML:

| Pattern | Weight | Description |
|---------|--------|-------------|
| Subtitle Section Header | 10 | Strong indicator |
| Stream Kind Text | 10 | Strong indicator |
| UTF8 Subtitle Codec | 10 | Strong indicator |
| ASS Subtitle Codec | 10 | Strong indicator |
| Text Count | 8 | Strong indicator |
| Text Codecs UTF-8 | 8 | Strong indicator |
| Codec ID S_TEXT | 8 | Strong indicator |
| Text line marker | 6 | Strong indicator |
| S_TEXT Codec ID generic | 5 | Strong indicator |
| Language English (strong) | 3 | Strong indicator |
| Language English (weak) | 1 | Strong indicator |
| subtitle keyword | 1 | Strong indicator |
| caption keyword | 1 | Strong indicator |

**Threshold:** Score ≥ 10 indicates captions present

### Group-Based Detection

Uses training data to determine if a release group typically includes captions.
If >50% of training samples for a group have captions, predict yes for that group.

### Combined Prediction

Final prediction: **Keyword Match OR Group Prediction**

## Group Statistics from Training Data

### IPTorrents Groups

| Group | Samples | With Captions | Rate |
|-------|---------|---------------|------|
| megusta | 5 | 0 | 0% |
| mzabi | 2 | 0 | 0% |
| d3g | 2 | 2 | 100% |
| framestor | 1 | 0 | 0% |
| ctrlhd | 1 | 0 | 0% |
| turg | 1 | 1 | 100% |
| stc | 1 | 0 | 0% |
| amber | 1 | 0 | 0% |
| cbfm | 1 | 1 | 100% |
| cmrg | 1 | 1 | 100% |
| xen0n | 1 | 1 | 100% |
| snake | 1 | 1 | 100% |
| zmnt | 1 | 0 | 0% |
| visum | 1 | 0 | 0% |
| ethel | 1 | 1 | 100% |
| psa | 1 | 1 | 100% |
| higgsboson | 1 | 1 | 100% |

### TorrentLeech Groups

| Group | Samples | With Captions | Rate |
|-------|---------|---------------|------|
| edge2020 | 2 | 2 | 100% |
| psa | 2 | 2 | 100% |
| unknown | 2 | 2 | 100% |
| btn | 1 | 1 | 100% |
| trollhd | 1 | 0 | 0% |
| orpheus | 1 | 0 | 0% |
| bordure | 1 | 1 | 100% |
| stc | 1 | 1 | 100% |
| dh | 1 | 1 | 100% |
| cbfm | 1 | 1 | 100% |
| successfulcrab | 1 | 1 | 100% |
| framestor | 1 | 1 | 100% |
| bone | 1 | 0 | 0% |
| tla | 1 | 0 | 0% |
| fov | 1 | 0 | 0% |
| flux | 1 | 1 | 100% |
| ethel | 1 | 1 | 100% |
| elite | 1 | 1 | 100% |
| taoe | 1 | 1 | 100% |
| ntb | 1 | 1 | 100% |

## IPTorrents Results

### Training Set

Accuracy: 23/23 (100.0%)

| Index | Group | Actual | Keyword | Group | Final | Score | Result |
|-------|-------|--------|---------|-------|-------|-------|--------|
| 1 | mzabi | No | No | No | No | 0 | ✓ |
| 2 | framestor | No | No | No | No | 7 | ✓ |
| 3 | ctrlhd | No | No | No | No | 0 | ✓ |
| 4 | mzabi | No | No | No | No | 0 | ✓ |
| 5 | turg | Yes | Yes | Yes | Yes | 329 | ✓ |
| 6 | stc | No | No | No | No | 0 | ✓ |
| 7 | amber | No | No | No | No | 0 | ✓ |
| 8 | cbfm | Yes | No | Yes | Yes | 0 | ✓ |
| 9 | megusta | No | No | No | No | 0 | ✓ |
| 10 | megusta | No | No | No | No | 0 | ✓ |
| 11 | megusta | No | No | No | No | 0 | ✓ |
| 12 | cmrg | Yes | Yes | Yes | Yes | 150 | ✓ |
| 13 | xen0n | Yes | Yes | Yes | Yes | 11 | ✓ |
| 14 | snake | Yes | Yes | Yes | Yes | 16 | ✓ |
| 15 | megusta | No | No | No | No | 0 | ✓ |
| 16 | zmnt | No | No | No | No | 0 | ✓ |
| 17 | d3g | Yes | Yes | Yes | Yes | 16 | ✓ |
| 18 | visum | No | No | No | No | 0 | ✓ |
| 19 | d3g | Yes | No | Yes | Yes | 2 | ✓ |
| 20 | megusta | No | No | No | No | 0 | ✓ |
| 21 | ethel | Yes | No | Yes | Yes | 0 | ✓ |
| 22 | psa | Yes | No | Yes | Yes | 1 | ✓ |
| 23 | higgsboson | Yes | No | Yes | Yes | 1 | ✓ |

### Test Set

Accuracy: 7/14 (50.0%)

| Index | Group | Actual | Keyword | Group | Final | Score | Group Info | Result |
|-------|-------|--------|---------|-------|-------|-------|------------|--------|
| 24 | playweb | Yes | No | No | No | 1 | unknown | ✗ |
| 25 | playweb | No | No | No | No | 0 | unknown | ✗ |
| 26 | playweb | Yes | No | No | No | 1 | unknown | ✗ |
| 27 | megusta | No | No | No | No | 0 | 0/5 | ✓ |
| 28 | jff | Yes | Yes | No | Yes | 37 | unknown | ✓ |
| 29 | hone | Yes | Yes | No | Yes | 20 | unknown | ✓ |
| 30 | ninjacentral | Yes | Yes | No | Yes | 37 | unknown | ✓ |
| 31 | hone | Yes | Yes | No | Yes | 62 | unknown | ✓ |
| 32 | hone | Yes | Yes | No | Yes | 62 | unknown | ✓ |
| 33 | playweb | Yes | Yes | No | Yes | 62 | unknown | ✓ |
| 34 | psa | No | No | Yes | Yes | 0 | 1/1 | ✗ |
| 35 | flux | Yes | No | No | No | 1 | unknown | ✗ |
| 36 | fenix | Yes | No | No | No | 1 | unknown | ✗ |
| 37 | playweb | Yes | No | No | No | 1 | unknown | ✗ |

## TorrentLeech Results

### Training Set

Accuracy: 23/23 (100.0%)

| Index | Group | Actual | Keyword | Group | Final | Score | Result |
|-------|-------|--------|---------|-------|-------|-------|--------|
| 1 | edge2020 | Yes | No | Yes | Yes | 3 | ✓ |
| 2 | btn | Yes | Yes | Yes | Yes | 50 | ✓ |
| 3 | trollhd | No | No | No | No | 2 | ✓ |
| 4 | orpheus | No | No | No | No | 0 | ✓ |
| 5 | bordure | Yes | No | Yes | Yes | 0 | ✓ |
| 6 | edge2020 | Yes | No | Yes | Yes | 3 | ✓ |
| 7 | psa | Yes | Yes | Yes | Yes | 899 | ✓ |
| 8 | stc | Yes | Yes | Yes | Yes | 899 | ✓ |
| 9 | dh | Yes | Yes | Yes | Yes | 50 | ✓ |
| 10 | cbfm | Yes | No | Yes | Yes | 0 | ✓ |
| 11 | successfulcrab | Yes | No | Yes | Yes | 0 | ✓ |
| 12 | framestor | Yes | No | Yes | Yes | 1 | ✓ |
| 13 | unknown | Yes | No | Yes | Yes | 3 | ✓ |
| 14 | bone | No | No | No | No | 0 | ✓ |
| 15 | unknown | Yes | No | Yes | Yes | 0 | ✓ |
| 16 | tla | No | No | No | No | 0 | ✓ |
| 17 | fov | No | No | No | No | 0 | ✓ |
| 18 | flux | Yes | No | Yes | Yes | 3 | ✓ |
| 19 | ethel | Yes | No | Yes | Yes | 0 | ✓ |
| 20 | elite | Yes | Yes | Yes | Yes | 11 | ✓ |
| 21 | psa | Yes | Yes | Yes | Yes | 693 | ✓ |
| 22 | taoe | Yes | Yes | Yes | Yes | 98 | ✓ |
| 23 | ntb | Yes | Yes | Yes | Yes | 98 | ✓ |

### Test Set

Accuracy: 8/14 (57.1%)

| Index | Group | Actual | Keyword | Group | Final | Score | Group Info | Result |
|-------|-------|--------|---------|-------|-------|-------|------------|--------|
| 24 | organic | No | No | No | No | 0 | unknown | ✗ |
| 25 | organic | No | No | No | No | 0 | unknown | ✗ |
| 26 | organic | No | No | No | No | 0 | unknown | ✗ |
| 27 | ntb | No | No | Yes | Yes | 0 | 1/1 | ✗ |
| 28 | ivy | Yes | No | No | No | 3 | unknown | ✗ |
| 29 | yawnix | Yes | Yes | No | Yes | 25 | unknown | ✓ |
| 30 | edge2020 | Yes | Yes | Yes | Yes | 25 | 2/2 | ✓ |
| 31 | ntb | Yes | No | Yes | Yes | 1 | 1/1 | ✓ |
| 32 | edge2020 | Yes | Yes | Yes | Yes | 25 | 2/2 | ✓ |
| 33 | psa | Yes | Yes | Yes | Yes | 72 | 2/2 | ✓ |
| 34 | dnu | Yes | Yes | No | Yes | 190 | unknown | ✓ |
| 35 | d3g | Yes | No | No | No | 5 | unknown | ✗ |
| 36 | stc | Yes | Yes | Yes | Yes | 48 | 1/1 | ✓ |
| 37 | amber | Yes | Yes | No | Yes | 88 | unknown | ✓ |

## Overall Summary

**Training Accuracy:** 46/46 (100.0%)

**Test Accuracy:** 15/28 (53.6%)

### Prediction Method Breakdown (Test Set)

| Provider | Keyword Only | Group Only | Both | Neither |
|----------|--------------|------------|------|----------|
| IPT | 6 | 1 | 0 | 7 |
| TL | 3 | 2 | 4 | 5 |
