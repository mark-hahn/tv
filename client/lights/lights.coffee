
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
    width:100%;
  }
  .master {
    position:relative;
    left:30%;
    top:5rem;
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
    div '.switch', vClass:'master:!switch.idx', ->
      img src:'server/images/switch.png'
      div '.dot', vAttr:'style:dotTop(switch.brt,switch.idx)'
  methods:
    dotTop: (brt,idx) ->
      ofs = (if idx then 11 else 5.5)
      delta = (if idx then 4.4 else 4.65)
      'top:' + (ofs+(delta*Math.round((100-brt)/12.5))+(if brt then 0 else 0.5)) + '%'

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
        {brt:12.5, idx:2}
        {brt:25, idx:3}
        {brt:0, idx:0}
      ]
      [
        {brt:37.5, idx:4}
        {brt:50, idx:5}
        {brt:100, idx:6}
      ]
    ]

setTimeout ->  
  tvGlobal.ajaxCmd 'getLightLevels', (err, resp) ->
    vmPageComp = document.getElementById('page-comp').__vue__
    levels       = resp.data
    {switchRows} = vmPageComp.$data
    console.log 'getLightLevels', {levels, switchRows}
    for idx in [0..2]
      switchRows[0][idx] = levels[idx]
    for idx in [0..2]
      switchRows[1][idx] = levels[idx+3]
, 3000



