/*
bugs ...
  highlight on app load
  map click
  waiting icon color
  ban
  row didn't dissapear upon series deletion
  show with 1.5 seasons down marked as not ready (silo)  
       store info in waiting.json?
  first click to show emby page doesn't work

new features ...
  popup on ctrl click with all providers

map ...
  map: clicks on season numbers for whole row

tabled ...
  check seasons for no unaired before setting waiting
    move unaired check to getgap
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
