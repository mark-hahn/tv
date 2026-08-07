# answers
1. ignore "the up/down keys scrolls the contents of cardMisc depending on cardMisc mode". the axis is different for different cardMisc modes
2. left/right = previous/next episode cell in the shown season. the cursor just runs through the cells in order across the wrap. up/down always changes the season and does nothing else.
3. Shows key no longer plays anything. Shows key's function in tvapp mode becomes clear-the-state. i confirm your reading stated in the paragraph that starts with "I read "it's function doesn't change either". the Shows key's long press does nothing in tvapp mode.
4. cardMisc goes back to description mode. episode card is closed. a playing trailer is closed. all filters are cleared just like the clear button.
5. for now disable the tvapprc mode from web client tv remote.  make the shows key short-press only go to info pane in web client. comment out the code that only the client tv remote was using for tvapp mode so we can restore tvapprc mode easily later. 
6. remove ok long-press
7. Back is unchanged
8. keep current behavior of cardMisc modes that have no items.
9. the top of the yellow border should sit at the top of the show card card, not cardMisc. when filter group is focused left should do nothing, right should go back to the cards list, and info should do nothing. when actor card is opened and shows list is filtered the focus should go to the shows list. sort buttons and actions are unchanged.