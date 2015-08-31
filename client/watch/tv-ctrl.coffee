
log = require('debug') 'tv:tvctrl'

module.exports =
class TvCtrl
  constructor: (@watchComp) ->
    setInterval =>
      tvGlobal.ajaxCmd 'getTvStatus', (err, status) =>
        if status?.data
          # tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
          {id, videoFile, playState, playPos} = status.data
          if id isnt @id
            playingWhenLoaded = (not @id and playState is 'playing')
            @watchComp.setEpisodeById id, videoFile, playingWhenLoaded
            @id = id
          if playState isnt @curPlayState
            @curPlayState = playState
            @watchComp.newState playState
          if playPos isnt @curPlayPos
            @curPlayPos = playPos
            @watchComp.newPos playPos
          @tvIsStarting = no
        else 
          playState = 'none'
          if playState isnt @curPlayState and not @tvIsStarting
            @watchComp.newState playState
          @curPlayState = playState
          @id = yes
    , 2000

  getPlayPos: -> @curPlayPos
  
  startTv: (episodeKey, playPos, force) ->
    if @curPlayState isnt 'playing' or 
          episodeKey isnt @curEpisodeKey or force
      if @curPlayState is 'paused' and
          Math.abs(playPos - @curPlayPos) < 5 and
          episodeKey is @curEpisodeKey
        tvGlobal.ajaxCmd 'pauseTv'
      else
        @tvIsStarting = yes
        tvGlobal.ajaxCmd 'startTv', episodeKey, playPos, (err) =>
          if err
            log 'tvGlobal.ajaxCmd startTv err', err
            if err is 500
              @watchComp.$dispatch 'popup', 'Start Plex in Roku and refresh'
      @curPlayState  = 'playing'
      @curPlayPos    =  playPos
      @curEpisodeKey =  episodeKey
    
  stepBackTv: ->
    if @curPlayState is 'playing'
      tvGlobal.ajaxCmd 'backTv'
    
  pauseTv: ->
    if @curPlayState isnt 'paused'
      tvGlobal.ajaxCmd 'pauseTv'
      @curPlayState = 'paused'
      
  unPauseTv: ->
    if @curPlayState is 'paused'
      tvGlobal.ajaxCmd 'pauseTv'
      @curPlayState = 'playing'
      
  stopTv: ->
    if @curPlayState not in  ['none', 'stopped']
      tvGlobal.ajaxCmd 'stopTv'
    @curPlayState = 'stopped'
        

