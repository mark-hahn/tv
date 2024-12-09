/*
bugs ...
  waiting icon color
  ban
  row didn't dissapear upon series deletion
  show with 1.5 seasons down marked as not ready (silo)  
       store info in waiting.json?
  chg sort leaves highlight above top

new features ...
  widen display
  popup on ctrl click with all providers

map ...
  esc key closes map
  move error in map to top right
  map: clicks on season numbers for whole row

tabled ...
  check seasons for no unaired before setting waiting
    move unaired check to getgap
  move scroll bar to middle
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
