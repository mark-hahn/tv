
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:snf'

serverIp = '192.168.1.103'
ajaxPfx = "http://#{serverIp}:1344/"
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
    showInfo = @
    
    request
      .get ajaxPfx + 'shows'
      .set 'Content-Type', 'text/plain'
      .set 'Accept', 'application/json'
      .end (err, res) ->
        if err then log 'get err: ' + err.message; return
        shows = JSON.parse res.text
        log 'got ' + shows.length + ' shows'
        showInfo.show.thumb   = plexPfx + shows[0].thumb
        showInfo.show.summary = shows[0].summary

