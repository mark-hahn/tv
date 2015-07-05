
Vue    = require 'vue'
log    = require('debug') 'tv:wchcmp'
TvCtrl = require './tv-ctrl'

{render, tag, div, img, video} = require 'teacup'

require './watch-info'
require './tv-btns'
require './scrub'

tvEvents = {}
tvCtrl = new TvCtrl tvEvents

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
    watch-info-comp {
      display: block;
    }
  scrub-comp {
    display: inline-block;
    position:relative;
    width: 15%;
    height: 35.5rem;
  }
"""

Vue.component 'watch-comp', 
  props: ['all-shows']
  
  data: ->
    show:          null
    episode:       null
    playPos:       0
    watchMode:    'none'

  template: render ->
    div ->
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
              
          tag 'watch-ctrl-comp',
            episode:   '{{episode}}'
            watchMode: '{{watchMode}}'
            
        tag 'scrub-comp',
          episode: '{{episode}}'
  
  events:
    startWatch: (episode) ->
      log 'starting watch of', episode.title
      tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
      tvCtrl.startTv episode.key, 0
      
    scrubMoused: (playPos) ->
      if @watchMode is 'tracking'
        @oldPlayPos = tvCtrl.getPlayPos()
        @watchMode = 'paused'        log 'starting video', firstUnwatched.title
                tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
                tvGlobal.ajaxCmd 'startTv', firstUnwatched.key, 0
                @$emit 'chgCurPage', 'watch'

      @$broadcast 'setPlayPos', playPos
    
    tvBtnClick: (text) ->
      switch text
        when 'Play' 
          if Math.abs(@playPos - @oldPlayPos) < 2 and @watchMode is 'paused'
            tvGlobal.ajaxCmd 'pauseTv'
          @watchMode = 'tracking'
        when 'Cancel' 
          if Math.abs(@playPos - @oldPlayPos) < 2 and @watchMode is 'paused'
            tvGlobal.ajaxCmd 'pauseTv'
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
            tvGlobal.ajaxCmd 'stepBackTv'

  watch:
    watchMode: (__, old) -> 
      log 'watchMode', old, '->', @watchMode
      if typeof @playPos isnt 'number' then return
      switch @watchMode
        when 'tracking'
          if old isnt 'tracking'
            if @episode.key and not @tvPlaying
              log 'starting tv play',  @tvPlaying, @playPos, @episode.key
              tvGlobal.ajaxCmd 'startTv', @episode.key, @playPos
              @tvPlaying = yes
              @tvStartedPlay = Date.now()
            @videoEle?.currentTime = @playPos
            @videoEle?.play()
        when 'playing'
          @videoEle?.play()
          if old is 'tracking' 
            @videoEle?.pause()
            if @tvPlaying 
              log 'pausing tv - was playing now paused',  @playPos
              tvGlobal.ajaxCmd 'pauseTv'
              @tvPlaying = no
        when 'paused'
          @videoEle?.pause()
          if old is 'tracking' and @tvPlaying
            log 'pausing tv - was tracking now paused',  @playPos
            tvGlobal.ajaxCmd 'pauseTv'
            @tvPlaying = no
          
  attached: ->
    tvEvents.newShow = (@show) ->
      
    tvEvents.newEpisode = (@episode) ->
      
    tvEvents.newState = (tvState) ->
      
    tvEvents.newPos = (tvPlayPos) ->
      
    tvEvents.ready = yes
