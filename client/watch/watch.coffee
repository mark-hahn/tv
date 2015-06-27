
Vue = require 'vue'
log = require('debug') 'tv:wch'

Vue.component 'watch-comp', 

{render, tag, div, img} = require 'teacup'

require './scrub'

(document.head.appendChild document.createElement('style')).textContent = """
  .watch-comp {
    position:relative;
    width:100%;
    height: 35.5rem;
  }
 .watch-left {
    width: 85%;
    height: 35.5rem;
    display: inline-block;
    overflow: hidden;
 }
 scrub-comp {
    display: inline-block;
    position:relative;
    width: 15%;
    height: 35.5rem;
 }
"""

Vue.component 'watch-comp', 
  props: ['watch']
  
  data: ->
    episodeLen: 42
    playPos: 40
    
  template: render ->
    div '.watch-left', ->
      div '.show-banner'
      div '.episode'
      div '.video'
      div '.controls', ->
        div '.jump-back'
        div '.play-pause'
        div '.jump-fwd'
      div '.audio', ->
        div '.vol-down'
        div '.vol-mute'
        div '.vol-up'
        
    tag 'scrub-comp',
      episodeLen: '{{episodeLen}}'
      playPos: '{{playPos}}'
