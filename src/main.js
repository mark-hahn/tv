/*
reminder ...
  restore gap checks
  restore cache

bugs ...
  chg gap calc to use last seen (userdata?)
  bad show gaps
    strike
    The Bastard Son & The Devil Himself
    The Lazarus Project

new features ...
  hover hints over cond icons
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
