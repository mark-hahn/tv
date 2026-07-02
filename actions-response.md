
# response to actions-plan.md

## Ambiguities
- A1: Confirmed to copy on bare alt-click
- A2: You decide
- A3: Fix it
- A4: Confirmed it acceptable
- A5: Confirmed to reset the dropdown back to Actions

## Contradictions / risks
- R1: Use B, comment out all lines
- R2: match unilog(<id>, text within src_file 
  - i suggest you use unilog/reconcile-cache.json instead of src_file
- R3: confirmed the comment prefix is valid

## Impossibilities / architectural issue
- I1: confirmed that hide/unhide only works with vite

## Suggestions
- briefly toast/flash how many sites changed but do not auto-run "Clear Selections"
- Put the comment/uncomment edit logic in a testable module
- Unhide should not change selection or scroll
- do a confirmation-free success flash

Implement plan