/*
reminder, restore ...
  gap checks
  cache

bugs ...
  map too tall
  noemby has plus sign (How to Get Away with Murder)
  emby page doesn't change (emby problem)
  when hilited show is deleted, shows old season meta

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
  refresh filtered rows when new gap loaded
  button: set hilighted row to vis 
  map: click on season numbers for whole row
  move hilite when show hidden by select
  update imdb rating et. al. periodicaly

tabled ...
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
