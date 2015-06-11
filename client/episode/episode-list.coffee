
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
    white-space:nowrap;
    border-top: 1px solid gray;
    padding: .1em;
    cursor: pointer;
    font-size: 1rem;
  }
  .episode-number, .episode-title {
    display: inline-block;
    border-radius: .25rem;
  }
  :not(watched) .episode-number {
    background-color: #cdc;
  }
  .watched .episode-number {
    background-color: #dcc;
  }
  .episode-number {
    padding-right: .2rem;
  }
  .episode-title {
    padding-left: .2rem;
  }
  .episode.selected .episode-title{
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
            vClass:  'selected: $index == curEpisodeIdx, watched: viewCount'
            vOn:     'click: onClick'
        , ->
          div '.episode-number', '{{episodeNumber}}'
          div '.episode-title',  '{{title}}'
          
  methods:
    onClick: (e) ->
      vm = e.targetVM
      log 'onclick', vm.$index, vm.title 
      @$dispatch 'chgEpisodeIdx', vm.$index 
      # @curShow.curEpisodeIdx = vm.$index   
    
    