
Vue = require 'vue'
log = require('debug') 'tv:--scrub'

{render, div, text} = require 'teacup'

scrubStyle = document.createElement 'style'
(document.head.appendChild scrubStyle).textContent = """
  .scrub {
    width:100%;
    height: 100%;
    overflow: hidden;
    border: 1px solid green;
    background-color: #eee;
  }
  .mark {
    border-bottom: 1px solid gray;
  }
  .mark.five-min { width: 50% }
  .mark.min      { width: 25% }
  .mark.five-min .time { 
    text-align: right;
    font-size: 1rem;
    position: relative;
    top: -1.2rem;
  }
  .cursor {
    position:absolute;
    left:0;
    width: 100%;
    height: 2px;
    background-color: red;
  }
"""

Vue.component 'scrub-comp',
  props: ['play-pos', 'episode-len']
  
  template: render ->
    div '.scrub', vOn: 'mousedown: onMouse', vIf: 'episodeLen !== null', ->
      div '.mark.five-min', vRepeat: '100', ->
        div '.mark.min', vRepeat: '5'
        div '.time', '{{($index+1)*5}}'
      div '.cursor'

  methods:
    setCursorPixPos: ->
      if @scrubEle
        @cursor ?= @scrubEle.querySelector '.cursor'
        @cursor.style.top = (@scrubHgt * @playPos/@episodeLen - 2) + 'px'
      
    pixPos2PlayPos: (y) ->
      @playPos = (@episodeLen / @scrubHgt) * y
      # log 'pixPos2PlayPos', {y, @scrubTop, @scrubHgt, @playPos, @episodeLen}
    
    onMouse: (e) ->
      # if @dragging then return
      @dragging = yes
      initY = e.offsetY + e.target.offsetTop
      log 'inity', initY, e.offsetY, e.target.offsetTop
      @pixPos2PlayPos initY
      @setCursorPixPos()
      
  watch:
    playPos:    -> @setCursorPixPos()
    episodeLen: -> @setCursorPixPos()
    
  events:
    resize: ->
      do trySizing = =>
        @scrubEle ?= @$el.querySelector '.scrub'
        if @episodeLen is 0 or not @scrubEle then setTimeout trySizing, 200; return
        @scrubHgt = @scrubEle.clientHeight
        log '@scrubEle.clientHeight', @scrubEle.clientHeight
        for min5 in @scrubEle.querySelectorAll '.mark.five-min'
          min5.style.height =  (@scrubHgt * 300  /  @episodeLen) + 'px'
        for min1 in @scrubEle.querySelectorAll '.mark.min'
          min1.style.height =  (@scrubHgt * 60  /  @episodeLen) + 'px'
        @setCursorPixPos()
