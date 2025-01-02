/*
reminder, restore ...
  gap checks
  cache

bugs ...
  extra shows from getTvdbData
  uneven season lengths break file missing 
          (Interview with the Vampire)
  no hit on tvdb (Daddy Issues)
  
todo ...
  chg no show in tvdb err to pop-up notification
  if emby show has no files and has pickup, set to noemby
  files with no emby should be added as pickup if in tvdb
  show meta on right
  prev/next hilite
  get drama field from tvdb (as many fields as possible)
  put imdb/rotten at top of list
  add wikipedia remote the hard way

new features ...
  show last episode date in map (each season?)
  refresh filtered rows when new gap loaded
  show hilight row button
  map: click on season numbers for whole row

tabled ...
  show waitstr as {12-12  2-12}
  up/down arrows
  hover hints over cond icons
  add hilite on load when non saved
  move hilite when show hidden by select
*/

import {createApp} from 'vue'
import App         from './components/App.vue'

const app = createApp(App);
app.mount('#app')
