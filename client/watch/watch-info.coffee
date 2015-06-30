
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
  margin-top:1rem;
 }
 .watch-info video {
   margin-top: 1rem;
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
      video '.video', 
        vAttr:'src: videoUrl'
        autoplay:yes
        preload:'auto'
        vOn:'click:onClick'
      div '.controls', ->
        div '.jump-back'
        div '.play-pause'
        div '.jump-fwd'
      div '.audio', ->
        div '.vol-down'
        div '.vol-mute'
        div '.vol-up'
        
  methods:
    onClick: ->
      log 'onClick'
      tvGlobal.ajaxCmd 'playPauseVideo'
      if @playState is 'playing'
        @videoEle?.play()
      else 
        @videoEle?.pause()
        tvGlobal.ajaxCmd 'startVideo', @videoEle.currentTime
        
    setPlayState: ->
      if @videoEle
        @videoEle.currentTime = @playPos
        # switch @playState
        #   when 'playing' then @videoEle?.play()
        #   else @videoEle?.pause()
      
  watch:
    playPos:   -> @setPlayState()
    playState: -> @setPlayState()
      
  attached: -> 
    intervalTO = setInterval => 
      if not (@videoEle = @$el.querySelector 'video') then return 
      if intervalTO then clearInterval intervalTO
      setTimeout (=> @setPlayState()), 500
    , 300
    
  detached: ->
    @videoEle?.pause()
