
log = require('debug') 'tv:tvctrl'
 
# statusCnt = 0
statusUpdateInterval = 500
lastPlayState = lastPlayPos = lastDataJson = null

module.exports =
class TvCtrl
  constructor: (@watchComp) ->
 
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
