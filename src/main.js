/*
reminder, restore ...
  start gap running

bugs ...
  google ampersand
  plus on nonemby (Younger)
  setSeasonsTxt no seasonCount (The Crow Girl)
  imdb ratings broken
  waiting broken (The Agency (2024))
  waiting for unaired says missing file (The White Lotus)
  series pane flashes while waiting for map (St. Denis Medical)

todo  ...
  grid lines in map
  
new features ..
  click anywhere to close popup
  save all settings to local storage
  blink copy-name button
  refresh filtered rows when new gap loaded
  button: set hilighted row to vis 
  map: click on season numbers for whole row
  move hilite when show hidden by select
  update imdb rating et. al. periodicaly

tabled ...
  show season meta on noemby
  when hilited show is deleted, shows old season meta
  map too tall
  sort by imdb ratings
  show actors
  prev/next hilite
  add identify to show search
  show last episode date in map (each season?)
  move common code from client to srvr
  files with no emby should be added as pickup if in tvdb
  emby with no files and has pickup, set to noemby
  add wikipedia remote the hard way
  get drama field from tvdb (as many fields as possible)
  up/down arrows
  hover hints over cond icons
*/

import {createApp} from 'vue'
import App         from './components/App.vue'

const app = createApp(App);
app.mount('#app')
