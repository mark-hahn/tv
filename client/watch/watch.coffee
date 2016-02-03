
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
          showTitle:   '{{showTitle}}'
          curEpisode:  '{{episode}}'
          playPos:     '{{playPos}}'
          watchScreen:  yes
          
        tag 'tv-btns-comp',
          episode: '{{episode}}'
          
      tag 'scrub-comp',
        vShow: 'episode'
        episode: '{{episode}}'
  
  events:
    startWatch: (@showTitle, @episode) ->
      @playPos = 0
      if (path = @episode.filePaths?[0]?[2])
        tvGlobal.ajaxCmd 'vlcCmd', 'start', @episode.showId, @episode.id, path
      setTimeout =>
        tvGlobal.ajaxCmd 'irCmd', 'hdmi3'
      , 3000
      
    stopWatch: ->
      @stopSkipping()
      setTimeout ->
        tvGlobal.ajaxCmd 'vlcCmd', 'stop'
      , 500
    
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
          tvGlobal.ajaxCmd 'irCmd', 'hdmi2'
          @$dispatch 'chgCurPage', 'episode'
          @$emit 'stopWatch'
        when 'Reset' 
          @stopSkipping()
          tvGlobal.ajaxCmd 'vlcCmd', 'seek', 0
        when 'Back' 
          @stopSkipping()
          # log 'back1', @playPos
          @playPos = Math.max 0, @playPos - 10
          # log 'back2', @playPos
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
                tvGlobal.ajaxCmd 'vlcCmd', 'seek', @playPos
              , 1500

  methods:     
    stopSkipping: ->
      if @revInterval
        clearInterval @revInterval
      if @playRate isnt 1
        tvGlobal.ajaxCmd 'vlcCmd', 'playRate', (@playRate = 1)

    gotStatusEvent: (status) ->
      # log 'gotStatusEvent playPos', status.playPos
      if status.notShowing 
        @showTitle = ''
        @episode = null
        return
      if @revInterval then return
      {showId, episodeId, file, @playPos, @volume, @muted} = status
      show = null
      if showId
        for show2 in @allShows when show2.id is showId
          show = show2
          @showTitle = show.tvdbTitle ? show.fileTitles?[0] ? ''
          break
      @episode = null
      if show
        for episode2 in show.episodes when episode2.id is episodeId
          @episode = episode2
          break
      if @episode and not @episode.watched and @playPos > @episode.duration * 0.9
        @episode.watched = yes
        tvGlobal.ajaxCmd 'setDBField', @episode.id, 'watched', yes
      # log 'gotStatus setScrubPos', @playPos
      @$broadcast 'setScrubPos', @playPos

  attached: ->
    evtSource = new EventSource "/channel"  
      
    evtSource.addEventListener 'status', (e) =>
      # log 'status event', e
      @gotStatusEvent JSON.parse e.data
      
    evtSource.addEventListener 'error', (e) ->
      log 'evtSource.error:', e
    
    
