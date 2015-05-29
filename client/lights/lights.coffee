
Vue = require 'vue'
log = require('debug') 'tv:lts'

{render, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .sw-row {
    position:relative;
    width:100%;
    height:20%;
  }
  .switch-comp {
    position:relative;
    padding-top: 3%;
    width:23%;
    height:100%;
    display: inline-block;
  }
  .switch img {
    position:relative;
    width:100%;
  }
  .master {
    position:relative;
    left:30%;
  }
  .dot {
    position:absolute;
    left:4.3%;
    background-color:#2e2;
    width:10%;
    height:5%;
    border-radius:50%;
  }
"""

Vue.component 'light-sw-comp', 
  name: 'light-sw-comp'
  template: render ->
    div '.switch', vClass:'master:!switch.idx', vOn:'click:onClick', ->
      img src:'server/images/switch.png'
      div '.dot', vAttr:'style:dotTop(switch.brt,switch.idx)'
  methods:
    dotTop: (brt,idx) ->
      ofs = (if idx then 11 else 5.5)
      delta = (if idx then 4.4 else 4.65)
      'top:' + (ofs+(delta*Math.round((100-brt)/12.5))+(if brt then 0 else 0.5)) + '%'
    
    onClick: (e) ->
      el = @$el
      lightIdx = @switch.idx
      {top} = el.getBoundingClientRect()
      if ((e.pageY - top)/el.clientHeight) < 0.5 then brt = 100; cmd = 'turnOn'
      else brt = 0; cmd = 'turnOff'
      {switchRows} = @$parent.$parent.$data
      tvGlobal.lightChanging = yes
      for idx in (if lightIdx then [lightIdx] else [0,1,2,3,4,5,6])
        if idx is 0 then switchRows[0][3].brt = brt
        else
          if idx <= 3 then switchRows[0][idx-1].brt = brt
          else             switchRows[1][idx-4].brt = brt
        if idx then tvGlobal.ajaxCmd 'lightCmd', JSON.stringify [idx, cmd] 
      setTimeout (-> tvGlobal.lightChanging = no), 5000
      
# is one of page-comp pages
Vue.component 'lights-comp', 
  name: 'lights-comp'
  template: render ->
    div '.sw-row', vRepeat:'switchRow:switchRows' , ->
      div '.switch-comp', 
        vComponent:'light-sw-comp'
        vRepeat:'switch:switchRow'
        
  data: ->
    switchRows: [
      [
        {brt:0, idx:1}
        {brt:0, idx:2}
        {brt:0, idx:3}
        {brt:0, idx:0}
      ]
      [
        {brt:0, idx:4}
        {brt:0, idx:5}
        {brt:0, idx:6}
      ]
    ]

setTimeout ->
  do one = ->  
    if tvGlobal.lightChanging then setTimeout one, 500; return
    tvGlobal.ajaxCmd 'getLightLevels', (err, resp) ->
      # console.log 'getLightLevels', {err, resp}
      if resp and not tvGlobal.lightChanging
        levels = resp.data
        {switchRows} = document.getElementById('page-comp').__vue__.$data
        for idx in [0..2] then switchRows[0][idx].brt = levels[idx]
        for idx in [0..2] then switchRows[1][idx].brt = levels[idx+3]
      one()
, 100


