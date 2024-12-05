/*
bugs ...
  gap dashes don't show until this.shows reloads
  waiting icon color broken
  move unaired check to getgap
    process waiting shows first in getgap

new features ...
  check seasons for no unaired before setting waiting
  add activity sort (from srvr)
  popup on ctrl click with all providers
  add % display for gap progress
  esc key closes map
  move scroll bar to middle
  move error in map to top right
  change sort to 2 buttons
  map: clicks on season numbers for whole row
  remember old highlighted rows after select
  font sizes and families

tabled ...
  wating
  wating icon broken

*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
