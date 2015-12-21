
log = require('debug') 'tv:tvctrl'
 
# statusCnt = 0
statusUpdateInterval = 500
simulatedElapsedTime = 0
skipSpeedup = [0, 17.5, 94, 307]

lastSimulatedTimeUpdate = Date.now() / 1e3
lastPlayState = lastPlayPos = lastDataJson = null

module.exports =
class TvCtrl
  constructor: (@watchComp) ->
    @skipping = 0
    # setInterval =>
    #   playPosChg = no
    #   tvGlobal.ajaxCmd 'getTvStatus', (err, status) =>
    #     # and ++statusCnt < 
    #     if (data = status?.data)
    #       {id, videoFile, playState, playPos} = data
    #       if playState is 'buffering' then playState = 'playing'
    #       
    #       playPosChg = (playPos isnt lastPlayPos)
    #       dataJson = JSON.stringify data
    #       if playPosChg or
    #           dataJson  isnt lastDataJson or
    #           playState isnt lastPlayState
    #         lastDataJson  = dataJson
    #         lastPlayState = playState
    #         lastPlayPos   = playPos
    #         # log 'tv status', {err, data, playState, playPos}
    #         
    #       now = Date.now() / 1e3
    #       if playPosChg
    #         simulatedElapsedTime = 0
    #       else
    #         speedFactor = 
    #           if @skipping then skipSpeedup[Math.abs @skipping] *
    #                             (if @skipping < 0 then -1 else +1)
    #           else if playState is 'playing' then 1
    #           else 0
    #         simulatedElapsedTime += 
    #           (now - lastSimulatedTimeUpdate) * speedFactor
    #         playPos += simulatedElapsedTime
    #       lastSimulatedTimeUpdate = now
    #         
    #       if id isnt @id
    #         playingWhenLoaded = (not @id and playState is 'playing')
    #         @watchComp.setEpisodeById id, videoFile, playingWhenLoaded
    #         @id = id
    #         
    #       if playState isnt @curPlayState
    #         @curPlayState = playState
    #         @watchComp.newState playState
    #         
    #       if playPos isnt @curPlayPos
    #         @curPlayPos = playPos
    #         @watchComp.newPos playPos
    #         # log 'playPos', {playState, playPos, speedFactor, simulatedElapsedTime}
    #         
    #       @tvIsStarting = no
    #       
    #     else 
    #       playState = 'none'
    #       if playState isnt @curPlayState and not @tvIsStarting
    #         @watchComp.newState playState
    #       @curPlayState = playState
    #       @id = yes
    # , 600e3 # statusUpdateInterval
 
  getPlayPos: -> @curPlayPos
  
  startVlc: (path = @curPath, action, force) ->
    log 'startVlc', {action, force, @curPlayState, \
                    keymatch: (path is @curPath)
                    path, @curPath }
    if @curPlayState isnt 'playing' or 
          path isnt @curPath or force
      if action is 'resume' and @curPlayState is 'paused' and
          (not @curPath or path is @curPath)
        tvGlobal.ajaxCmd 'pauseVlc'
      else
        # @tvIsStarting = yes
        goToStart = (action is 'goToStart')
        tvGlobal.ajaxCmd 'startVlc', path, (err) =>
          if err
            log 'tvGlobal.ajaxCmd startVlc err', err
            if err is 500
              @watchComp.$dispatch 'popup', 'Make sure tv player is running.'
      @curPlayState  = 'playing'
      @curPath =  path
     
  # stepbackVlc: ->
  #   if @curPlayState is 'playing'
  #     tvGlobal.ajaxCmd 'backVlc'
  #     
  pauseVlc: ->
    if @curPlayState isnt 'paused'
      tvGlobal.ajaxCmd 'pauseVlc'
      @curPlayState = 'paused'
      
  unpauseVlc: ->
    if @curPlayState is 'paused'
      tvGlobal.ajaxCmd 'pauseVlc'
      @curPlayState = 'playing'
      
  stopVlc: ->
    if @curPlayState not in  ['none', 'stopped']
      tvGlobal.ajaxCmd 'stopVlc'
    @curPlayState = 'stopped'
    
  # startSkip: (dir) ->
  #   if dir is 'Fwd' then @skipping = Math.min  3, ++@skipping  \
  #                   else @skipping = Math.max -3, --@skipping
  #   if @skipping is 0 then @stopSkip yes
  #   else tvGlobal.ajaxCmd "skip#{dir}Tv"
  #       
  # stopSkip: (force) ->
  #   if (wasSkipping = @skipping) or force
  #     @skipping = 0
  #     tvGlobal.ajaxCmd 'pauseVlc'
  #   wasSkipping
  #   
