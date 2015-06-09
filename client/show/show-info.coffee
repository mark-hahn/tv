
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:shwinf'

serverIp = '192.168.1.103'
plexPfx = "http://#{serverIp}:32400"

{render, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-info {
    width: 100%;
    height:100%;
    position: relative;
    overflow: auto;
    border: 1px solid gray;
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
  paramAttributes: ['cur-showkey']

  template: render ->
    div '.show-info', ->
      div '.show-info-inner', ->
        img '.thumb',   vAttr: 'src: show.thumb'
        div '.summary', vText: 'show.summary'
            
  data: ->
    show: 
      thumb:   null
      summary: null
      title:   null

  created: ->
    @$once 'haveAllShows', ->
      @show.thumb   = plexPfx + tvGlobal.allShows[0].thumb
      @show.summary = tvGlobal.allShows[0].summary
