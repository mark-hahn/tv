/*
reminder, restore ...
  start gap running

bugs ...
  lincoln Lawyer missing in linda
  deleted rejected shows stay in noemby.json
  adding web show that's in noemby stays in noemby

todo  ...
  update imdb ratings

tabled ...
  changing map doesn't change gaps
  remove show from tvdb.json (how?)
  button: scroll hilighted row to vis 
  refresh filtered rows when new gap loaded
  map: click on season numbers for whole row
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
