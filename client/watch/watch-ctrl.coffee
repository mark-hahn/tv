
Vue     = require 'vue'
log     = require('debug') 'tv:wchctl'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .watch-ctrl {
    width: 98%;
  }
  .watch-ctrl .ctrl-row {
    margin-top: 1.5rem;
    display: block;
    height: 3rem;
  }
  .watch-ctrl .ctrl-row .btn {
    font-size:2rem;
    width: 33%;
    height: 3rem;
  }
"""

Vue.component 'watch-ctrl-comp',
  props: ['episode', 'watch-mode']
  
  template: render ->
    div '.watch-ctrl', vIf: 'episode !== null', ->
      div '.ctrl-row.audio-ctrls', ->
        div '.btn', vOn: 'click: watchCtrlClk', 'Vol -'
        div '.btn', vOn: 'click: watchCtrlClk', 'Mute'
        div '.btn', vOn: 'click: watchCtrlClk', 'Vol +'
        
      div '.ctrl-row.bookmarks', ->
        div '.btn', vOn: 'click: watchCtrlClk', 'Prev'
        div '.btn', vOn: 'click: watchCtrlClk', 'Mark'
        div '.btn', vOn: 'click: watchCtrlClk', 'Next'
        
      div '.ctrl-row.video-ctrls', ->
        div '.btn', vOn: 'click: watchCtrlClk', 'Stop'
        div '.btn', vOn: 'click: watchCtrlClk', 'Back'
        div '.btn', vOn: 'click: watchCtrlClk', '{{playPauseTxt}}'

  computed:
    playPauseTxt: ->
      switch @watchMode
        when 'playing' then 'Pause'
        else                'Play'

  methods:
    watchCtrlClk: (e) -> 
      @$dispatch 'watchCtrlClk', e.target.innerText
      
