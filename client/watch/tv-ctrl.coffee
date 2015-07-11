
log     = require('debug') 'tv:tvctrl'

module.exports =
class TvCtrl
  constructor: (@watchComp) ->

    setInterval =>
      tvGlobal.ajaxCmd 'getTvStatus', (err, status) =>
        if status.data
          {id, videoFile, playState, playPos} = status.data
          # log 'tvState', playState
          if id isnt @id
            @id = id
            @watchComp.setEpisodeById id, videoFile
          if playState isnt @curPlayState
            # log 'tvStateChange', @curPlayState, '->', playState
            @curPlayState = playState
            @watchComp.newState playState
          if playPos isnt @curPlayPos
            # log 'tvPosChange', {playPos, @curPlayPos}
            @curPlayPos = playPos
            @watchComp.newPos playPos
        else 
          playState = 'none'
          if playState isnt @curPlayState
            # log 'tvStateChange', @curPlayState, '->', playState
            @curPlayState = playState
            @watchComp.newState playState
    , 2000

  getPlayPos: -> @curPlayPos
  geState:    -> @curPlayState
    
  startTv: (episodeKey, playPos) ->
    # log 'startTv req', {@curPlayPos, playPos}
    if @curPlayState isnt 'playing' or episodeKey isnt @curEpisodeKey
      if @curPlayState is 'paused' and
          Math.abs(playPos - @curPlayPos) < 2 and
          episodeKey is @curEpisodeKey
        tvGlobal.ajaxCmd 'pauseTv'
        log 'tv started playing with pauseTv', 
      else
        tvGlobal.ajaxCmd 'startTv', episodeKey, playPos, (err) =>
          if err
            log 'tvGlobal.ajaxCmd startTv err', err
            if err is 500
              @watchComp.$dispatch 'popup', 'Start Plex in Roku and refresh'
        log 'tv started playing with startTv', {key: episodeKey, playPos}
      @curPlayState  = 'playing'
      @curPlayPos    = playPos
      @curEpisodeKey = episodeKey
    
  stepBackTv: ->
    tvGlobal.ajaxCmd 'backTv'
    
  pauseTv: ->
    if @curPlayState isnt 'paused'
      tvGlobal.ajaxCmd 'pauseTv'
      @curPlayState = 'paused'
      log 'tv was paused'
      
  unPauseTv: ->
    if @curPlayState is 'paused'
      tvGlobal.ajaxCmd 'pauseTv'
      @curPlayState = 'playing'
      log 'tv was unpaused'
      
  stopTv: ->
    if @curPlayState isnt 'stopped'
      tvGlobal.ajaxCmd 'stopTv'
      @curPlayState = 'stopped'
      log 'tv was stopped'
        

