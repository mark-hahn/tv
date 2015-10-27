
log = require('debug') 'tv:tvctrl'
 
statusCnt = 0
lastCurPlayState = lastCurPlayPos = lastDataJson = null
  
module.exports =
class TvCtrl
  constructor: (@watchComp) ->
    setInterval =>
      tvGlobal.ajaxCmd 'getTvStatus', (err, status) =>
        # and ++statusCnt < 
        (dataJson = JSON.stringify status?.data)
        if err or
            dataJson      isnt lastDataJson     or
            @curPlayState isnt lastCurPlayState or
            @curPlayPos   isnt lastCurPlayPos
          lastDataJson     = dataJson
          lastCurPlayState = @curPlayState
          lastCurPlayPos   = @curPlayPos
          if (data = status?.data)
            log 'getTvStatus', {err, data, state:data.playState, pos:data.playPos}
        
        if status?.data
          # tvGlobal.ajaxCmd 'irCmd', 'hdmi4'
          {id, videoFile, playState, playPos} = status.data
          # log 'getTvStatus', {playState, playPos}
          if playState is 'buffering' then playState = 'playing'
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
            # log 'playPos', playState, playPos
          @tvIsStarting = no
        else 
          playState = 'none'
          if playState isnt @curPlayState and not @tvIsStarting
            @watchComp.newState playState
          @curPlayState = playState
          @id = yes
    , 500
 
  getPlayPos: -> @curPlayPos
  
  startTv: (episodeKey, action, force) ->
    log 'startTv', {action, force, @curPlayState, \
                    keymatch: (episodeKey is @curEpisodeKey)
                    episodeKey, @curEpisodeKey }
    if @curPlayState isnt 'playing' or 
          episodeKey isnt @curEpisodeKey or force
      if action is 'resume' and @curPlayState is 'paused' and
          (not @curEpisodeKey or episodeKey is @curEpisodeKey)
        tvGlobal.ajaxCmd 'pauseTv'
      else
        @tvIsStarting = yes
        goToStart = (action is 'goToStart')
        tvGlobal.ajaxCmd 'startTv', episodeKey, 'goToStart', (err) =>
          if err
            log 'tvGlobal.ajaxCmd startTv err', err
            if err is 500
              @watchComp.$dispatch 'popup', 'Start Plex in Roku and refresh'
      @curPlayState  = 'playing'
      @curEpisodeKey =  episodeKey
    
  stepBackTv: ->
    if @curPlayState is 'playing'
      tvGlobal.ajaxCmd 'backTv'
      
  skipFwdTv: ->
    
  skipBackTv: ->
    
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
        

