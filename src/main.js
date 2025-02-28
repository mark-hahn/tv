/*
reminder, restore ...
  start gap running
  
bugs ...
  blocked shows appear on boot
  noemby.json has reject field which disagrees with config2-rejects.json
  mlap2 play doesn't start
  
todo  ...
  map: click on season numbers for whole row
  sort by waiting date

tabled ...
  show episode being watched (next up line)
  make popups modal with closing by clicking anywhere
  keep deleted date forever
  keep all map info for deleted shows
  changing shows doesn't update map
  remote buttons hop when map opened
  not in emby doesn't show waiting
  changing map doesn't change gaps
  button: scroll hilighted row to vis 
  refresh filtered rows when new gap loaded
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
