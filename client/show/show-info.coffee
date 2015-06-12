
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:shwinf'

{render, tag, div, img, hr} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-info {
    width: 100%;
    position: relative;
    overflow: auto;
  }
  .show-info-inner {
    width: 100%;
    padding: 0.1rem;
  }
  .thumb {
    width: 100%;
    border: 1px solid gray;
  }
  .summary {
    width: 100%;
    font-size: 0.8rem;
  }
  .show-dtl {
    font-size: 1rem;
    display: inline-block;
    padding-right: 0.3rem;
    position: relative;
    top: .15rem;
  }
  .show-dtl.show-info-epis {
    float:right;
    padding: none;
  }
"""

Vue.component 'show-info', 
  props: ['cur-show']
  template: render ->
    div '.show-info', vOn: 'click: infoClick', ->
      div '.show-info-inner', ->
        img '.thumb', vAttr: "src: '#{tvGlobal.plexPfx}' + curShow.thumb"
        div '.show-dtl.show-info-year', '{{curShow.year}}'
        div '.show-dtl.show-info-dur',  '({{Math.round(+curShow.duration/60000)}} mins)'
        div '.show-dtl.show-info-epis', '{{curShow.numWatched}}/{{curShow.numEpisodes}}'
        hr()
        div '.summary', vText: 'curShow.summary'

  methods:
    infoClick: -> @$dispatch 'chgCurPage', 'episode'
      
      
