/*
reminder, restore ...
  start gap running

bugs ...
  deleted rejected shows stay in noemby.json (no example)
  a waiting noemby show doesn't set globe (no example)
  changing shows doesn't update map
  remote buttons hop when map opened
  newly undeleted show not visible
  newly undeleted show still green
  deleted noemby show not visible
  deleted show has emby button (heartburn hotel)
  word deleted in search list is green

todo  ...
  keep deleted date in ghost show
  show episode being watched (next up line)
  clnup noemby/deleted handling
  make popups modal with closing by clicking anywhere
  update imdb ratings (refresh button)
  show counts when reloading a deleted show
    (keep all map info for deleted shows)

tabled ...
  getRemotes called twice
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
