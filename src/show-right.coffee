
Vue     = require 'vue'
log     = require('debug') 'slf'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-info-comp {
    width: 100%;
    height: 34rem;
  }
  .lft-sel-btn-row {
    padding-top: 0.7rem;
    width: 100%;
  }
  .lft-sel-btn-row .btn {
    width: 50%;
  }
"""

Vue.component 'left-select-btns',
  template: render ->
    div '.lft-sel-btn-row',  ->
      div '.btn', vOn: 'click: play', 'Play'
      div '.btn', vOn: 'click: tags', 'Tags'
  methods:
    play: (e) -> log 'play'
    tags: (e) -> log 'tags'
      
Vue.component 'left-tags-btns',
  template: render ->
    div '.lft-sel-btn-row',  ->
      div '.btn', vOn: 'click: prev', 'Prev'
      div '.btn', vOn: 'click: next', 'Next'
  methods:
    prev: (e) -> log 'prev'
    next: (e) -> log 'next'

Vue.component 'show-left', 
  template: render ->
    div '.show-info-comp', vComponent: 'show-info', vWith: 'showMode: showMode'
    div '.left-select-btns-comp', vShow: 'showMode == "select"', vComponent: 'left-select-btns'
    div '.left-tags-btns-comp',   vShow: 'showMode == "tags"',   vComponent: 'left-tags-btns'
    
