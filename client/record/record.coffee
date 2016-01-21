
util    = require 'util'
Vue     = require 'vue'
moment  = require 'moment'
Pikaday = require 'pikaday'
log     = require('../debug') 'rec'

require './record-css'
require './pikadate-css'

{render, tag, div, img, input, select, option, label, text, button, hr} = 
  require 'teacup'
  
Vue.component 'recording-tile', 
  props: ['recording']
  name: 'recording-tile-comp'
  template: render ->
    div '.recording-tile-div', ->
      div '.chan-div', ->
        div '.chan-num', vShow:'!isImg(recording.channel)', "{{recording.channel}}"
        img '.chan-img', 
          vShow: 'isImg(recording.channel)'
          src:"/server/images/{{recording.channel}}.png"
          vClass:'chan-pad: recording.channel != 502, ' +
                  'fox-pad: recording.channel == 511' 
      div '.rec-time', "{{{dateStr(recording.start,recording.duration)}}}"

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
          img '.net-btn',     vOn:"click:netClick", src:'/client/record/images/507.png'
          img '.net-btn',     vOn:"click:netClick", src:'/client/record/images/502.png'
          img '.net-btn',     vOn:"click:netClick", src:'/client/record/images/504.png'
          img '.net-btn.fox', vOn:"click:netClick", src:'/client/record/images/511.png'
      div '.rec-list', ->
        div '.recording', vRepeat:'recording:recordings' , ->
          tag 'recording-tile', recording: '{{recording}}'

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
          option ':00'; option ':30'
        select '.ampm-sel.time-sel', ->
          option 'AM'; option 'PM'
      div ->  
        div '.time-sel-lbl', 'Duration Hours, Mins:'
        select '.duration-sel.time-sel', ->
          option '0:30'; option '1:00'; option '1:30'; option '2:00'; 
          option '2:30'; option '3:00'; option '3:30'; option '4:00'; 
          option '4:30'; option '5:00'; option '5:30'; option '6:00'; 
      hr()
      div 'rec-popup-btns', ->
        button '.rec-btn', vOn:'click:delButton', 'Delete'
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
    
    nowButton: (e) -> @picker.setMoment moment()
    
    delButton: ->
      
    setTimeInForm: (time, dur) ->
      
    getTimeFromForm: ->
      daysMs = @picker.getDate().getTime()
      hrs = +(document.querySelector '.hr-sel').value
      mins = +((document.querySelector '.min-sel').value[1...])
      ampm = document.querySelector('.ampm-sel').value
      if hrs is 12 then hrs = 0
      if ampm is 'PM' then hrs += 12
      dateMs = daysMs + (hrs * 60 + mins) * 60 * 1e3
      dur = document.querySelector '.duration-sel'
      [hr, min] = dur.value.split ':'
      durMs = (+hr * 60 + +min) * 60 * 1e3
      [dateMs, durMs]
       
    saveButton: (e) ->
      [time, dur] = @getTimeFromForm()
      log new Date(time), '\n', dur
      
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
      
      onSelect: (date) -> 
        log date
      
