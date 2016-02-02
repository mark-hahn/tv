
Vue     = require 'vue'
log     = require('./debug') 'hdr'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .header {
    position:relative;
    display:inline-block;
    width: 83%;
    height: 2.6rem;
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
  props: ['curPage']

  name: 'header-comp'
  template: render ->
    div '.header-comp', ->
      div '.btn.onoff', vOn: 'mousedown: onOff', 'Pwr'
      div '.header', vOn: 'mousedown: selPage', ->
        div '.btn', vClass: 'selected: curPage == "show"',    'Show'
        div '.btn', vClass: 'selected: curPage == "episode"', 'Episo'
        div '.btn', vClass: 'selected: curPage == "record"',  'Cable'
        div '.btn', vClass: 'selected: curPage == "watch"',   'Watc'
    
  data: ->
    powerText: ''
     
  methods:
    selPage: (e) -> 
      @$dispatch 'chgCurPage', 
        switch e.target.innerText[0]
          when 'S' then 'show'
          when 'E' then 'episode'
          when 'C' then 'record'
          when 'W' then 'watch'
          else @curPage
    
    onOff: (e) -> 
      tvGlobal.ajaxCmd 'power'
      
        