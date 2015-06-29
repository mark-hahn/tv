
Vue = require 'vue'
log = require('debug') 'tv:wchnfo'

{render, tag, div, img, video} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
 .watch-info {
   width:98%;
 }
 .show-banner {
   width:100%
 }
 .watch-episode-title {
  text-align: center;
  font-size: 1.4rem; 
  max-width: 100%;
  margin-bottom: .5rem;
 }
 .watch-info video {
   margin-top: .5rem;
   width:100%;
 }
"""

Vue.component 'watch-info-comp', 
  props: ['show', 'episode', 'video-key', 'play-pos', 'play-state']
  
  computed:
    bannerUrl: -> tvGlobal.plexPfx + @show.banner
    videoUrl:  -> tvGlobal.plexPfx + @videoKey
      
  template: render ->
    div '.watch-info', vIf: 'episode !== null', ->
      img '.show-banner', vAttr: 'src: bannerUrl'
      div '.watch-episode-title', 
            '{{episode.episodeNumber + ": " + episode.title}}'
      video '.video', vAttr: 'src: videoUrl', autoplay:yes, preload: 'auto', controls: yes,
      div '.controls', ->
        div '.jump-back'
        div '.play-pause'
        div '.jump-fwd'
      div '.audio', ->
        div '.vol-down'
        div '.vol-mute'
        div '.vol-up'
        
  methods:
    setPlayState: ->
      if @videoEle
        @videoEle.currentTime = @playPos
        switch @playState
          when 'playing' then @videoEle?.play()
          else @videoEle?.pause()
      
  watch:
    playPos:   -> 
      log 'playPos chg', @playPos
      @setPlayState()
    playState: -> 
      log 'playState chg', @playState
      @setPlayState()
      
  attached: -> 
    intervalTO = setInterval => 
      if not (@videoEle = @$el.querySelector 'video')
        return 
      if intervalTO then clearInterval intervalTO
      setTimeout =>
        @setPlayState()
      , 500
        
      # @videoEle.volume = 0.5
      # @videoEle.muted = no
      # log 'networkState', @videoEle.type, @videoEle.networkState, @videoEle.NETWORK_NO_SOURCE
    , 300
    
  detached: ->
    @videoEle?.pause()
