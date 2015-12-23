
Vue    = require 'vue'
log    = require('debug') 'tv:-watch'

{render, tag, div, img, video} = require 'teacup'

require './web-video'
require './tv-btns'
require './scrub'

(document.head.appendChild document.createElement('style')).textContent = """
  .screen-msg {
    margin-top: 10rem;
    font-size:1.3rem;
    text-align: center;
  }
  .screen-msg .msgTitle {
    font-weight:bold;
    font-size:2rem;
    margin-bottom: 2rem;
  }
  .have-episode {
    display: flex;
    flex-direction: row;
  }
  .watch-video-ctrl {
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
    div '.watch-comp', ->
      div '.have-episode', ->
        div '.watch-video-ctrl', ->
          tag 'watch-video-comp',
            show:          '{{show}}'
            episode:       '{{episode}}'
            getPlayPos:    '{{@ getPlayPos}}'
            # chkVidInit:    '{{@ chkVidInit}}'
              
          tag 'tv-btns-comp',
            episode:   '{{episode}}'
            
        tag 'scrub-comp',
          episode: '{{episode}}'
  
  events:
    startWatch: (@episode) ->
      @playPos = 0
      log 'startWatch', @episode.filePaths?[0]?[2]
      log 'bitrates', @episode.filePaths
      if (path = @episode.filePaths?[0]?[2])
        tvGlobal.ajaxCmd 'startVlc', @episode.showId, @episode.id, path
        @watchMode = 'playing'
      setTimeout =>
        tvGlobal.ajaxCmd 'irCmd', 'hdmi3'
      , 3000
      # @videoCmd 'play'
      
    tvBtnClick: (text) ->
      # @chkVidInit()
      # if text not in ['<<','>>'] and @tvCtrl.stopSkip() then return
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
          tvGlobal.ajaxCmd 'seek', 0
        when 'Back' 
          log 'back'
        # when '<<' then @tvCtrl.startSkip 'Back'
        # when '>>' then @tvCtrl.startSkip 'Fwd'

  methods:          
    # videoCmd: (cmd, pos) -> 
    #   @$broadcast 'videoCmd', cmd, pos
    
    newPos: (tvPlayPos) ->
      # @videoCmd   'playPos',     tvPlayPos
      # @$broadcast 'setScrubPos', tvPlayPos
      # @playPos =                 tvPlayPos
      
