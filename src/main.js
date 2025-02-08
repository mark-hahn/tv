/*
reminder, restore ...
  start gap running
  
bugs ...
  hist load broken only in released

todo  ...
  make popups modal with closing by clicking anywhere
  if totry and at least one show to watch, ignore gap
  keep deleted date forever
  show episode being watched (next up line)
  show counts when reloading a deleted show
  keep all map info for deleted shows

tabled ...
  changing shows doesn't update map
  remote buttons hop when map opened
  not in emby doesn't show waiting
  getRemotes called twice
  changing map doesn't change gaps
  button: scroll hilighted row to vis 
  refresh filtered rows when new gap loaded
  map: click on season numbers for whole row
  thumbnails have wrong language (Wedding Season)
  up/dn arrows
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
