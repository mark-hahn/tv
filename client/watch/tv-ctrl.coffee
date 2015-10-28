
log = require('debug') 'tv:tvctrl'
 
# statusCnt = 0
statusUpdateInterval = 500
simulatedElapsedTime = 0
lastSimulatedTimeUpdate = Date.now() / 1e3
skipSpeedup = lastPlayState = lastPlayPos = lastDataJson = null
  
module.exports =
class TvCtrl
  constructor: (@watchComp) ->
    setInterval =>
      playPosChg = no
      tvGlobal.ajaxCmd 'getTvStatus', (err, status) =>
        # and ++statusCnt < 
        if (data = status?.data)
          {id, videoFile, playState, playPos} = data
          if playState is 'buffering' then playState = 'playing'
          
          playPosChg = (playPos isnt lastPlayPos)
          dataJson = JSON.stringify data
          if playPosChg or
              dataJson  isnt lastDataJson or
              playState isnt lastPlayState
            lastDataJson  = dataJson
            lastPlayState = playState
            lastPlayPos   = playPos
            # log 'tv status', {err, data, playState, playPos}
            
          now = Date.now() / 1e3
          if playPosChg
            # log 'playPosChg'
            simulatedElapsedTime = 0
          else
            speedFactor = 
              if @skipping then skipSpeedup * @skipping
              else if playState is 'playing' then 1
              else 0
            simulatedElapsedTime += 
              (now - lastSimulatedTimeUpdate) * speedFactor
            playPos += simulatedElapsedTime
          lastSimulatedTimeUpdate = now
            
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
    , statusUpdateInterval
 
  getPlayPos: -> @curPlayPos
  
  startTv: (episodeKey = @curEpisodeKey, action, force) ->
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
    
  startSkip: (dir) ->
    if not @skipping
      @skipping = (if dir is 'Fwd' then 1 else -1)
      log 'start skipping', dir, '---- tvpos:', @curPlayPos, '----'
      tvGlobal.ajaxCmd "skip#{dir}Tv"
        
  stopSkip: ->
    if (wasSkipping = @skipping)
      @skipping = 0
      log 'stop  skipping     ', '---- tvpos:', @curPlayPos, '----'
      tvGlobal.ajaxCmd 'pauseTv'
    wasSkipping
    
  test: ->
    delay = 20
    setTimeout =>
      log 'testing skip timing for', delay, 'seconds'
      # @startSkip 'Fwd'
      @startSkip 'Back'
      setTimeout (=> @stopSkip()), delay * 1e3
    , 5000

skipSpeedup = 17.5
   
###
todo: 
   ignore one status update after stopSkip ?
   faster web video update when skipping
   is minus the correct adjustment to end up before?
   
 fwd:           removed buffering chk
    1  -21  +9 |  +9  +2 -22 -12 -13
    2  -22  +1 |  -8  -8 -12  -9
    3  +35  +3 | -17  +1  -8  -5
    4  +56  -6 | -19  -4  -7 -10
    5  +79 -13 | -12  -8  -5 -22 -9
   20             -1 -11  +1  -4  0  +1  -1
    
 back:
    1  +11
    2  +13 
    3  +12  +4
    4  +18
    5  +11 +14
   20   +6  -2 +11
    
###
