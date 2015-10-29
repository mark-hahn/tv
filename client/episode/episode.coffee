
Vue     = require 'vue'
log     = require('debug') 'tv:epipag'

{render, tag, div} = require 'teacup'

require './episode-left'
require './episode-right'

Vue.component 'episode-comp', 
  props: ['curShow', 'curEpisodeIdx', 'curEpisode']
  
  template: render ->
    div '.episode-comp', ->
      
      tag 'episode-left',
        showTitle:  '{{curShow.title}}'
        curEpisode: '{{curEpisode}}'

      tag 'episode-right',
        curShow:       '{{curShow}}'
        curEpisodeIdx: '{{curEpisodeIdx}}'
  
  events:
    twoBtnClk:  (btnName) -> 
      switch btnName
        when 'Play'  
          @$dispatch 'videoEnable'
          @$dispatch 'startWatch'
        when 'Watched'
          @curEpisode.watched = watched = not @curEpisode.watched
          tvGlobal.ajaxCmd 'setDBField', @curEpisode.id, 'watched', watched, (err, res) => 
            if err then log 'set watched ajax call err', err.message
          @$dispatch 'chgEpisodeIdx', @curEpisodeIdx + 1
          
        when 'Down'  then @$dispatch 'chgEpisodeIdx', @curEpisodeIdx + 1
        when 'Up'    then @$dispatch 'chgEpisodeIdx', @curEpisodeIdx - 1
        


    
