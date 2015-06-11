
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:snf'

{render, tag, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-list {
    width: 100%;
    height: 35.5rem;
    position: relative;
    overflow: auto;
  }
  .episode-list-inner {
    width: 100%;
  }
  .episode {
    border-top: 1px solid gray;
    padding: 0.1em;
    cursor: pointer;
    font-size: 1rem;
  }
  .episode.selected {
      background-color: yellow;
  }
"""

Vue.component 'episode-list', 
  props: ['cur-show', 'all-episodes', 'cur-episode-idx']
  
  template: render ->
    div '.episode-list', ->
      div '.episode-list-inner', ->
        div '.episode', 
          vRepeat: 'allEpisodes'
          vClass:  'selected: $index == curEpisodeIdx'
          vOn:     'click: onClick'
          vText:   'episodeNumber + " " + title'
  
  methods:
    onClick: (e) ->
      vm = e.targetVM
      log 'onclick', vm.$index, vm.title 
      @$dispatch 'chgEpisodeIdx', vm.$index 
      # @curShow.curEpisodeIdx = vm.$index   
    
    