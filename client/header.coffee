
Vue     = require 'vue'
log     = require('debug') 'tv:hdr'
request = require 'superagent'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .header {
    position:relative;
    display:inline-block;
    width: 68%;
    height: 2.6rem;
  }
  .header .pwrOverlay {
    position:absolute;
    left:0;
    top:1.6rem;
    width: 100%;
    height: 60%;
    color:white;
    background-color: #00c;
    opacity:0.5;
    border-radius:0.5rem;
    font-size: 1.2rem;
    font-weight: bold;
    text-align: center;
    z-index:10;
  }
  .header .btn {
    width: 25%;
  }
  .btn.onoff {
    width: 16%;
  }
"""

btnTimeout = null
timeoutOff = ->
  if btnTimeout then clearTimeout btnTimeout
  btnTimeout = null

Vue.component 'header-comp', 
  props: ['cur-page']

  name: 'header-comp'
  template: render ->
    div '.btn.onoff', vOn: 'mousedown: onOffDown, mouseup: onOffUp', 'On'
    div '.header', vOn: 'mousedown: selPage', ->
      div '.btn', vClass: 'selected: cur-page == "show"',    'Show'
      div '.btn', vClass: 'selected: cur-page == "episode"', 'Episo'
      div '.btn', vClass: 'selected: cur-page == "watch"',   'Watch'
      div '.btn', vClass: 'selected: cur-page == "lights"',  'Light'
      div '.pwrOverlay', vIf: 'powerText',  vText: 'powerText'
    div '.btn.onoff', vOn: 'mousedown: onOffDown, mouseup: onOffUp', 'Off'
  data: ->
    powerText: ''
    
  methods:
    selPage: (e) -> 
      @curPage = switch e.target.innerText[0..3]
        when 'Show' then 'show'
        when 'Epis' then 'episode'
        when 'Watc' then 'watch'
        when 'Ligh' then 'lights'
        else @curPage
    
    onOffDown: (e) -> 
      if @powerText then return
      onBtn = e.target.innerText is 'On'
      timeoutOff()
      body = @$parent
      btnTimeout = setTimeout =>
        @powerText = 'Turning TV O' + (if onBtn then 'n ...' else 'ff ...')
        setTimeout (=> @powerText = ''), (if onBtn then 16000 else 500)
        if onBtn then tvGlobal.ajaxCmd 'turnOn' else tvGlobal.ajaxCmd 'irCmd', 'pwrOff'
      , 200
    onOffUp: timeoutOff
  