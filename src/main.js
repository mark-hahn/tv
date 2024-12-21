/*
reminder ...
  restore gap checks
  restore cache

todo ...

bugs ...
  delete show doesn't work if dash (uncle buck)
  
new features ...
  don't getRemotes until needed
  show waitstr as {12-12  2-12}
  calculate waiting on newly added row
  refresh filtered rows when new gap loaded
  show hilight row button
  map: click on season numbers for whole row

tabled ...
  one worker call per show from loop or when needed
  add wikipedia remote the hard way
  up/down arrows
  prev/next hilite
  hover hints over cond icons
  cache gap data
  bug: no hilite on load when no saved hilite
  bug: when show hidden by select, no hilite
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
