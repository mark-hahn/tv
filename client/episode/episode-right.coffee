
Vue     = require 'vue'
log     = require('debug') 'tv:epirgt'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-right-comp {
    display: inline-block;
    width: 49%;
  }
"""

require './episode-list'
require '../two-btns'

Vue.component 'episode-right', 
  props: ['curShow', 'curEpisodeIdx', 'twoBtnClk']
  
  template: render ->
    div '.episode-right-comp', ->
      tag 'episode-list',
        curShow:       '{{curShow}}'
        allEpisodes:   '{{curShow.episodes}}'
        curEpisodeIdx: '{{curEpisodeIdx}}'
        
      tag 'two-btns',
        lftBtnTxt:  'Up' 
        rgtBtnTxt:  'Down' 
        twoBtnClk:  'twoBtnClk'
    
