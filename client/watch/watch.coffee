
Vue    = require 'vue'
log    = require('../debug') '-watch'

{render, tag, div, img} = require 'teacup'

require '../episode/episode-info'
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
    showTitle:   null
    episode:     null
    playPos:     0
    playRate:    1
    revInterval: null
    volume:      0
    muted:       no

  template: render ->
    div '.watch-comp', ->
      div '.info-column', ->
        
        tag 'episode-info',
          showTitle:  '{{showTitle}}'
          curEpisode: '{{episode}}'
          
        tag 'tv-btns-comp',
          episode: '{{episode}}'
          
      tag 'scrub-comp',
        episode: '{{episode}}'
  
  events:
    startWatch: (@showTitle, @episode) ->
      @playPos = 0
      log 'startWatch', @episode.filePaths?[0]?[2]
      log 'bitrates', @episode.filePaths
      if (path = @episode.filePaths?[0]?[2])
        tvGlobal.ajaxCmd 'vlcCmd', 'start', @episode.showId, @episode.id, path
      setTimeout =>
        tvGlobal.ajaxCmd 'irCmd', 'hdmi3'
      , 3000
    
    tvBtnClick: (text) ->
      switch text
        when '> ||'
          if @playRate isnt 1
            @stopSkipping()
          else
            tvGlobal.ajaxCmd 'vlcCmd', 'playPause'
        when 'Mute'  then tvGlobal.ajaxCmd 'vlcCmd', 'toggleMute'
        when 'Vol +' then tvGlobal.ajaxCmd 'vlcCmd', 'volup'
        when 'Vol -' then tvGlobal.ajaxCmd 'vlcCmd', 'voldown'
        when 'Stop' 
          @stopSkipping()
          tvGlobal.ajaxCmd 'irCmd', 'hdmi2'
          @$dispatch 'chgCurPage', 'episode'
          setTimeout ->
            tvGlobal.ajaxCmd 'vlcCmd', 'stop'
          , 500
        when 'Reset' 
          @stopSkipping()
          tvGlobal.ajaxCmd 'vlcCmd', 'seek', 0
        when 'Back' 
          log 'back'
          @stopSkipping()
          @playPos = Math.max 0, @playPos - 10
          tvGlobal.ajaxCmd 'vlcCmd', 'seek', @playPos
        when '<<', '>>' 
          factor = switch
            when text is '>>' and @playRate <  1
              @stopSkipping() 
              @playRate = +1; 1.5
            when text is '>>' and @playRate >= 1 then +1.5
            when text is '<<' and @playRate >= 1 then @playRate = -1; 1 
            when text is '<<' and @playRate <  1 then +1.5
            else 1
          @playRate *= factor
          @playRate = Math.max -3, Math.min 3, @playRate
          if @playRate >= 1
            tvGlobal.ajaxCmd 'vlcCmd', 'playRate', @playRate
          else
            if not @revInterval
              @revInterval = setInterval =>
                @playPos += @playRate * 2
                @playPos = Math.max 0, @playPos
                log 'reverse', @playRate, @playPos
                tvGlobal.ajaxCmd 'vlcCmd', 'seek', @playPos
              , 1500

  methods:     
    stopSkipping: ->
      log 'stopSkipping'
      if @revInterval
        clearInterval @revInterval
      if @playRate isnt 1
        @playRate = 1
        tvGlobal.ajaxCmd 'vlcCmd', 'playRate', @playRate

  attached: ->
    evtSource = new EventSource "http://#{tvGlobal.serverIp}:2340/channel"
    log 'evtSource', evtSource
    
    evtSource.onopen = (e) ->
      log 'evtSource.onopen1:', e
      
    evtSource.onmessage = (e) ->
      log 'evtSource.onmessage:', e
      
    evtSource.onerror = (e) ->
      log 'evtSource.error:', e
      
    evtSource.addEventListener 'open', (e) ->
      log 'evtSource.onopen2:', e
      
    evtSource.addEventListener 'message', (e) ->
      log 'evtSource.onmessage:', e
      
    evtSource.addEventListener 'error', (e) ->
      log 'evtSource.error:', e
      
    setInterval ->
      log 'evtSource', evtSource
    , 5000
      
    # 
    # 
    # 
    # setInterval =>
    #   tvGlobal.ajaxCmd 'getPlayInfo', (err, res) => 
    #     if err then log 'getPlayInfo err', err.message; return
    #     if @revInterval then return
    #     [showId, episodeId, file, @playPos, @volume, @muted] = res.data
    #     if showId is 'notShowing' then return
    #     # log 'getPlayInfo', {res, showId, episodeId, file, @playPos, @volume}
    #     if not @episode.watched and @playPos > @episode.duration * 0.9
    #       @episode.watched = yes
    #       tvGlobal.ajaxCmd 'setDBField', @episode.id, 'watched', yes
    #     @$broadcast 'setScrubPos', @playPos
    # , 1000
    # 
