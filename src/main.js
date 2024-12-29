/*
reminder, restore ...
  gap checks
  cache

todo ...
  prev/next hilite
  get drama field from tvdb (as many fields as possible)
  put imdb/rotten at top of list

bugs ...
  prune broken (Death in Paradise)
  uneven season lengths break file missing 
          (Interview with the Vampire)
  
new features ...
  show last episode date in map (each season?)
  refresh filtered rows when new gap loaded
  show hilight row button
  map: click on season numbers for whole row

tabled ...
  show waitstr as {12-12  2-12}
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
