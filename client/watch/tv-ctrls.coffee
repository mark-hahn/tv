
Vue     = require 'vue'
log     = require('debug') 'tv:wchctl'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .watch-ctrl {
    width: 98%;
    margin: 2% 0 1% 0;
  }
  .tv-ctrls {
    background-color: #cce;
    border:1px solid gray;
    padding: 0 0 2px 2px;
    margin-top:1%; 
    position:relative;
  }
  .watch-ctrl .tv-ctrls .ctrl-row .btn {
    font-size:1.8rem;
    line-height:1.5;
    width: 28%;
    height: 3rem;
    margin:1%; 
  }
  .tv-text {
    position: absolute;
    left:18.2rem;
    top:1.2rem;
    font-size:2rem;
  }
"""

Vue.component 'watch-ctrl-comp',
  props: ['episode', 'watch-mode']
  
  template: render ->
    div '.watch-ctrl', vIf: 'episode !== null', ->
      
      div '.tv-ctrls', ->
        div '.ctrl-row.audio-ctrls', ->
          div '.btn', vOn: 'click: watchCtrlClk', 'Vol -'
          div '.btn', vOn: 'click: watchCtrlClk', 'Mute'
          div '.btn', vOn: 'click: watchCtrlClk', 'Vol +'
          
        div '.ctrl-row.video-ctrls', ->
          div '.btn', vOn: 'click: watchCtrlClk', 'Stop'
          div '.btn', vOn: 'click: watchCtrlClk', '{{backResumeTxt}}'
          div '.btn', vOn: 'click: watchCtrlClk', '{{tvPlayPauseTxt}}'

        div '.tv-text', ->
          div 'T'
          div 'V'

  computed:
    backResumeTxt: ->
      switch @watchMode
        when 'tracking' then 'Back'
        else                 'Cancel'
      
    tvPlayPauseTxt: ->
      switch @watchMode
        when 'tracking' then 'Pause'
        else                 'Play'

  methods:
    watchCtrlClk: (e) -> 
      @$dispatch 'watchCtrlClk', e.target.innerText
      
