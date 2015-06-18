
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
  .show-info-tag {
    display: inline-block;
    font-size: .9rem;
    margin: 0 .5rem .2rem 0;
    background-color: #eee;
    border-radius: .5rem;
    padding: .2rem;
    height: 1rem;
    line-height: .7;
  }
"""

Vue.component 'show-info', 
  props: ['page-mode', 'cur-show', 'num-episodes', 'num-watched']
  template: render ->
    div '.show-info', vOn: 'click: infoClick', vKeepScroll: true, ->
      div '.show-info-inner', ->
        img '.thumb', vAttr: "src: '#{tvGlobal.plexPfx}' + curShow.thumb"
        div '.show-dtl.show-info-year', '{{curShow.year}}'
        div '.show-dtl.show-info-dur',  '({{Math.round(+curShow.duration/60000)}} mins)'
        div '.show-dtl.show-info-epis', '{{numWatched}}/{{numEpisodes}}'
        hr()
        div '.show-info-tag', vRepeat:'activeTags', '{{$value}}'
        hr()
        div '.summary', vText: 'curShow.summary'

  computed:
    activeTags: -> (tag for tag of @curShow.tags when @curShow.tags[tag])
      
  methods: 
    infoClick: -> 
      if @pageMode isnt 'tags'
        @$dispatch 'chgCurPage', 'episode'
      @$dispatch 'clrPageMode'
    
