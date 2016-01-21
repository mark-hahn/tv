
util    = require 'util'
Vue     = require 'vue'
moment  = require 'moment'
Pikaday = require 'pikaday'
log     = require('../debug') 'rec'

{render, tag, div, img, input, select, option, label, text, button, hr} = 
  require 'teacup'

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
  .popup-show {
    font-size: 1.3rem;
    width: 100%;
    border-radius: 0.5rem;
    border: 1px solid gray;
    background-color: white;
  }
  .popup-hdr {
    font-size: 1.4rem;
    color: red;
    margin: 0.7rem 1rem 0 1rem;
    display: inline-block;
  }
  .now-btn {
    font-size: 1.05rem;
    border-radius: 0.5rem;
    margin-left: 23%;
  }
  .rec-btn {
    font-size: 1.3rem;
    border-radius: 0.5rem;
    margin: 0.5rem 4.3rem 1.5rem 1rem;
  }
  .picker-input-div {
    display:none;
    font-size:1.3rem;
  }
  .date-picker {
    margin-top: 1rem;
  }
  .picker-input-lbl {
    margin: 1rem 0.5rem 0.5rem 1rem;
  }
  .time-sel-lbl {
    display: inline-block;
    font-size:1.3rem;
    margin: 1rem 0.5rem 0.5rem 1rem;
  }
  .time-sel {
    margin-left: 0.5rem;
    font-size: 1.1rem;
  }
  
