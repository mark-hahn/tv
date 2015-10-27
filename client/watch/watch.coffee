
Vue    = require 'vue'
log    = require('debug') 'tv:wchcmp'
TvCtrl = require './tv-ctrl'

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
    videoFile:  ''
    playPos:    0
    loading:    yes
    watchMode: 'none'
    getPlayPos: -> 0
    chkVidInit: ->

  template: render ->
    div '.watch-comp', ->
      div '.screen-msg', vIf:'loading', ->
        div '.msgTitle', 'Loading ...'

      div '.screen-msg', vIf:'!loading && watchMode == "none"', ->
        div '.msgTitle', 'No show is playing.'
        div 'Ensure Roku is running Plex and'
        div 'press show or episode Play button.'

      div '.have-episode', vIf:'!loading && watchMode != "none"', ->
        div '.watch-video-ctrl', ->
          tag 'watch-video-comp',
            show:          '{{show}}'
            episode:       '{{episode}}'
            videoFile:     '{{videoFile}}'
            watchMode:     '{{watchMode}}'
            getPlayPos:    '{{@ getPlayPos}}'
            chkVidInit:    '{{@ chkVidInit}}'
              
          tag 'tv-btns-comp',
            episode:   '{{episode}}'
            watchMode: '{{watchMode}}'
            
        tag 'scrub-comp',
          episode: '{{episode}}'
  
  events:
    startWatch: (@episode) ->
      @playPos = 0
      @loading = 
        setTimeout =>
          if @loading then clearTimeout @loading
          @loading = no
        , 10*1e3
      @tvCtrl.startTv @episode.key, 'goToStart', 'tvIsStarting'
      setTimeout =>
        tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
      , 1000
      @videoCmd 'play'
      
    tvTurningOff: -> @$emit 'endWatch',
        
    endWatch: ->
      # tvGlobal.ajaxCmd 'irCmd', 'hdmi2'
      @watchMode = 'none'
      @$dispatch 'chgCurPage', 'show'
      setTimeout (=> @tvCtrl.stopTv()), 500
      
    tvBtnClick: (text) ->
      @chkVidInit()
      switch text
        when 'togglePlay'
          if @watchMode is 'playing' then @$emit 'tvBtnClick', 'Pause'
          else                            @$emit 'tvBtnClick', 'Play'
        when 'Play' 
          @playPos = @getPlayPos()
          @watchMode = 'playing'
        when 'Pause' 
          if @watchMode is 'playing'
            @oldPlayPos = @playPos
            @watchMode = 'paused'
        when 'Back' 
          if @watchMode is 'paused'
            @playPos = @getPlayPos()
            @watchMode = 'playing'
            setTimeout (=> @tvCtrl.stepBackTv()), 500
          else
            @tvCtrl.stepBackTv()
        when 'Stop' 
          tvGlobal.ajaxCmd 'irCmd', 'hdmi2'
          @$emit 'endWatch'

        when 'Mute'  then tvGlobal.ajaxCmd 'irCmd', 'mute'
        when 'Vol +' then tvGlobal.ajaxCmd 'irCmd', 'volUp'
        when 'Vol -' then tvGlobal.ajaxCmd 'irCmd', 'volDn'

  watch:
    watchMode: (__, old) -> 
      log 'watchMode', {@watchMode, @playPos, @playingWhenLoaded}
      if typeof @playPos isnt 'number' then return
      switch @watchMode
        when 'playing'
          if old isnt 'playing'
            if not @playingWhenLoaded
              @tvCtrl.startTv @episode.key, 'resume'
            @playingWhenLoaded = no
            @playPos = @getPlayPos()
            @videoCmd 'playPos', @playPos
            @videoCmd 'play'
        when 'paused'
          @videoCmd 'pause'
          @tvCtrl.pauseTv()
             
  methods:          
    videoCmd: (cmd, pos) -> 
      @$broadcast 'videoCmd', cmd, pos
    
    newShow:    (@show    ) ->
    newEpisode: (@episode ) ->
    
    newState: (tvState) ->
      if @watchMode is 'playing'
        if @loading
          clearTimeout @loading
          @loading = null
          @videoCmd 'playPos', 2
        switch tvState
          when 'none'    then @$emit 'endWatch'
          when 'playing' then @videoCmd 'play'
          else                @videoCmd 'pause'
        
    newPos: (tvPlayPos) ->
      if @watchMode is 'playing'
        @videoCmd   'playPos',     tvPlayPos
        @$broadcast 'setScrubPos', tvPlayPos
        @playPos =                 tvPlayPos
      
    setEpisodeById: (id, videoFile, @playingWhenLoaded) ->
      for show in @allShows ? []
        for episode in show.episodes
          if episode.id is id
            @show      = show
            @episode   = episode
            @videoFile = videoFile
            @watchMode = 'playing'
            if @playingWhenLoaded
              @$dispatch 'chgCurPage', 'watch'
            return
      @show      = null
      @episode   = null
      @videoFile = ''
      @watchMode = 'none'

  created: -> @tvCtrl = new TvCtrl @

