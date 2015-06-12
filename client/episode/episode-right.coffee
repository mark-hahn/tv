
Vue     = require 'vue'
log     = require('debug') 'tv:slf'

{render, tag, div} = require 'teacup'

require './episode-list'
require '../two-btns'

Vue.component 'episode-right', 
  props: ['cur-show', 'cur-episode-idx', 'two-btn-clk']
  
  template: render ->
    tag 'episode-list', '.episode-list-comp', 
      curShow:       '{{curShow}}'
      allEpisodes:   '{{curShow.episodes}}'
      curEpisodeIdx: '{{curEpisodeIdx}}'
      
    tag 'two-btns', '.two-btns',  
      lftBtnTxt:  '--' 
      rgtBtnTxt:  '--' 
      twoBtnClk:  '{{twoBtnClk}}'
    
