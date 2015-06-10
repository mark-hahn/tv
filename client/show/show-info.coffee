
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:shwinf'

serverIp = '192.168.1.103'
plexPort = 32400
plexPfx  = "http://#{serverIp}:#{plexPort}"

{render, tag, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-info {
    width: 100%;
    position: relative;
    overflow: auto;
  }
  .show-info-inner {
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

Vue.component 'show-info', 
  props: ['cur-show']
  
  template: render ->
    div '.show-info', ->
      div '.show-info-inner', ->
        img '.thumb',   vAttr: "src: '#{plexPfx}' + curShow.thumb"
        div '.summary', vText: 'curShow.summary'

