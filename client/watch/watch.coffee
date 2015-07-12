
Vue    = require 'vue'
log    = require('debug') 'tv:wchcmp'
TvCtrl = require './tv-ctrl'

{render, tag, div, img, video} = require 'teacup'

require './watch-info'
require './tv-btns'
require './scrub'

(document.head.appendChild document.createElement('style')).textContent = """
  .no-episode {
    margin-top: 10rem;
    font-size:1.6rem;
    text-align: center;
  }
  .no-episode .msgTitle {
    font-weight:bold;
    font-size:2rem;
    margin-bottom: 2rem;
  }
  .have-episode {
    display: flex;
    flex-direction: row;
  }
  .watch-info-ctrl {
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
    videoFile:  ''
    playPos:    0
    watchMode: 'none'
    getPlayPos: -> 0

  template: render ->
    div '.watch-comp', ->
      div '.no-episode', vIf:'watchMode == "none"', ->
        div '.msgTitle', 'No show is playing.'
        div 'Ensure Roku is running Plex and'
        div 'press show or episode Play button.'

      div '.have-episode', vIf:'watchMode != "none"', ->
        div '.watch-info-ctrl', ->
          tag 'watch-info-comp',
            show:          '{{show}}'
            episode:       '{{episode}}'
            videoFile:     '{{videoFile}}'
            watchMode:     '{{watchMode}}'
            getPlayPos:    '{{@ getPlayPos}}'
              
          tag 'tv-btns-comp',
            episode:   '{{episode}}'
            watchMode: '{{watchMode}}'
            
        tag 'scrub-comp',
          episode: '{{episode}}'
  
  events:
    startWatch: (@episode) ->
      log 'startWatch', @episode.title
      tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
      @tvCtrl.startTv @episode.key, 0
      @playPos = 0
        
    endWatch: ->
      tvGlobal.ajaxCmd 'irCmd', 'hdmi2'
      @tvCtrl.stopTv()
      @watchMode = 'none'
      @$dispatch 'chgCurPage', 'show'
      
    scrubMoused: (playPos) ->
      if @watchMode is 'tracking'
        @oldPlayPos = @tvCtrl.getPlayPos()
        @watchMode = 'paused'
      @videoCmd 'playPos', playPos
      
    tvBtnClick: (text) ->
      switch text
        when 'Play' 
          @playPos = @getPlayPos()
          @watchMode = 'tracking'
        when 'Cancel' 
          if Math.abs(@playPos - @oldPlayPos) < 2 and 
               @watchMode is 'paused'
            @tvCtrl.unPauseTv()
          else
            @playPos = @oldPlayPos ? 0
            @videoCmd 'playPos', @playPos
          @watchMode = 'tracking'
        when 'Pause' 
          if @watchMode is 'tracking'
            @oldPlayPos = @playPos
            @watchMode = 'paused'
        when 'Back' 
          # log 'back btn', @watchMode
          if @watchMode is 'tracking'
            @tvCtrl.stepBackTv()
        when 'Stop' 
          @$emit 'endWatch'
          @tvCtrl.stopTv()

        when 'Mute'  then tvGlobal.ajaxCmd 'irCmd', 'mute'
        when 'Vol +' then tvGlobal.ajaxCmd 'irCmd', 'volUp'
        when 'Vol -' then tvGlobal.ajaxCmd 'irCmd', 'volDn'

  watch:
    watchMode: (__, old) -> 
      if typeof @playPos isnt 'number' then return
      switch @watchMode
        when 'none'
          @tvPlaying = no
        when 'tracking'
          if old isnt 'tracking'
            if @episode.key and not @tvPlaying
              @tvCtrl.startTv @episode.key, @playPos
              @tvPlaying = yes
            @videoCmd 'playPos', @playPos
            @videoCmd 'play'
        when 'playing'
          @videoCmd 'play'
          if old is 'tracking' 
            @videoCmd 'pause'
            if @tvPlaying 
              @tvCtrl.pauseTv()
              @tvPlaying = no
        when 'paused'
          @videoCmd 'pause'
          if old is 'tracking' and @tvPlaying
            @tvCtrl.pauseTv()
            @tvPlaying = no
            
  methods:          
    videoCmd: (cmd, pos) -> 
      @$broadcast 'videoCmd', cmd, pos
    
    newShow:    (@show    ) ->
    newEpisode: (@episode ) ->
    
    newState: (tvState) ->
      @tvPlaying = (tvState is 'playing')
      if @watchMode is 'tracking'
        log 'newState', {tvState, @watchMode}
        switch tvState
          when 'none'    then @$emit 'endWatch'
          when 'playing' then @videoCmd 'play'
          else                @videoCmd 'pause'
        
    newPos: (tvPlayPos) ->
      if @watchMode is 'tracking'
        @videoCmd   'playPos',     tvPlayPos
        @$broadcast 'setScrubPos', tvPlayPos
        @playPos =                 tvPlayPos
      
    setEpisodeById: (id, videoFile) ->
      for show in @allShows ? []
        for episode in show.episodes
          if episode.id is id
            @show      = show
            @episode   = episode
            @videoFile = videoFile
            @watchMode = 'tracking'
            return
      @show      = null
      @episode   = null
      @videoFile = ''
      @watchMode = 'none'

  created: -> @tvCtrl = new TvCtrl @

