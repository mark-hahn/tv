/*
reminder, restore ...
  start gap running

bugs ...
  no series meta in banned (Castle Builders)
  no series meta in noemby (just Anxious People)
  file missing (in meta) doesn't have dash (St. Denis Medical)
  
todo  ...
  show deleted in history buttons and series meta

new features ..
  refresh filtered rows when new gap loaded
  button: scroll hilighted row to vis 

tabled ...
  map: click on season numbers for whole row
  update imdb rating (all remotes) periodicaly
  thumbnails have wrong language (Wedding Season)
  click anywhere to close popup
  up/dn arrows
  series pane flashes while waiting for map (St. Denis)
  sort by imdb ratings
  show actors
  show last episode date in map (each season?)
  files with no emby should be added as pickup if in tvdb
  emby with no files and has pickup, set to noemby
  add wikipedia remote the hard way
  get drama field from tvdb (as many fields as possible)
  hover hints over cond icons
*/

import {createApp} from 'vue'
import App         from './components/App.vue'

const app = createApp(App);
app.mount('#app')
