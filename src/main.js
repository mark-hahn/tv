/*
reminder, restore ...
  gap checks
  cache

bugs ...
  all watched still have + (black doves)
  try drama not showing for bad sisters
  did i break set-date in map with new fmtdate?
  when hilited show is deleted shows old season meta
  dates in datefmt are one day off
  still counts shows all watch as Pluses 
        (black doves, Bob Hearts Abishola)

add ...
  no series info (No Good Deed)
  add-new broken: no hit on tvdb (Daddy Issues)
  alread exists broken ("middle")
  find matching name in tvdb search
  add identify to show search
  chg no show in tvdb err to pop-up notification

todo ...
  implement episode pane
  show season meta on noemby
  show watched/total avail

new features ..
  hide gao with dash click
  blink copy-name button
  prev/next hilite
  chg filter button to dashes when filters chg
  sort by imdb ratings
  show actors
  refresh filtered rows when new gap loaded
  button: set hilighted row to vis 
  map: click on season numbers for whole row
  move hilite when show hidden by select
  update imdb rating and  periodicaly

tabled ...
  show last episode date in map (each season?)
  move common code from client to srvr
  files with no emby should be added as pickup if in tvdb
  emby with no files and has pickup, set to noemby
  add wikipedia remote the hard way
  get drama field from tvdb (as many fields as possible)
  show waitstr as {12-12  2-12}
  up/down arrows
  hover hints over cond icons
*/

import {createApp} from 'vue'
import App         from './components/App.vue'

const app = createApp(App);
app.mount('#app')
