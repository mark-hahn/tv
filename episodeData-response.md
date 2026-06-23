
# response to episodeData-plan.md

- is "avail	== hasFile && !unaired" correct? -- shouldn't it be "avail ==	hasFile || !unaired" -- don't respond, just use what is correct

- if the last segment of rec.path (e.g. shows containing /) like `Good Cop/Bad Cop`, or where the Emby folder differs from the display name, then store path as <show name>//<file name> where show name presence is determined by // presence, which makes sense since // is missing the episode between the slashes

## §11 Ambiguities / contradictions / suggestions

1. follow your suggestion
2. Confirmed
3. use whichever option you want since having to deploy android is no problem and make change in step
4.  do bulk refresh and not lazily
5. noted
6. follow your recommendation port it
7. noted

## §12 follow your Suggested implementation order

note: if you see any more Ambiguities or contradictions then you decide on fix unless fix would require large rewrite -- then stop and ask me -- if you see impossibility then stop and report it

