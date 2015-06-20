
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
  .letter {
    width: 4rem;
    height: 3rem;
    margin-left: 1rem;
    line-height:1.6;
  }
"""

Vue.component 'show-list', 
  props: ['page-mode', 'all-shows', 'cur-show-idx', 'filter-tags', 'show-in-list']
  
  template: render ->
    div '.show-list', vKeepScroll: true, ->
      div '.show-list-inner', vShow: '!alphaMode', ->
        div '.show', 
          vRepeat: 'allShows'
          vClass:  'selected: $index == curShowIdx && pageMode != "filter"'
          vOn:     'click: onClick'
          vText:   'title'
          vShow:   'showInList($data)'
      div '.alpha', vShow: 'alphaMode', ->
        div '.letter.btn', vRepeat:'letters()', vOn:'click:onClick', '{{$value}}'
          
  data: ->
    alphaMode: no
            
  methods:
    showLetter: (show) ->
      title = show.title
      title[if /^the\s/i.test title then 4 else 0].toUpperCase()
      
    letters: -> 
      ltrs = []
      for show in @allShows when @showInList show
        ltr = @showLetter show
        if ltr not in ltrs then ltrs.push ltr
      halfIdx = Math.ceil ltrs.length / 2
      ltrCols = []
      for i in [0...halfIdx]
        ltrCols.push ltrs[i]
        if (rgtLtr = ltrs[i+halfIdx])
          ltrCols.push rgtLtr
      ltrCols
      
    onClick: (e) ->
      if not @alphaMode
        @$dispatch 'clrPageMode'
        @$dispatch 'chgShowIdx', e.targetVM.$index 
        
      if @alphaMode
        @alphaMode = no
        letter = e.target.textContent
        for show, idx in @allShows when @showInList show
          if @showLetter(show) is letter
            @$dispatch 'chgShowIdx', idx
            document.querySelector('.show.selected')?.scrollIntoView()
      
  attached: ->
    @$on 'alpha', -> @alphaMode = not @alphaMode
      
    @$dispatch 'clrPageMode'
    # if @attached then return
    # @attached = yes
    tvGlobal.ensureVisible '.show-list', '.show.selected'
      
    
    