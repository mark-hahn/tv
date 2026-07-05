
# response to block-dupes-plan.md

- when removing redundant sibling unilog calls treat hidden siblings the same as non-hidden siblings

## Ambiguities / contradictions / risks
1. confirmed that the cache and DB stay consistent by construction
2. apply only to group-26
3. leave Volatile message fields as-is
4. use TTL pruning
5. a cache hit should not refresh the entry's timestamp, i want to see the event once-an-hour
6. treat batches so that you would get the same result as non-batching
7. noted

## Suggestions
- Add the tiny counter dedupDropped 
- show dedupDropped dounter in client in log pane in the right side of the header
  - add it to the existing counts like `3/3088/3088/71560/<dedupDropped>` 
  - it only needs to be refreshed when other numbers are already refreshed
- remove 239
- remove old debug constant guarding for all new and old sites
  - keep the old logging that was guarded assuming it isn't a duplicate in the path
  - new unilog handles event filtering in log viewer
- use other suggestions

# Steps 
- at end deploy everything and check all pm2 
  - client will be changed

- implement now unless you see a serious remaining Ambiguity, contradiction, or risk
