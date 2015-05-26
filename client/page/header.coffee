
Vue     = require 'vue'
log     = require('debug') 'tv:hdr'
request = require 'superagent'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .header {
    position:relative;
    display:inline-block;
    width: 80%;
    height: 2.6rem;
  }
  .header .btn {
    width: 25%;
  }
  .btn.onoff {
    width: 10%;
  }
"""

btnTimeout = null
timeoutOff = ->
  if btnTimeout then clearTimeout btnTimeout
  btnTimeout = null

Vue.component 'header', 
  template: render ->
    div '.btn.onoff', vOn: 'mousedown: onOffDown, mouseup: onOffUp', 'On'
    div '.header', vOn: 'mousedown: selPage', ->
      div '.btn', vClass: 'selected: curPage == "show"',    'Show'
      div '.btn', vClass: 'selected: curPage == "episode"', 'Episode'
      div '.btn', vClass: 'selected: curPage == "watch"',   'Watch'
      div '.btn', vClass: 'selected: curPage == "lights"',  'Lights'
    div '.btn.onoff', vOn: 'mousedown: onOffDown, mouseup: onOffUp', 'Off'
  methods:
    selPage: (e) -> @curPage = e.target.innerText.toLowerCase()
    onOffDown: (e) -> 
      timeoutOff()
      body = @$parent
      btnTimeout = setTimeout ->
        if e.target.innerText is 'On' then body.turnOn() else body.turnOff()
      , 500
    onOffUp: timeoutOff
  