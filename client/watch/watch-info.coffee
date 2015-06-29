
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
  props: ['show', 'episode', 'video-key']
  
  computed:
    bannerUrl: ->
      log 'bannerUrl', {prfx: tvGlobal.plexPfx, banner: @show.banner}
      tvGlobal.plexPfx + @show.banner
      
    videoUrl: ->
      log 'videoUrl', {prfx: tvGlobal.plexPfx, @videoKey}
      tvGlobal.plexPfx + @videoKey
      
  template: render ->
    div '.watch-info', vIf: 'episode !== null', ->
      img '.show-banner', vAttr: 'src: bannerUrl'
      div '.watch-episode-title', 
            '{{episode.episodeNumber + ": " + episode.title}}'
      video '.video', vAttr: 'src: videoUrl', autoplay:yes, preload: 'auto'
      div '.controls', ->
        div '.jump-back'
        div '.play-pause'
        div '.jump-fwd'
      div '.audio', ->
        div '.vol-down'
        div '.vol-mute'
        div '.vol-up'
      
