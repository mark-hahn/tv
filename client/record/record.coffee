
util    = require 'util'
Vue     = require 'vue'
moment  = require 'moment'
log     = require('../debug') 'cable'

require './record-css'

{render, tag, div, img, input, select, option, label, text, button, hr} = 
  require 'teacup'

chanList = null

Vue.component 'record-comp', 
  name: 'record-comp'
  template: render ->
    div '.record-comp', ->
      div '.rec-top', ->
      div '.rec-left', ->
        div '.net-btns-inner', ->
          div '.net-btn',
            channel: '{{chan[0]}}'
            vRepeat: 'chan:chanList'
            vOn:     'click: chanClick'
          , ->
            div '.rec-chan-img-div', ->
              img '.rec-empty-img', 
                src:   '/client/record/images/empty.png'
              img '.rec-chan-img', 
                src:   '/client/record/images/{{chan[0]}}.png'
                onload:"this.style.display = 'inline-block'"
            div '.rec-chan-txt', ->
              div '.chan-txt', '{{chan[1]}}'
      div '.rec-right', ->
        div '.live-btn', 
          vOn: 'click: liveClick'
          vClass: 'right-sel-btn:rightSel=="live"'
        , 'Live'
      div '.rec-bot', ->
        tag 'tv-btns-comp'
              
  data: ->
    chanList: chanList
    rightSel: null
  
  methods:
    startLive: ->
      if @rightSel is 'live' and @curChannel
        @$dispatch 'stopWatch'
        tvGlobal.ajaxCmd 'vlcCmd', 'live', @curChannel
      setTimeout =>
        tvGlobal.ajaxCmd 'irCmd', 'hdmi3'
      , 3000

    chanClick: (e) ->
      innerDiv = document.querySelector '.net-btns-inner'
      for netBtn in innerDiv.querySelectorAll '.net-btn'
        netBtn.classList.remove 'chan-sel'
      e.currentTarget.classList.add 'chan-sel'
      @curChannel = e.currentTarget.getAttribute 'channel'
      @startLive()
        
    liveClick: (e) ->
      if @rightSel isnt 'live'
        @rightSel = 'live'
        @startLive()      
      else
        @$dispatch 'stopWatch'
        rightSel = null
        
  events:
    tvBtnClick: (text) ->
      switch text
        when 'Mute'  then tvGlobal.ajaxCmd 'vlcCmd', 'toggleMute'
        when 'Vol +' then tvGlobal.ajaxCmd 'vlcCmd', 'volup'
        when 'Vol -' then tvGlobal.ajaxCmd 'vlcCmd', 'voldown'

chanList = [ 
  [507, 'ABC']
  [502, 'CBS']
  [504, 'NBC']
  [511, 'FOX']
  [570, 'ESPN']
  [574, 'ESPN 2']
  [573, 'ESPNU']
  [588, 'NFL Network']
  [590, 'NBC Sports']
  [524, 'PBS']
  [528, 'KCET']
  [550, 'USA']
  [551, 'TNT']
  [552, 'TBS']
  [600, 'CNN']
  [602, 'CNBC']
  [619, 'AccuWeather']
  [620, 'Discovery']
  [681, 'A&E']
  [640, 'Lifetime']
  [621, 'National Geo']
  [622, 'Science Channel']
  [628, 'History']
  [630, 'Animal Planet']
  [634, 'Smithsonian']
  [639, 'TLC']
  [663, 'Cooking Channel']
  [664, 'Food Network']
  [665, 'Home Garden TV']
  [680, 'SYFY']
  [685, 'Bravo']
  [734, 'IFC']
  [746, 'HD Net Movies']
  [576, 'FSN']
  [577, 'FSN Prime Tkt']
  [669, 'AWE']
  [668, 'Dest America']
  [631, 'Velocity']
  [641, 'LMN']
  [569, 'AXS.tv']
  [715, 'Palladia']
  [505, 'KTLA']
  [506, 'KDOC']
  [508, 'KOCE']
  [509, 'KCAL']
  [510, 'KVEA']
  [513, 'KCOP']
  [517, 'KJLA']
  [523, 'KVMD']
  [530, 'KPXN']
  [534, 'KMEX']
  [544, 'KXLA']
  [546, 'KFTR']
  [522, 'KWHY Mundo']
  [514, 'KAZA Azteca']
  [512, 'KRCA Estrella']
]