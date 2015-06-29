
Vue = require 'vue'
log = require('debug') 'tv:wchnfo'

{render, tag, div, img, video} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
 .show-banner {
   width:98%;
 }
 .watch-episode-title {
  text-align: center;
  font-size: 1.4rem; 
 }
 .watch-info video {
   margin-top: .5rem;
   width:98%;
 }
"""

Vue.component 'watch-info-comp', 
  props: ['show', 'episode', 'play-pos']
  
  computed:
    bannerUrl: ->
      tvGlobal.plexPfx + @episode.banner
  
  template: render ->
    div '.watch-info', vIf: 'episode !== null', ->
      img '.show-banner', vAttr: 'src: bannerUrl'
      div '.watch-episode-title', '{{episode.episodeNumber + " " + episode.title}}'
      video '.video', vAttr: 'src: episode.banner'
      div '.controls', ->
        div '.jump-back'
        div '.play-pause'
        div '.jump-fwd'
      div '.audio', ->
        div '.vol-down'
        div '.vol-mute'
        div '.vol-up'
      
