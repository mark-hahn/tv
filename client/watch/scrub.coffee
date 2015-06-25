
Vue = require 'vue'
log = require('debug') 'tv:--scrub'

{render, div, text} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .scrub {
    width: 15%;
    height: 35.5rem;
    display: inline-block;
    overflow: hidden;
    border: 1px solid green;
    position: relative;
    background-color: #eee;
  }
  .mark {
    text-align: right;
    font-size: .75rem;
    border-bottom: 2px solid gray;
  }
  .mark.hr       { width: 80%; height: 360px }
  .mark.hlf-hr   { width: 65%; height: 180px }
  .mark.ten-min  { width: 65%; height:  60px }
  .mark.five-min { width: 65%; height:  30px }
  .mark.min      { width: 50%; height:   6px }
"""

Vue.component 'scrub-comp',
  props: ['tv-pos']
  
  template: render ->
    div '.scrub', ->
      div '.hr.mark',    vRepeat: '10', ->
        div '.hlf-hr.mark', vRepeat: '2', ->
          div '.ten-min.mark', vRepeat: '3', ->
            div '.five-min.mark', vRepeat: '2', ->
              div '.min.mark',      vRepeat: '5'
              div vIf: '$index%2 < 1', 
                '{{$parent.$parent.$parent.$index*60+' +
                  '$parent.$parent.$index*30+($parent.$index)*10+($index+1)*5}}'
            div vIf: '$index%3 < 2', 
              '{{$parent.$parent.$index*60+($parent.$index)*30+($index+1)*10}}'
          div vIf: '$index%2 < 1', '{{$parent.$index*60+($index+1)*30}}'
        div '{{($index+1)*60}}'
  