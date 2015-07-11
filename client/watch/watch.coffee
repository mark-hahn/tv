
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
    playPos:    0
    watchMode: 'none'

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
              
          tag 'tv-btns-comp',
            episode:   '{{episode}}'
            watchMode: '{{watchMode}}'
            
        tag 'scrub-comp',
          episode: '{{episode}}'
  
  events:
    startWatchDown: (@episode) ->
      # log 'startWatchDown: starting watch of', episode.title
      tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
      @tvCtrl.startTv @episode, 0
      
    scrubMoused: (playPos) ->
      if @watchMode is 'tracking'
        @oldPlayPos = @tvCtrl.getPlayPos()
        @watchMode = 'paused'        
      @$broadcast 'setPlayPos', playPos
      
    tvBtnClick: (text) ->
      switch text
        when 'Play' 
          if Math.abs(@playPos - @oldPlayPos) < 2 and @watchMode is 'paused'
            @tvCtrl.unPauseTv() 
          @watchMode = 'tracking'
        when 'Cancel' 
          if Math.abs(@playPos - @oldPlayPos) < 2 and @watchMode is 'paused'
            @tvCtrl.unPauseTv()
          else
            @playPos = @oldPlayPos ? 0
            @$broadcast 'setPlayPos', @playPos
          @watchMode = 'tracking'
        when 'Pause' 
          if @watchMode is 'tracking'
            @oldPlayPos = @playPos
            @watchMode = 'paused'
        when 'Back' 
          log 'back btn', @watchMode
          if @watchMode is 'tracking'
            @tvCtrl.stepBackTv()

  watch:
    watchMode: (__, old) -> 
      log 'watchMode', old, '->', @watchMode
      if typeof @playPos isnt 'number' then return
      switch @watchMode
        when 'none'
          @tvPlaying = no
        when 'tracking'
          if old isnt 'tracking'
            if @episode.key and not @tvPlaying
              log 'starting tv play',  @tvPlaying, @playPos, @episode.key
              @tvCtrl.startTv @episode, @playPos
              @tvPlaying = yes
            @videoEle?.currentTime = @playPos
            @videoEle?.play()
        when 'playing'
          @videoEle?.play()
          if old is 'tracking' 
            @videoEle?.pause()
            if @tvPlaying 
              log 'pausing tv - was playing now paused',  @playPos
              @tvCtrl.pauseTv()
              @tvPlaying = no
        when 'paused'
          @videoEle?.pause()
          if old is 'tracking' and @tvPlaying
            log 'pausing tv - was tracking now paused',  @playPos
            @tvCtrl.pauseTv()
            @tvPlaying = no
            
  methods:          
    newShow:    (@show    ) ->
    newEpisode: (@episode ) ->
      
    newState:   (tvState  ) ->
      if tvState is 'playing' 
        @tvPlaying = yes
        
    newPos: (tvPlayPos) ->
      if @watchMode is 'tracking'
        @videoEle?.currentTime = tvPlayPos
        @playPos = tvPlayPos
      
    setEpisodeById: (id, @videoFile) ->
      for show in @allShows ? []
        for episode in show.episodes
          if episode.id is id
            @show    = show
            @episode = episode
            @watchMode = 'tracking'
            log 'setEpisodeById, have episode', id, @episode.title
            return
      @show      = null
      @episode   = null
      @watchMode = 'none'
      log 'setEpisodeById, have no episode', @allShows.length, id

  created: -> @tvCtrl = new TvCtrl @

