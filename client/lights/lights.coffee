
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
    left:3px;
    background-color:#2e2;
    width:5px;
    height:5px;
    border-radius:3px;
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
      ofs = (if idx then 14 else 6)
      'top:' + (ofs+(5.6*Math.round((100-brt)/12.5))+(if brt then 0 else 1)) + 'px'

Vue.component 'lights-comp', 
  name: 'lights-comp'
  template: render ->
    div '.sw-row', 
      vRepeat:'switchRow:switchRows'
    , ->
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
  tvGlobal.vmBody.ajaxCmd 'getAllLights', (err, res) ->
    console.log 'getAllLights', {err, res}
, 200
