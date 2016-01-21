
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
    width: 20%;
    position: relative;
    height: 1.7rem;
  }
  .chan-num {
    position: absolute;
    top: 0;
    left: 1.2rem;
    display: inline-block;
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
    width: 80%;
    position: relative;
    left: 0.35rem;
    top: -0.7rem;
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
          img '.net-btn',     vOn:"click:btnClick", src:'/server/images/507.png'
          img '.net-btn',     vOn:"click:btnClick", src:'/server/images/502.png'
          img '.net-btn',     vOn:"click:btnClick", src:'/server/images/504.png'
          img '.net-btn.fox', vOn:"click:btnClick", src:'/server/images/511.png'
    div '.rec-list', ->
      div '.recording', vRepeat:'recording:recordings' , ->
        div '.chan-div', ->
          div '.chan-num', vShow:'!isImg(recording.channel)', "{{recording.channel}}"
          img '.chan-img', 
            vShow: 'isImg(recording.channel)'
            src:"/server/images/{{recording.channel}}.png"
            vClass:'chan-pad: recording.channel != 502, ' +
                    'fox-pad: recording.channel == 511' 
                  
        div '.rec-time', "{{{dateStr(recording.start,recording.duration)}}}"
  data: ->
    recordings: [ {
       channel: 570
       start: 121678769876
       duration: 120
      },{
       channel: 502
       start: 232678769876
       duration: 90
      },{
       channel: 504
       start: 343678769876
       duration: 90
      },{
       channel: 511
       start: 454678769876
       duration: 90
      }
    ]
    
  methods:
    isImg: (chan) -> chan in [502, 504, 507, 511]
      
    dateStr: (ms, dur) ->
      daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      date = new Date ms
      [mo, da, yr] = date.toLocaleDateString().split '/'
      if mo.length < 2 then mo = '&nbsp;' + mo
      if da.length < 2 then da = '0' + da
      dmyStr = "#{mo}/#{da}/#{yr[2...]}"
      hrs = date.getHours()
      ampm = 'am'
      if hrs > 12 then hrs -= 12; ampm = 'pm'
      if hrs is 0 then hrs = 12
      hrs = '' + hrs
      if hrs.length < 2 then hrs = '&nbsp;' + hrs
      mins = '' + date.getMinutes()
      if mins.length < 2 then mins = '0' + mins
      dur = '' + dur
      if dur.length < 3 then dur = '&nbsp;' + dur
      "#{daysOfWeek[date.getDay()]} " +
        "#{dmyStr} " +
        "#{hrs}:#{mins} #{ampm} " +
        "(#{dur})"
        
    createRecording: (chan) ->
      log 'createRecording', chan
      
    chanKey: (e) ->
      if e.which is 13
        channel = e.target.value
        if /^\d{3}$/.test channel
          # e.target.blur()
          @createRecording +channel
      e.stopPropagation()
        
    btnClick: (e) -> @createRecording +e.target.getAttribute('src')[15..17]
      