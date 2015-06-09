
Vue = require 'vue'
log = require('debug') 'tv:lts'
{render, div, img} = require 'teacup'

### single light switch component ####
(document.head.appendChild document.createElement('style')).textContent = """
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
  .fun {
    display: inline-block;  
  }
"""
Vue.component 'light-sw-comp', 
  paramAttributes: ['switch']

  name: 'light-sw-comp'
  template: render ->
    div '.switch', 
      vClass:'master:!switch.idx', 
      vOn:'mousedown:onMousedown, touchstart:onMousedown' , ->
        img src:'server/images/switch.png'
        div '.dot', vAttr:'style:dotTop(switch.brt,switch.idx)'
  methods:
    dotTop: (brt,idx) ->
      ofs = (if idx then 11 else 5.5)
      delta = (if idx then 4.4 else 4.65)
      'top:' + (ofs+(delta*Math.round((100-brt)/12.5))+(if brt then 0 else 0.5)) + '%'
    
    setBrt: (brtIn) ->
      idx = @switch.idx
      brt = if typeof brtIn is 'boolean' then (if brtIn then 100 else 0) else brtIn
      {switchRows} = @$parent.$parent.$data
      if brt is 0 or brt is 100 
        @stopMouseAction()
        cmd = [null, (if brt then 'turnOnFast' else 'turnOffFast')]
      else
        cmd = [null, 'level', brt]
      tvGlobal.lightChanging = yes
      for i in (if idx then [idx] else [0,1,2,3,4,5,6])
        cmd[0] = i
        tvGlobal.ajaxCmd 'lightCmd', cmd...
      setTimeout (-> tvGlobal.lightChanging = no), 7000
      for i in (if idx then [idx] else [0,1,2,3,4,5,6])
        if i is 0 then switchRows[0][3].brt = brt
        else
          if i <= 3 then switchRows[0][i-1].brt = brt
          else           switchRows[1][i-4].brt = brt

    getBrt: ->
      idx = @switch.idx
      {switchRows} = @$parent.$parent.$data
      if idx is 0 then switchRows[0][3].brt
      else
        if idx <= 3 then switchRows[0][idx-1].brt
        else             switchRows[1][idx-4].brt
      
    stopMouseAction: ->
      if @mouseInterval then clearInterval @mouseInterval
      @mouseInterval = @mouseDownAt = null

    onMousedown: (e) ->
      if @mouseDownAt then return
      @mouseDownAt = Date.now()
      e.preventDefault()
      el = @$el
      {top} = el.getBoundingClientRect()
      @pressTop = (((e.changedTouches?[0] ? e).pageY - top)/el.clientHeight < 0.5)
      lightIdx = @switch.idx
      brt = @getBrt()
      bumpBrt = =>
        brt = brt + (if @pressTop then 12.5 else -12.5)
        @setBrt (brt = Math.max 0, Math.min 100, brt)
      if @mouseInterval then clearInterval @mouseInterval
      @mouseInterval = setInterval bumpBrt, 500
        
    globalMouseUp: (e) ->
      if not @mouseDownAt then return
      duration = Date.now() - @mouseDownAt
      @stopMouseAction()
      if duration < 200 then @setBrt @pressTop
    
#### lights page component ####      
(document.head.appendChild document.createElement('style')).textContent = """
  .sw-row {
    position:relative;
    width:100%;
    height:20%;
  }
"""

Vue.component 'lights-comp', 
  name: 'lights-comp'
  template: render ->
    div '.sw-row', vRepeat:'switchRow:switchRows' , ->
      div '.switch-comp', vComponent:'light-sw-comp', vRepeat:'switch:switchRow'
    div '.fun.btn', vOn: 'click:fun', 'fun'
        
  data: ->
    switchRows: [
      [ {brt:0, idx:1}, {brt:0, idx:2}, {brt:0, idx:3}, {brt:0, idx:0} ]
      [ {brt:0, idx:4}, {brt:0, idx:5}, {brt:0, idx:6} ]
    ]
  methods:
    fun: ->
      if @funning
        clearInterval @funning
        @funning = null
        log 'not funning'
        return
      log 'funning'
      seq = [1,6,4,3,5,2]
      idxOn  = -1
      do fun = ->
        idxOn = (idxOn + 1) % 6
        tvGlobal.ajaxCmd 'lightCmd', seq[idxOn], 'turnOn'
        idxOff = (idxOn + 3) % 6
        tvGlobal.ajaxCmd 'lightCmd', seq[idxOff], 'turnOff'
      @funning = setInterval fun, 1000

#### keep lights on screen synced with real lights ####
# setTimeout one = ->  
#   if tvGlobal.lightChanging or 
#      not (pageCompEle = document.getElementById 'page-comp')
#        setTimeout one, 500; return
#   tvGlobal.ajaxCmd 'getLightLevels', (err, resp) ->
#     if resp and not tvGlobal.lightChanging and pageCompEle.__vue__
#       levels = resp.data
#       rows = pageCompEle.__vue__.$data.switchRows
#       for idx in [0..2] then rows[0][idx].brt = levels[idx]
#       for idx in [0..2] then rows[1][idx].brt = levels[idx+3]
#       sum = 0; for idx in [0..5] then sum += levels[idx]
#       switchRows[0][3].brt = sum/6
#     one()
# , 100
# 
#### detect mouse up event anywhere ####
document.onmouseup = document.ondragend = document.ontouchend = (e) ->
  for sw in document.querySelectorAll '.switch-comp'
    sw.__vue__.globalMouseUp e
    
    