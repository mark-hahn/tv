
## Reel tab

- create a new tab with a pane connected. the tab should be "Reel" and placed between Actors and Tor. The pane is reelPane.

## reelPane pane

- reelPane should be the same size and position as series.vue. the pane should be the component src/components/reel.vue.

- the pane should contain two boxes side-by-side called reelLeft on left and reelRight on right. each box should be the full height 

- reelPane has global variables: curTitle a string,  curTvdb a tvdb object, and titleStrings which is an array of strings.

## reelGallery component in reelLeft box

- reelLeft contains a component called reelGallery in src/components/reel-gallery.vue. 

- reelGallery is a scrolling pane of cards with each card showing an image and caption. each card matches an entry in an array of tvdb records returned from srchTvdbData(title) in src/tvdb.js. 

- when the pane is loaded or whenever a property called srchStr changes, srchTvdbData() should be called with that property srchStr to get the list of tvdb records and show the cards. Then the top card should be selected.

## gallery card

- the file samples/sample-tvdbs/somebody-series-base.json has an example of a tvdb record. that record has a property "image" that is the url of the image for the card. the caption of the card is text with fields in the format "<year> - <name>" where each field name is a property in the tvdb record for that card.

- when a gallery card is clicked it is selected and curTvdb is set to the tvdb object for that card. There is always just one card selected.

- if the reelGallery card is selected the background should be light-yellow otherwise white.

## reelRight box

- reelRight has 4 panes stacked vertically.  They are reelInfo, reelDescr, reelButtons, and reelTitles.

## reelInfo box 

- reelInfo has one line of text with fields in the format "<year> | <originalCountry> | <originalLanguage> | <network> | <averageRuntime>" where each field name is a property in curTvdb.

## reelDescr box

- reelDescr is a text box containing the property "overview"  in curTvdb.

## reelButtons box

- reelButtons contains a row of buttons: Load, Google, Imdb, Prev, and Next. these buttons do nothing for now.

## reelTitles box

- reelTitles is a scrolling pane of title cards based on the array titleStrings.

- each entry in titleStrings is a string of the format "<rejectStatus>|<titleString>".

- each card in reelTitles is one text line tall. if the entry has a rejectStatus of "ok" then the card is just the string titleString, otherwise it has a box on the left 120px wide with the text rejectStatus and a box on the right containing titleString.

- when a card in reelTitles is clicked it becomes the selected card and curTitle is set to the titleString for that card. There is always just one card selected.

- if the card is selected the background should be light-yellow. if not selected and has the rejectStatus "ok" then it should have a light-green background. if not light-yellow or light-green then it should have a white background.

- when titleStrings is loaded or changed the reelTitles pane should be scrolled to the bottom and the bottom card selected.

## testing

- for testing the titleStrings should be the array ["documentary|Taylor Swift: The End of an Era", "documentary|Vantara: Sanctuary Stories", "ok|"Castle Rock"].

- for testing curTvdb should be the object in samples/sample-tvdbs/somebody-series-base.json.

- for testing the reelGallery component should have a srchStr property of "friends".

- when curTitle, curTvdb, or titleStrings is set then that value should be logged.
