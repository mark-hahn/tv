/*
reminder ...
  restore gap checks
  restore cache

todo ...
  consider any missing episode after last watched a gap
  waiting on new added?
  move close button to left in map
  refresh filtered rows when dash and new gap loaded

bugs ...
  clicking the middle of a row doen't close remotes
  shows waiting when unaired in later row (The Neighborhood)
  no dash on waiting (shrinking, yellowjackets)

new features ...
  up/down arrows
  sort remote names
  keep highlight when changing sort
  goto hilight row button
  add wikipedia remote the hard way
  map: clicks on season numbers for whole row
  prev/next
  hover hints over cond icons
  cache gap data

tabled ...
  no hilite on load when no saved hilite
  when show hidden by select, no hilite
  check seasons for no unaired before setting waiting
    move unaired check to getgap
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
