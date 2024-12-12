/*
bugs ...
  waiting icon color
  show with 1.5 seasons down marked as not ready (silo)  
       store info in waiting.json?
  some waitstr have angle brackets
  waiting row deleted when only pickup deleted

new features ...
  cache gap data
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
