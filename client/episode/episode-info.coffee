
Vue     = require 'vue'
log     = require('../debug') 'epiinf'
{render, tag, div, img, hr} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-info {
    height: 35.5rem;
    width: 100%;
    position: relative;
    overflow-x: hidden;
    overflow-y: auto;
    font-size: 1rem;
  }
  .episode-info-msg {
    text-align: center;
    font-size: 1.9rem;
    position: absolute;
    width: 100%;
    top:10rem;
  }
  .episode-info-inner {
    width: 100%;
    padding: 0.1rem;
  }
  .episode-info .info-show-title, 
  .episode-info .info-episode-title {
    text-align: center;
    width: 100%;
  }
  .episode-info .info-show-title  {
    background-color: #eee;
    border-radius: 0.4rem;
    font-size: 1.2rem;
  }
  .episode-info .info-episode-title {
    position: relative;
    top: -0.25rem;
  }
  .thumb {
    width: 100%;
    border: 1px solid #eee;
  }
  .epi-info-aired, .epi-info-duration, .epi-info-watched {
    padding-right: 0.3rem;
    font-size: 0.8rem;
    display: inline-block;
  }
  .epi-info-watched {
    color: #e33;
    float: right;
  }
  .summary {
    width: 100%;
    font-size: 0.8rem;
  }
"""

Vue.component 'episode-info', 
  props: ['showTitle', 'curEpisode', 'playPos', 'watchScreen']
  
  template: render ->
    div '.episode-info', vKeepScroll: true, vOn: 'click: epiInfoClick', ->
      div '.episode-info-msg', vShow:'showMsg', 'No Show Playing'
      div '.episode-info-inner', vShow:'!showMsg', ->
        div '.info-show-title',    '{{showTitle}}'
        hr()
        div '.info-episode-title', '{{curEpisode.title}}'
        img '.thumb',   vAttr: "src: '#{tvGlobal.bannerPfx}' + curEpisode.thumb"
        div '.epi-info-aired',    '{{curEpisode.aired}}'
        div '.epi-info-duration', '({{Math.ceil(+curEpisode.duration/60)}} min)'
        div '.epi-info-watched', vShow:'!playPos && curEpisode.watched', 'Watched'
        hr()
        div '.summary', vText: 'curEpisode.summary'

  data: ->
    showMsg: yes
    
  watch:
    curEpisode: -> @showMsg = @watchScreen and not @curEpisode?
    
  methods:
    epiInfoClick: (e) -> 
      if not @watchScreen or @showMsg
        @$dispatch 'chgCurPage', 'show'
      else
        @$dispatch 'tvBtnClick', '> ||'
