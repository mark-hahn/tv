
Vue     = require 'vue'
log     = require('debug') 'tv:epilft'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .episode-info {
    width: 100%;
    height: 35.5rem;
  }
"""

require './episode-info'
require '../two-btns'

Vue.component 'episode-left', 
  props: ['cur-episode', 'two-btn-clk']
  
  template: render ->
    tag 'episode-info', '.episode-info', curEpisode: '{{curEpisode}}'
      
    tag 'two-btns', '.two-btns',  
      lftBtnTxt: 'left'
      rgtBtnTxt: 'right'
      twoBtnClk: '{{twoBtnClk}}'

