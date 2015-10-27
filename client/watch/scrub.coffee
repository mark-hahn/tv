
Vue = require 'vue'
log = require('debug') 'tv:--scrub'

{render, div, text} = require 'teacup'

scrubStyle = document.createElement 'style'
(document.head.appendChild scrubStyle).textContent = """
  .scrub-comp {
    display: inline-block;
    position:relative;
    width: 15%;
    height: 35.5rem;  
  }
  .scrub {
    width:100%;
    height: 100%;
    overflow: hidden;
    margin-left: 5px;
    border-left: 2px solid green;
    cursor: default;
  }
  .tick {
    border-bottom: 1px solid gray;
  }
  .tick.five-min { width: 50% }
  .tick.min      { width: 25% }
  .tick.five-min .time { 
    text-align: right;
    font-size: 1rem;
    position: relative;
    top: -1.2rem;
  }
  .cursor {
    position:absolute;
    left:0;
    width: 27%;
    height: 2px;
    background-color: red;
  }
"""

Vue.component 'scrub-comp',
  props: ['episode']
  
  template: render ->
    div '.scrub-comp', ->
      div '.scrub', ->
        div '.tick.five-min', vRepeat: '100', ->
          div '.tick.min', vRepeat: '5'
          div '.time', '{{($index+1)*5}}'
        div '.cursor'

  attached: ->
    @$emit 'resize'
  
  events:
    setScrubPos: (playPos) ->
      if @episode
        @cursor ?= @$el.querySelector '.cursor'
        @cursor.style.top = (@scrubHgt * playPos/@episode.episodeLen - 2) + 'px'

    resize: ->
      do trySizing = =>
        @scrubEle ?= @$el.querySelector '.scrub'
        if not @episode  or @episode.episodeLen    is 0 or 
           not @scrubEle or @scrubEle.clientHeight is 0
          setTimeout trySizing, 200; return
        @scrubHgt = @scrubEle.clientHeight
        for min5 in @scrubEle.querySelectorAll '.tick.five-min'
          min5.style.height =  (@scrubHgt * 300  /  @episode.episodeLen) + 'px'
        for min1 in @scrubEle.querySelectorAll '.tick.min'
          min1.style.height =  (@scrubHgt * 60  /  @episode.episodeLen) + 'px'
