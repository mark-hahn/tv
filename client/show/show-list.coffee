
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
  props: ['page-mode', 'all-shows', 'cur-show-idx']
  
  template: render ->
    div '.show-list', vKeepScroll: true, ->
      div '.show-list-inner', ->
        div '.show', 
          vRepeat: 'allShows'
          vClass:  'selected: $index == curShowIdx && pageMode != "filter"'
          vOn:     'click: onClick'
          vText:   'title'
    
  methods:      
    onClick: (e) ->
      @$dispatch 'clrPageMode'
      @curShowIdx = e.targetVM.$index   
      localStorage.setItem 'vueCurShowIdx', @curShowIdx
      
  attached: ->
    @$dispatch 'clrPageMode'
    @curShowIdx = +(localStorage.getItem('vueCurShowIdx') ? 0)
    if @attached then return
    @attached = yes
    setTimeout ->
      if (selShow = document.querySelector '.show.selected') and
         (list    = document.querySelector '.show-list')
        tvGlobal.ensureVisible list, selShow
    , 2000
      
    
    