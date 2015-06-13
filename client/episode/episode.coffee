
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
  props: ['cur-show', 'cur-episode-idx', 'cur-episode', 'two-btn-clk']
  
  template: render ->
    div '.episode-comp', ->
      
      tag 'episode-left', '.episode-left-comp',  
        showTitle:  '{{curShow.title}}'
        curEpisode: '{{curEpisode}}'
        twoBtnClk:  '{{twoBtnClk}}'

      tag 'episode-right', '.episode-right-comp', 
        curShow:       '{{curShow}}'
        curEpisodeIdx: '{{curEpisodeIdx}}'
        twoBtnClk:     '{{twoBtnClk}}'
      
  data: ->
    startVideo: (vm) ->
      tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
      tvGlobal.ajaxCmd 'startVideo', vm.curEpisode.key, 0
      
    twoBtnClk: (e) -> 
      log 'Clicked bottom button: ' + e.target.innerText
      switch e.target.innerText
        when 'Play' then @startVideo e.targetVM.$parent
          
  created: ->
    @$on 'startVideo', -> @startVideo @
