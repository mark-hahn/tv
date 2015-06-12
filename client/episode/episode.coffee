
Vue     = require 'vue'
log     = require('debug') 'tv:epipag'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-left-comp, .episode-right-comp {
    display: inline-block;
    width: 49%;
  }
  .episode-left-comp {
    margin-right:2%;
  }
"""

require './episode-left'
require './episode-right'

Vue.component 'episode-comp', 
  props: ['cur-show', 'cur-episode-idx', 'cur-episode']
  
  template: render ->
    div '.episode-comp', ->
      
      tag 'episode-left', '.episode-left-comp',  
        curEpisode:    '{{curEpisode}}'
        twoBtnClk:     '{{twoBtnClk}}'

      tag 'episode-right', '.episode-right-comp', 
        curShow:       '{{curShow}}'
        curEpisodeIdx: '{{curEpisodeIdx}}'
        twoBtnClk:     '{{twoBtnClk}}'
      
  data: ->
    twoBtnClk: (e) -> 
      log 'Clicked bottom button: ' + e.target.innerText
      switch e.target.innerText
        when 'Play'
          tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
          log e
          log e.targetVM
          log e.targetVM.$parent
          log e.targetVM.$parent.curEpisode
          tvGlobal.ajaxCmd 'startVideo', e.targetVM.$parent.curEpisode.key, 0

