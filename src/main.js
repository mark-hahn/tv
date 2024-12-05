/*
bugs ...
  gap dashes don't show until end of loadallshows
  waiting icon color broken
  layout, font sizes, and families

new features ...
  add % display for gap progress
  add activity sort (from srvr)
  popup on ctrl click with all providers
  esc key closes map
  move error in map to top right
  change sort to 3 buttons
  map: clicks on season numbers for whole row

tabled ...
  check seasons for no unaired before setting waiting
    move unaired check to getgap
  move scroll bar to middle
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
