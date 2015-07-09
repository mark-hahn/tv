
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

startVideo = (vm) -> @$broadcast 'startWatch', vm.curEpisode

Vue.component 'episode-comp', 
  props: ['curShow', 'curEpisodeIdx', 'curEpisode', 'twoBtnClk']
  
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
      
  created: ->
    @$on 'startVideo', -> startVideo @
    
    @$on 'twoBtnClk',  (btnName) -> 
      log 'Clicked bottom button: ' + btnName
      switch btnName
        when 'Play'  
          @$dispatch 'startWatch'
        when 'Watched'
          @curEpisode.watched = Watched = not @curEpisode.watched
          tvGlobal.ajaxCmd 'setDBField', @curEpisode.id, 'watched', Watched, (err, res) => 
            if err then log 'set watched ajax call err', err.message
        when 'Down'  then @$dispatch 'chgEpisodeIdx', @curEpisodeIdx + 1
        when 'Up'    then @$dispatch 'chgEpisodeIdx', @curEpisodeIdx - 1
        


    
