/*
reminder ...
  restore gap checks
  restore cache

todo ...
  prev/next hilite
  get drama from tvdb (as many as possible)
  put imdb/rotten at top of list

bugs ...
  
new features ...
  show waitstr as {12-12  2-12}
  refresh filtered rows when new gap loaded
  show hilight row button
  map: click on season numbers for whole row

tabled ...
  one worker call per show from loop or when needed
  add wikipedia remote the hard way
  up/down arrows
  hover hints over cond icons
  bug: no hilite on load when no saved hilite
  bug: when show hidden by select, no hilite
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
