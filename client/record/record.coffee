
Vue    = require 'vue'
moment = require 'moment'
log    = require('../debug') 'rec'
{render, tag, div, img, input} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .net-btns {
    width: 100%;
    height: 45%;
    background-color: white;
    border-radius: 1rem;
    margin-top: 0.5rem;
  }
  .record-cbl {
    display: inline-block;
    width: 50%;
    color: red;
    font-size: 1.4rem;
    padding: 1rem 0 0 2rem;
  }
  .rec-input {
    width: 40%;
    font-size: 1.2rem;
  }
  .rec-input {
    width: 50%;
    font-size: 1.0rem;
    position: relative;
    right: 1rem;
    top: -.15rem;
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
  .recording > .rec-time {
    font-family: monospace;
    font-size: 0.95rem;
    display: inline-block;
    width: 70%;
    position: relative;
    top: -0.7rem;
    left: 0.5rem;
  }
"""

Vue.component 'record-comp', 
  name: 'record-comp'
  template: render ->
    div '.record-comp', ->
      div '.net-btns', ->
        div '.net-btns-hdr', ->
          div '.record-cbl', 'Record Cable'
          input '.rec-input', 
            vOn: 'keypress:chanKey'
            placeholder:'Optional Channel Number'
        div '.net-btns', ->
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
                  
        div '.rec-time', "{{{daysOfWeek[new Date(recording.start).getDay()] + " +
                            "', ' + " +
                            "new Date(recording.start).toLocaleDateString() + " +
                            "', ' + recording.duration + ' mins'}}}"
  data: ->
    recordings: [ {
       channel: 'abc'
       start: 1678769876
       duration: 120
      },{
       channel: 'cbs'
       start: 2678769876
       duration: 90
      },{
       channel: 'nbc'
       start: 3678769876
       duration: 90
      },{
       channel: 'fox'
       start: 4678769876
       duration: 90
      }
    ]
    daysOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    recTime: 100
    
  computed:
    recTime: ->
      log 'recording.start', @recording.start
      # dateStr = moment recording.start, 'MMM DDD, h:mm a'
      # log 'dateStr', dateStr
      @recording.start

  methods:
    createRecording: (chan) ->
      log 'createRecording', chan
      
    chanKey: (e) ->
      if e.which is 13
        channel = e.target.value
        if /^\d{3}$/.test channel
          e.target.blur()
          @createRecording +channel
      e.stopPropagation()
        
    btnClick: (e) ->
      @createRecording switch e.target.getAttribute('src')[15..17]
        when 'cbs' then 502 
        when 'nbc' then 504
        when 'abc' then 507
        when 'fox' then 511
      
log moment(1678769876).format('ddd M/DD/YY, h:mm a')