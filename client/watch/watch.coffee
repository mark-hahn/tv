
Vue    = require 'vue'
log    = require('debug') 'tv:-watch'
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
    # loading:    yes
    watchMode: 'none'
    getPlayPos: -> 0
    chkVidInit: ->

  template: render ->
    div '.watch-comp', ->
      # div '.screen-msg', vIf:'loading', ->
      #   div '.msgTitle', 'Loading ...'
      # 
      # div '.screen-msg', vIf:'!loading && watchMode == "none"', ->
      #   div '.msgTitle', 'No show is playing.'
      #   div 'Ensure tv player is running and'
      #   div 'press show or episode Play button.'
      # 
      # div '.have-episode', vIf:'watchMode != "none"', ->
      div '.have-episode', ->
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
      # @loading = 
      #   setTimeout =>
      #     if @loading then clearTimeout @loading
      #     @loading = no
      #   , 10*1e3
      filePathIdx = 0
      log 'startWatch', @episode.filePaths?[0]?[2]
      log 'bitrates', @episode.filePaths
      if (path = @episode.filePaths?[0]?[2])
        @tvCtrl.startVlc path, 'goToStart', yes
        @watchMode = 'playing'
      setTimeout =>
        tvGlobal.ajaxCmd 'irCmd', 'hdmi3'
      , 3000
      @videoCmd 'play'
      
    tvTurningOff: -> @$emit 'endWatch',
        
    endWatch: ->
      # tvGlobal.ajaxCmd 'irCmd', 'hdmi2'
      @watchMode = 'none'
      @$dispatch 'chgCurPage', 'show'
      setTimeout (=> @tvCtrl.stopVlc()), 500
      
    tvBtnClick: (text) ->
      @chkVidInit()
      # if text not in ['<<','>>'] and @tvCtrl.stopSkip() then return
      switch text
        when 'togglePlay'
          if @watchMode is 'playing' then @$emit 'tvBtnClick', 'Pause'
          else                            @$emit 'tvBtnClick', 'Play'
        when 'Mute'  then tvGlobal.ajaxCmd 'toggleMuteVlc'
        when 'Vol +' then tvGlobal.ajaxCmd 'volupVlc'
        when 'Vol -' then tvGlobal.ajaxCmd 'voldownVlc'
        when 'Stop' 
          tvGlobal.ajaxCmd 'irCmd', 'hdmi2'
          @$emit 'endWatch'
        when 'Reset' 
          tvGlobal.ajaxCmd 'seek', 0
        when 'Back' 
          if @watchMode is 'paused'
            @playPos = @getPlayPos()
            @watchMode = 'playing'
            setTimeout (=> @tvCtrl.stepbackVlc()), 500
          else
            @tvCtrl.stepbackVlc()
        when '<<' then @tvCtrl.startSkip 'Back'
        when '>>' then @tvCtrl.startSkip 'Fwd'
        when 'Play' 
          @playPos = @getPlayPos()
          @watchMode = 'playing'
        when 'Pause' 
          if @watchMode is 'playing'
            @oldPlayPos = @playPos
            @watchMode = 'paused'

  watch:
    watchMode: (__, old) -> 
      # log 'watchMode', {@watchMode, @playPos, @playingWhenLoaded}
      if typeof @playPos isnt 'number' then return
      switch @watchMode
        when 'playing'
          if old isnt 'playing'
            if not @playingWhenLoaded
              @tvCtrl.startVlc null, 'resume'
            @playingWhenLoaded = no
            @playPos = @getPlayPos()
            @videoCmd 'playPos', @playPos
            @videoCmd 'play'
        when 'paused'
          @videoCmd 'pause'
          @tvCtrl.pauseVlc()
             
  methods:          
    videoCmd: (cmd, pos) -> 
      @$broadcast 'videoCmd', cmd, pos
    
    newShow:    (@show    ) ->
    newEpisode: (@episode ) ->
    
    newState: (tvState) ->
      if @watchMode is 'playing'
        # if @loading
        #   clearTimeout @loading
        #   @loading = null
        #   @videoCmd 'playPos', 2
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

  created: -> @tvCtrl = tvGlobal.tvCtrl = new TvCtrl @
  
