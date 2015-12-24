
Vue    = require 'vue'
log    = require('debug') 'tv:-watch'

{render, tag, div, img} = require 'teacup'

require './tv-btns'
require './scrub'

(document.head.appendChild document.createElement('style')).textContent = """
  .watch-comp {
    display: flex;
    flex-direction: row;
  }
  .info-column {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 85%;
    height: 35.5rem;
  }
"""

Vue.component 'watch-comp', 
  props: ['allShows']
  
  data: ->
    show:       null
    episode:    null
    playPos:    0

  template: render ->
    # div '.watch-comp', ->
      div '.watch-comp', ->
        div '.info-column', ->
              
          tag 'tv-btns-comp',
            episode: '{{episode}}'
            
        tag 'scrub-comp',
          episode: '{{episode}}'
  
  events:
    startWatch: (@episode) ->
      @playPos = 0
      log 'startWatch', @episode.filePaths?[0]?[2]
      log 'bitrates', @episode.filePaths
      if (path = @episode.filePaths?[0]?[2])
        tvGlobal.ajaxCmd 'startVlc', @episode.showId, @episode.id, path
      setTimeout =>
        tvGlobal.ajaxCmd 'irCmd', 'hdmi3'
      , 3000
      
    tvBtnClick: (text) ->
      switch text
        when '> ||'  then tvGlobal.ajaxCmd 'playPauseVlc'
        when 'Mute'  then tvGlobal.ajaxCmd 'toggleMuteVlc'
        when 'Vol +' then tvGlobal.ajaxCmd 'volupVlc'
        when 'Vol -' then tvGlobal.ajaxCmd 'voldownVlc'
        when 'Stop' 
          tvGlobal.ajaxCmd 'irCmd', 'hdmi2'
          @$dispatch 'chgCurPage', 'show'
          setTimeout ->
            tvGlobal.ajaxCmd 'stopVlc'
          , 500
        when 'Reset' 
          tvGlobal.ajaxCmd 'seekVlc', 0
        when 'Back' 
          log 'back'
        # when '<<' then @tvCtrl.startSkip 'Back'
        # when '>>' then @tvCtrl.startSkip 'Fwd'

  attached: ->
    setInterval ->
      tvGlobal.ajaxCmd 'getPlayInfo', (err, res) => 
        if err then log 'getPlayInfo err', err.message; return
        [showId, episodeId, file, playPos, volume] = res
        if showId is 'notShowing' then return
        # log 'getPlayInfo', {showId, episodeId, file, playPos, volume}
    , 5000

