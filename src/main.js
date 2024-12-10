/*
bugs ...
  waiting icon color
  ban
  show with 1.5 seasons down marked as not ready (silo)  
       store info in waiting.json?
  first click to show emby page doesn't work
  some waitstr have angle brackets
  
new features ...
  popup on ctrl click with all providers

map ...
  map: clicks on season numbers for whole row

tabled ...
  check seasons for no unaired before setting waiting
    move unaired check to getgap
  no hilite on load when no saved hilite
  when show hidden by select, no hilite
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
