
log = require('debug') 'tv:tvctrl'

module.exports =
class TvCtrl
  constructor: (@watchComp) ->

    setInterval =>
      tvGlobal.ajaxCmd 'getTvStatus', (err, status) =>
        if status?.data
          {id, videoFile, playState, playPos} = status.data
          if id isnt @id
            @id = id
            @watchComp.setEpisodeById id, videoFile
          if playState isnt @curPlayState
            @curPlayState = playState
            @watchComp.newState playState
          if playPos isnt @curPlayPos
            @curPlayPos = playPos
            @watchComp.newPos playPos
          if @tvIsStarting
            log '@tvIsStarting = no, from status?.data'
          @tvIsStarting = no
        else 
          playState = 'none'
          if playState isnt @curPlayState
            log 'checking @tvIsStarting, from no status.data: ', 
                {playState, @curPlayState, @tvIsStarting}
          if playState isnt @curPlayState and
              not @tvIsStarting
            @watchComp.newState playState
            if @tvIsStarting
              log '@tvIsStarting = no, from no status.data'
            @tvIsStarting = no
          @curPlayState = playState
    , 2000

  getPlayPos: -> @curPlayPos
  geState:    -> @curPlayState
    
  startTv: (episodeKey, playPos) ->
    log 'startTv req', {@curPlayPos, playPos}
    if @curPlayState isnt 'playing' or episodeKey isnt @curEpisodeKey
      if @curPlayState is 'paused' and
          Math.abs(playPos - @curPlayPos) < 5 and
          episodeKey is @curEpisodeKey
        tvGlobal.ajaxCmd 'pauseTv'
        log 'tv started playing with pauseTv', 
      else
        @tvIsStarting = yes
        log '@tvIsStarting = yes, from startTv'
        tvGlobal.ajaxCmd 'startTv', episodeKey, playPos, (err) =>
          if err
            log 'tvGlobal.ajaxCmd startTv err', err
            if err is 500
              @watchComp.$dispatch 'popup', 'Start Plex in Roku and refresh'
        log 'tv started playing with startTv', {key: episodeKey, playPos}
      @curPlayState  = 'playing'
      @curPlayPos    =  playPos
      @curEpisodeKey =  episodeKey
    
  stepBackTv: ->
    tvGlobal.ajaxCmd 'backTv'
    
  pauseTv: ->
    if @curPlayState isnt 'paused'
      tvGlobal.ajaxCmd 'pauseTv'
      @curPlayState = 'paused'
      # log 'paused tv'
      
  unPauseTv: ->
    if @curPlayState is 'paused'
      tvGlobal.ajaxCmd 'pauseTv'
      @curPlayState = 'playing'
      # log 'unpaused tv'
      
  stopTv: ->
    if @curPlayState isnt 'stopped'
      tvGlobal.ajaxCmd 'stopTv'
      @curPlayState = 'stopped'
      # log 'stopped tv'
        

