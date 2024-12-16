/*
bugs ...
  no hilite on load when no saved hilite
  when show hidden by select, no hilite
  show with 1.5 seasons down marked as not ready (silo)  
       store info in waiting.json?
  click on show name
  
new features ...
  cache gap data
  map: clicks on season numbers for whole row

tabled ...
  check seasons for no unaired before setting waiting
    move unaired check to getgap
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
