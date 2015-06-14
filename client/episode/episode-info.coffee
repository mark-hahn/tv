
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:epiinf'
{render, tag, div, img, hr} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-info {
    width: 100%;
    position: relative;
    overflow-x: hidden;
    overflow-y: auto;
    font-size: 1rem;
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
    font-size: 0.9rem;
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
  props: ['show-title', 'cur-episode']
  
  template: render ->
    div '.episode-info', ->
      div '.episode-info-inner', ->
      # div '.episode-info-inner', vOn: 'click: epiInfoClick', ->
        div '.info-show-title',    '{{showTitle}}'
        hr()
        div '.info-episode-title', '{{curEpisode.title}}'
        img '.thumb',   vAttr: "src: '#{tvGlobal.plexPfx}' + curEpisode.thumb"
        div '.epi-info-aired',    '{{curEpisode.aired}}'
        div '.epi-info-duration', '({{Math.ceil(+curEpisode.duration/60000)}} min)'
        div '.epi-info-watched', vShow:'curEpisode.watched', 'Watched'
        hr()
        div '.summary', vText: 'curEpisode.summary'

  methods:
    epiInfoClick: (e) -> @$dispatch 'startVideo'
    