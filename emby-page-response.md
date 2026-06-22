
# response to emby-page-plan.md
- only use new emby web page for intro
  - keep video pane for play and chksrt
  - this fixes i1 and i2

- keep intro button overlay for all emby page openings except intro uiId
  - intro web page already has all intro functionality needed
  - use existing emby-skip-intro.user.js

- A1: ignore the instruction about the non-existant emby button in the info pane
- A2: use your suggestion
- A3: use the small exception to "display only"
  - let the script read the page's <video>.currentTime purely for the live time slot while all decisions stay server‑side.
- A4: not applicable since play ui is removed

- C1 and C2: all notes are acceptable
- S1 and S2: use your suggestions

- update the plan ./emby-page-plan.md
- stop working and describe any ambiguities, contradictions, or impossibilities in updated plan
  - only if major problem that would be hard to fix later
- feel free to stop working and make suggestions
  - only if major problem that would be hard to fix later

- implement updated emby-page-plan.md