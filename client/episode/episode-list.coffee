
Vue     = require 'vue'
log     = require('../debug') 'snf'

{render, tag, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-list {
    width: 100%;
    height: 35.5rem;
    position: relative;
    overflow-x: hidden;
    overflow-y: auto;
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
  .watched .episode-number {
    background-color: #dcc;
  }
  .noFile .episode-title {
    color: gray;
  }
  .noFile .episode-number {
    color: gray;
  }
  .watched .episode-title {
    text-decoration:line-through;
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
  props: ['curShow', 'allEpisodes', 'curEpisodeIdx']
  
  template: render ->
    div '.episode-list', vKeepScroll: true, ->
      div '.episode-list-inner', ->
        div '.episode', 
            vRepeat: 'allEpisodes'
            vClass:  'selected: $index == curEpisodeIdx, watched: watched, noFile: noFile'
            vOn:     'click: onClick'
        , ->
          div '.episode-number', '{{episodeNumber}}'
          div '.episode-title',  '{{title}}'
          
  methods:
    onClick: (e) -> @$dispatch 'chgEpisodeIdx', e.targetVM.$index 
      
  attached: ->
    tvGlobal.ensureVisible '.episode-list', '.episode.selected'
    