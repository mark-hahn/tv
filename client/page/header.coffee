
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
  .header .pwrOverlay {
    position:absolute;
    left:0;
    top:7%;
    width: 100%;
    height: 60%;
    color:white;
    background-color: #00c;
    opacity:0.8;
    border-radius: 1rem;
    font-size: 1.3rem;
    font-weight: bold;
    text-align: center;
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
      div '.pwrOverlay', vIf: 'pwrText',  vText: 'pwrText'
    div '.btn.onoff', vOn: 'mousedown: onOffDown, mouseup: onOffUp', 'Off'
  data: ->
    pwrText: ''
  methods:
    selPage: (e) -> @curPage = e.target.innerText.toLowerCase()
    onOffDown: (e) -> 
      if @pwrText then return
      onDown = e.target.innerText is 'On'
      timeoutOff()
      body = @$parent
      btnTimeout = setTimeout =>
        @pwrText = 'Power O' + (if onDown then 'n ...' else 'ff ...')
        setTimeout (=> @pwrText = ''), (if onDown then 16000 else 500)
        if onDown then body.turnOn() else body.turnOff()
      , 200
    onOffUp: timeoutOff
  