/*
reminder ...
  restore gap checks
  restore cache

todo ...
  show gaps in map
  keep highlight when changing sort
  consider any missing episode after last watched a gap
  sort remote names

bugs ...
  clicking the middle of a row doen't close remotes

new features ...
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
