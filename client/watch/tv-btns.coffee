
Vue     = require 'vue'
log     = require('debug') 'tv:tvbtns'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .watch-btn {
    width: 98%;
    margin: 2% 0 1% 0;
  }
  .tv-btns {
    background-color: #cce;
    border:1px solid gray;
    padding: 0 0 2px 2px;
    margin-top:1%; 
    position:relative;
  }
  .watch-btn .tv-btns .btn-row .btn {
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

Vue.component 'tv-btns-comp',
  props: ['episode', 'watchMode']
  
  template: render ->
    div '.watch-btn', ->
      
      div '.tv-btns', ->
        div '.btn-row.audio-btns', ->
          div '.btn', vOn: 'click: tvBtnClick', 'Vol -'
          div '.btn', vOn: 'click: tvBtnClick', 'Mute'
          div '.btn', vOn: 'click: tvBtnClick', 'Vol +'
          
        div '.btn-row.video-btns', ->
          div '.btn', vOn: 'click: tvBtnClick', 'Stop'
          div '.btn', vOn: 'click: tvBtnClick', '{{backResumeTxt}}'
          div '.btn', vOn: 'click: tvBtnClick', '{{tvPlayPauseTxt}}'

        div '.tv-text', -> div 'T'; div 'V'

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
    tvBtnClick: (e) -> 
      @$dispatch 'tvBtnClick', e.target.innerText
      
