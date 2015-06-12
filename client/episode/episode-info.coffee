
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:epiinf'

{render, tag, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-info {
    width: 100%;
    position: relative;
    overflow: auto;
  }
  .episode-info-inner {
    width: 100%;
    padding: 0.1rem;
  }
  .thumb {
    width: 100%;
    border: 1px solid gray;
  }
  .summary {
    width: 100%;
    font-size: 0.8rem;
  }
"""

Vue.component 'episode-info', 
  props: ['cur-episode']
  
  template: render ->
    div '.episode-info', ->
      div '.episode-info-inner', vOn: 'click: epiInfoClick', ->
        img '.thumb',   vAttr: "src: '#{tvGlobal.plexPfx}' + curEpisode.thumb"
        div '.summary', vText: 'curEpisode.summary'

  methods:
    epiInfoClick: (e) -> @$dispatch 'startVideo'
    