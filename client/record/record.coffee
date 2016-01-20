
Vue    = require 'vue'
moment = require 'moment'
log    = require('../debug') 'rec'
{render, tag, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .net-btns {
    width: 100%;
    height: 45%;
    background-color: white;
    border-radius: 1rem;
    margin-top: 0.5rem;
  }
  .net-btns-hdr {
    color: red;
    font-size: 1.4rem;
    text-align: center;
    padding-top: 1rem;
  }
  .net-btn {
    height: 6rem;
    margin: .6rem;
    position: relative;
    left: 2rem;
  }
  .net-btn.fox {
    top:-0.6rem;
  }
  .rec-list {
    overflow: auto;
    width:100%;
    height:50%;
  }
  .recording {
    background-color: white;
    border: .1rem solid gray;
    margin: 1rem;
    padding: 0.55rem 0 0 0.5rem;
    font-size: 1.2rem;
  }
  .chan-div {
    display: inline-block;
    width:22%;
  }
  .chan-img {
    height: 2rem;
  }
  .chan-img.chan-pad {
    position:relative;
    left:1rem;
  }
  .chan-img.fox-pad {
    position:relative;
    left: 0.5rem;
    top: -.2rem;
  }
  .recording > .start-time {
    display: inline-block;
    width: 48%;
    position: relative;
    top: -0.7rem;
  }
  .recording > .duration {
      display: inline-block;
      width: 30%;
      position: relative;
      top: -0.7rem;
  }
"""

Vue.component 'record-comp', 
  name: 'record-comp'
  template: render ->
    div '.record-comp', ->
      div '.net-btns', ->
        div '.net-btns-hdr', 'Record Network Channel'
        img '.net-btn',     vOn:"click:btnClick", src:'/server/images/abc.png'
        img '.net-btn',     vOn:"click:btnClick", src:'/server/images/cbs.png'
        img '.net-btn',     vOn:"click:btnClick", src:'/server/images/nbc.png'
        img '.net-btn.fox', vOn:"click:btnClick", src:'/server/images/fox.png'
    div '.rec-list', ->
      div '.recording', vRepeat:'recording:recordings' , ->
        div '.chan-div', ->
          img '.chan-img', 
            src:"/server/images/{{recording.channel}}.png"
            vClass:'chan-pad: recording.channel != "cbs", ' +
                    'fox-pad: recording.channel == "fox"' 
                  
        div '.start-time', '{{startDate}}'
        div '.duration',   '({{recording.duration}} mins)'
        
  data: ->
    recordings: [ {
       channel: 'abc'
       start: new Date().getTime()
       duration: 90
      },{
       channel: 'cbs'
       start: new Date().getTime()
       duration: 90
      },{
       channel: 'nbc'
       start: new Date().getTime()
       duration: 90
      },{
       channel: 'fox'
       start: new Date().getTime()
       duration: 90
      }
    ]
    
  computed:
    startDate: -> @recording.start # moment @recording.start, 'MMM DDD, h:mm a'

  methods:
    btnClick: (e) ->
      net = e.target.getAttribute('src')[15..17]
      
      
