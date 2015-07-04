
Vue = require 'vue'
log = require('debug') 'tv:wchcmp'

{render, tag, div, img, video} = require 'teacup'

require './watch-info'
require './tv-ctrls'
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
    tvStartedPlay: 0
    tvPlaying:     yes

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
            playPos:       '{{playPos}}'
            watchMode:     '{{watchMode}}'
            tvStartedPlay: '{{tvStartedPlay}}'
            tvPlaying:     '{{tvPlaying}}'
              
          tag 'watch-ctrl-comp',
            episode:   '{{episode}}'
            watchMode: '{{watchMode}}'
            
        tag 'scrub-comp',
          episode: '{{episode}}'
  
  watch:
    watchMode: ->
      if @watchMode is 'none' 
        @playPos = 0
        @$broadcast 'setScrubPos', 0
    playPos: ->
      if @watchMode in ['paused', 'playing']
        @$broadcast 'setScrubPos', @playPos
            
  events:
    scrubMoused: (playPos) ->
      if @episode 
        if @watchMode is 'tracking'
          @watchMode = 'paused'
          @oldPlayPos = @playPos
        @playPos = playPos
        @$broadcast 'setPlayPos', playPos
        
    watchCtrlClk: (text) ->
      switch text
        when 'Play' 
          if Math.abs(@playPos - @oldPlayPos) < 1 and @watchMode is 'paused'
            @tvPlaying = yes
            tvGlobal.ajaxCmd 'pauseTv'
          @watchMode = 'tracking'
        when 'Cancel' 
          if Math.abs(@playPos - @oldPlayPos) < 1 and @watchMode is 'paused'
            @tvPlaying = yes
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
          
  attached: ->
    if not @chkSessionIntrvl
      @chkSessionIntrvl = setInterval =>
        tvGlobal.ajaxCmd 'getPlayStatus', (err, status) =>
          if status.data
            {id, @videoFile, playPos, playState} = status.data
            # log 'tvState', playState
            @tvPlaying = (playState is 'playing')
            if @tvPlaying isnt @tvPlaying and
               Date.now() > @tvStartedPlay + 5e3
              @tvPlaying = tvPlaying
              log 'set tvPlaying using status', @tvPlaying
            # log '@tvPlaying', @tvPlaying
            if id isnt @id
              @episode = null
              @id = id
              for show in @allShows
                for episode in show.episodes
                  if episode.id is id
                    @show    = show
                    @episode = episode
                    break
                if @episode then break
            if @episode
              if @watchMode is 'none' then @watchMode = 'tracking'
              if @watchMode is 'tracking' and playPos isnt @lastTvPos
                @playPos = playPos
                @$broadcast 'setScrubPos', playPos
                @$broadcast 'setPlayPos',  playPos
                @lastTvPos = playPos
          else 
            if Date.now() > @tvStartedPlay + 5e3
              log 'setting watchmode to none using status'
              @watchMode = 'none'
      , 2000
