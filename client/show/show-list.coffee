
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:snf'

{render, tag, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-list {
    width: 100%;
    height: 35.5rem;
    position: relative;
    overflow: auto;
  }
  .show-list-inner {
    width: 100%;
  }
  .show {
    border-top: 1px solid gray;
    padding: 0.1em;
    cursor: pointer;
    font-size: 1rem;
  }
  .show.selected {
      background-color: yellow;
  }
"""

Vue.component 'show-list', 
  props: ['all-shows', 'cur-show-idx']
  
  template: render ->
    div '.show-list', vOn:'scroll: onScroll', ->
      div '.show-list-inner', ->
        div '.show', 
          vRepeat: 'allShows'
          vClass:  'selected: $index == curShowIdx'
          vOn:     'click: onClick'
          vText:   'title'

  attached: ->
    for ele in @$el.querySelectorAll '[data-vuescrlpos]'
      [ele.scrollLeft, ele.scrollTop] = ele.getAttribute('data-vuescrlpos').split '-'
    
  methods:
    onScroll: (e) ->
      ele = e.target
      ele.setAttribute 'data-vuescrlpos', "#{ele.scrollLeft}-#{ele.scrollTop}"
      
    onClick: (e) ->
      vm = e.targetVM
      log 'onclick', vm.$index, vm.title 
      @curShowIdx = vm.$index   
    
    