
Vue     = require 'vue'
log     = require('../debug') 'epilft'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-left-comp {
    margin-right:2%;
    display: inline-block;
    width: 49%;
  }
"""

require './episode-info'
require '../two-btns'

Vue.component 'episode-left', 
  props: ['showTitle', 'curEpisode']
  
  template: render ->
    div  '.episode-left-comp',  ->
      tag 'episode-info',
        showTitle:   '{{showTitle}}'
        curEpisode:  '{{curEpisode}}'
        playPos:      0
        watchScreen:  'false'
        
      tag 'two-btns',
        lftBtnTxt: 'Play'
        rgtBtnTxt: 'Watched'

