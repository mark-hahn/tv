
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:epiinf'

serverIp = '192.168.1.103'
plexPort = 32400
plexPfx  = "http://#{serverIp}:#{plexPort}"

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
      div '.episode-info-inner', ->
        img '.thumb',   vAttr: "src: '#{plexPfx}' + curEpisode.thumb"
        div '.summary', vText: 'curEpisode.summary'

