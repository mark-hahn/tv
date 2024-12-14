/*
bugs ...
  no hilite on load when no saved hilite
  when show hidden by select, no hilite
  show with 1.5 seasons down marked as not ready (silo)  
       store info in waiting.json?
  
new features ...
  cache gap data
  popup on ctrl click with all providers
  map: clicks on season numbers for whole row

tabled ...
  check seasons for no unaired before setting waiting
    move unaired check to getgap
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