/* *********** PIKA ************* */
  .pika-single {
      z-index: 9999;
      display: block;
      position: relative;
      color: #333;
      background: #fff;
      border: 1px solid #ccc;
      border-bottom-color: #bbb;
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  .pika-single:before,
  .pika-single:after {
      content: " ";
      display: table;
  }
  .pika-single:after { clear: both }
  .pika-single { *zoom: 1 }

  .pika-single.is-hidden {
      display: none;
  }
  .pika-single.is-bound {
      position: absolute;
      box-shadow: 0 5px 15px -5px rgba(0,0,0,.5);
  }
  .pika-lendar {
      float: left;
      width: 94%;
      margin: 8px;
  }
  .pika-title {
      position: relative;
      text-align: center;
  }
  .pika-label {
      display: inline-block;
      *display: inline;
      position: relative;
      z-index: 9999;
      overflow: hidden;
      margin: 0;
      padding: 5px 3px;
      font-size: 1.2rem;
      line-height: 20px;
      font-weight: bold;
      background-color: #fff;
  }
  .pika-title select {
      cursor: pointer;
      position: absolute;
      z-index: 9998;
      margin: 0;
      left: 0;
      top: 5px;
      filter: alpha(opacity=0);
      opacity: 0;
  }
  .pika-prev,
  .pika-next {
      display: block;
      cursor: pointer;
      position: relative;
      outline: none;
      border: 0;
      padding: 0;
      width: 20px;
      height: 30px;
      /* hide text using text-indent trick, using width value (it's enough) */
      text-indent: 20px;
      white-space: nowrap;
      overflow: hidden;
      background-color: transparent;
      background-position: center center;
      background-repeat: no-repeat;
      background-size: 75% 75%;
      opacity: .5;
      *position: absolute;
      *top: 0;
  }
  .pika-prev,
  .is-rtl .pika-next {
      float: left;
      background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAeCAYAAAAsEj5rAAAAUklEQVR42u3VMQoAIBADQf8Pgj+OD9hG2CtONJB2ymQkKe0HbwAP0xucDiQWARITIDEBEnMgMQ8S8+AqBIl6kKgHiXqQqAeJepBo/z38J/U0uAHlaBkBl9I4GwAAAABJRU5ErkJggg==');
      *left: 0;
  }
  .pika-next,
  .is-rtl .pika-prev {
      float: right;
      background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABQAAAAeCAYAAAAsEj5rAAAAU0lEQVR42u3VOwoAMAgE0dwfAnNjU26bYkBCFGwfiL9VVWoO+BJ4Gf3gtsEKKoFBNTCoCAYVwaAiGNQGMUHMkjGbgjk2mIONuXo0nC8XnCf1JXgArVIZAQh5TKYAAAAASUVORK5CYII=');
      *right: 0;
  }
  .pika-prev.is-disabled,
  .pika-next.is-disabled {
      cursor: default;
      opacity: .2;
  }
  .pika-select {
      display: inline-block;
      *display: inline;
  }
  .pika-table {
      width: 100%;
      border-collapse: collapse;
      border-spacing: 0;
      border: 0;
  }
  .pika-table th,
  .pika-table td {
      width: 14.285714285714286%;
      padding: 0.1rem;
      border: 1px solid #eee;
      font-size: 1.1rem;
  }
  .pika-table th {
      font-size: 1.2rem;
      line-height: 25px;
      font-weight: bold;
      text-align: center;
  }
  .pika-button {
      cursor: pointer;
      display: block;
      box-sizing: border-box;
      -moz-box-sizing: border-box;
      outline: none;
      border: 0;
      margin: 0;
      width: 100%;
      padding: 0.1rem;
      color: #444;
      font-size: 1.1rem;
      text-align: center;
      background: #f5f5f5;
      height:2rem;
  }
  .pika-week {
      font-size: 11px;
      color: #999;
  }
  .is-today .pika-button {
      color: #33aaff;
      font-weight: bold;
  }
  .is-selected .pika-button {
      color: #fff;
      font-weight: bold;
      background: #33aaff;
      box-shadow: inset 0 1px 3px #178fe5;
      border-radius: 3px;
  }
  .is-inrange .pika-button {
      background: #D5E9F7;
  }
  .is-startrange .pika-button {
      color: #fff;
      background: #6CB31D;
      box-shadow: none;
      border-radius: 3px;
  }
  .is-endrange .pika-button {
      color: #fff;
      background: #33aaff;
      box-shadow: none;
      border-radius: 3px;
  }
  .is-disabled .pika-button,
  .is-outside-current-month .pika-button {
      pointer-events: none;
      cursor: default;
      color: #999;
      opacity: .3;
  }
  .pika-table abbr {
      border-bottom: none;
      cursor: default;
  }
"""

Vue.component 'record-comp', 
  name: 'record-comp'
  template: render ->
    div vShow:"!popupShowing", ->
      div '.net-btns', ->
        div '.net-btns-hdr', ->
          div '.record-cbl', 'Record Cable'
          input '.rec-input', 
            vOn: 'keypress:chanKey'
            placeholder:'Optional Channel Number'
        div '.net-btns', ->
          img '.net-btn',     vOn:"click:netClick", src:'/server/images/507.png'
          img '.net-btn',     vOn:"click:netClick", src:'/server/images/502.png'
          img '.net-btn',     vOn:"click:netClick", src:'/server/images/504.png'
          img '.net-btn.fox', vOn:"click:netClick", src:'/server/images/511.png'
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

    div '.popup-show', vShow:"popupShowing", ->
      div '.popup-hdr', 'Recording Details ...'
      button '.now-btn', vOn:'click:nowButton', 'Now'
      div '.picker-input-div', ->
        label '.picker-input-lbl', for:"datepicker", 'Date: '
        input type:"text", id:"datepicker"
      div '.date-picker'
      div ->
        div '.time-sel-lbl', 'Start Time: '
        select '.hr-sel.time-sel', ->
          option '1'; option  '2'; option  '3'; option  '4'; 
          option '5'; option  '6'; option  '7'; option  '8'; 
          option '9'; option '10'; option '11'; option '12'
        select '.min-sel.time-sel', ->
          option ':00'; option ':15'; option ':30'; option ':45'
        select '.ampm-sel.time-sel', ->
          option 'AM'; option 'PM'
      div ->  
        div '.time-sel-lbl', 'Duration Hours, Mins:'
        select '.duration-sel.time-sel', ->
          option '0:30'; option  '1:00'; option  '1:30'; option  '2:00'; 
          option '2:30'; option  '3:00'; option  '3:30'; option  '4:00'; 
          option '4:30'; option  '5:00'; option  '5:30'; option  '6:00'; 
      hr()
      div 'rec-popup-btns', ->
        button '.rec-btn', vOn:'click:delButton', 'Cancel/Delete'
        button '.rec-btn', vOn:'click:saveButton', 'Save'
        
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
    popupShowing: yes
    
  methods:
    isImg: (chan) -> chan in [502, 504, 507, 511]
    
    dateStr: (ms, dur) ->
      dayArr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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
      "#{dayArr[date.getDay()]} " +
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
        
    netClick: (e) -> @createRecording +e.target.getAttribute('src')[15..17]
    
    nowButton: (e) -> @picker.gotoToday()
      
  attached: ->
    @picker = new Pikaday
      field: document.getElementById "datepicker"
      defaultDate: new Date()
      setDefaultDate: yes
      minDate: new Date(2016, 0, 1)
      maxDate: new Date(2020, 12, 31)
      yearRange: [ 2016, 2020 ]
      bound: false
      showDaysInNextAndPreviousMonths: yes
      container: document.querySelector '.date-picker'
      onSelect: (date) -> log date
      
    # pickInput = document.querySelector '.picker-input'
    # pickInput.value = moment().format('YYYY-MM-DD')
    
    
    
    