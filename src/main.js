/*
reminder, restore ...
  gap checks
  cache

bugs ...
  when hilited show is deleted shows old season meta
  dates in datefmt are one day off
  still counts shows all watch as Pluses 
        (black doves, Bob Hearts Abishola)
  fixed gaps don't go away (blunt talk)
  top button in viewed

add ...
  no series info (No Good Deed)
  add-new broken: no hit on tvdb (Daddy Issues)
  alread exists broken ("middle")
  find matching name in tvdb search
  add identify to show search
  chg no show in tvdb err to pop-up notification
  did i break set-date in map with new fmtdate?

todo ...
  get ratings from google
  implement episode pane
  show season meta on noemby
  show watched/total avail

new features ..
  chg filter button to dashes when filters chg
  save all settings to local storage
  hide gap with dash click
  blink copy-name button
  prev/next hilite
  sort by imdb ratings
  show actors
  refresh filtered rows when new gap loaded
  button: set hilighted row to vis 
  map: click on season numbers for whole row
  move hilite when show hidden by select
  update imdb rating et. al. periodicaly

tabled ...
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
