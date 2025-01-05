/*
reminder, restore ...
  gap checks
  cache

bugs ...
  uneven season lengths break file missing 
          (Interview with the Vampire)
  pickup delete not permanent
  
add ...
  add-new broken: no hit on tvdb (Daddy Issues)
  alread exists broken ("middle")
  find matching name in tvdb search
  add identify to show search
  chg no show in tvdb err to pop-up notification

todo ...
  move common code to srvr?
  show actors
  show watched/total avail
  update imdb rating periodicaly
  if emby show has no files and has pickup, set to noemby
  files with no emby should be added as pickup if in tvdb
  prev/next hilite
  get drama field from tvdb (as many fields as possible)
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
  move hilite when show hidden by select
*/

import {createApp} from 'vue'
import App         from './components/App.vue'

const app = createApp(App);
app.mount('#app')
