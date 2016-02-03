
Vue     = require 'vue'
log     = require('../debug') 'tvbtns'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .tv-btns {
    background-color: #ccd;
    padding: 0 0 2px 2px;
    margin-top:1%; 
    position:relative;
    border-radius: 3%;
  }
  .watch-btn .tv-btns .btn-row .btn {
    font-size:1.8rem;
    line-height:2;
    width: 31%;
    height: 4rem;
    margin:1%; 
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
          
        div '.btn-row.video-btns', vShow:"episode", ->
          div '.btn', vOn: 'click: tvBtnClick', 'Stop'
          div '.btn', vOn: 'click: tvBtnClick', 'Reset'
          div '.btn', vOn: 'click: tvBtnClick', 'Back'

        div '.btn-row.skip-btns', vShow:"episode", ->
          div '.btn', vOn: 'click: tvBtnClick', '<<'
          div '.btn', vOn: 'click: tvBtnClick', '> ||'
          div '.btn', vOn: 'click: tvBtnClick', '>>'

  computed:
    tvPlayPauseTxt: ->
      switch @watchMode
        when 'playing' then 'Pause'
        else                 'Play'

  methods:
    tvBtnClick: (e) -> 
      @$dispatch 'tvBtnClick', e.target.innerText
      
