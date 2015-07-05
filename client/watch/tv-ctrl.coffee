
module.exports =
class TvCtrl
  constructor: (newShow, newEpisode, newState, newPos) ->
    setInterval =>
      tvGlobal.ajaxCmd 'getTvStatus', (err, status) =>
        if status.data
          {id, @videoFile, playState, playPos} = status.data
          # log 'tvState', playState
          @tvPlaying = (playState is 'playing')
          if id isnt @id
            @episode = null
            @id = id
            for show in @allShows
              for episode in show.episodes
                if episode.id is id
                  newShow(@show = show)
                  newEpisode(@episode = episode)
                  break
              if @episode then break  
          if not @episode
            newShow()
            newEpisode()
            return
          if playState isnt @curPlayState
            log 'tvStateChange', @curPlayState, '->', playState
            @curPlayState = playState
            newState playState
          if playPos isnt @curPlayPos
            log 'tvPosChange', {playPos, @curPlayPos}
            @curPlayPos = playPos
            newPos playPos
        else 
          playState = 'none'
          if playState isnt @curPlayState
            log 'tvStateChange', @curPlayState, '->', playState
            @curPlayState = playState
            newState playState
    , 2000

  getTvStatus: ->
    playState: @curPlayState
    playPos: @curPlayPos
    
  startTv: (episode, playPos) ->
    log 'startTv req', {@curPlayPos, playPos}
    if @curPlayState isnt 'playing'
      if @curPlayState is 'paused' and
          Math.abs(playPos - @curPlayPos) < 2
        tvGlobal.ajaxCmd 'pauseTv'
        log 'tv started playing with pauseTv', 
      else
        tvGlobal.ajaxCmd 'startTv', @videoEle.currentTime
        log 'tv started playing with startTv'
      @curPlayState = 'playing'
      @curPlayPos   = playPos
    
  backTv: ->
    tvGlobal.ajaxCmd 'backTv'
    
  pauseTv: ->
    if @curPlayState isnt 'paused'
      tvGlobal.ajaxCmd 'pauseTv'
      @curPlayState = 'paused'
      log 'tv was paused'
      
  stopTv: ->
    if @curPlayState isnt 'stopped'
      tvGlobal.ajaxCmd 'stopTv'
      @curPlayState = 'stopped'
      log 'tv was stopped'
        

