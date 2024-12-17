/*
bugs ...
  if show with all seasons before last watched
      and last show in last season is unaired
        last row should show waiting
  show with 1.5 seasons down marked as not ready (silo) 

  bad show gaps
    strike
    The Bastard Son & The Devil Himself
    The Lazarus Project

  
new features ...
  cache gap data
  map: clicks on season numbers for whole row

tabled ...
  no hilite on load when no saved hilite
  when show hidden by select, no hilite
  check seasons for no unaired before setting waiting
    move unaired check to getgap
*/

import {createApp} from 'vue'
import App from './App.vue'

createApp(App).mount('#app');
