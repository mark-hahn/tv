
Vue     = require 'vue'
log     = require('debug') 'tv:slf'

{render, tag, div} = require 'teacup'

require './episode-list'
require '../two-btns'

Vue.component 'episode-right', 
  props: ['curShow', 'curEpisodeIdx', 'twoBtnClk']
  
  template: render ->
    tag 'episode-list', '.episode-list-comp', 
      curShow:       '{{curShow}}'
      allEpisodes:   '{{curShow.episodes}}'
      curEpisodeIdx: '{{curEpisodeIdx}}'
      
    tag 'two-btns', '.two-btns',  
      lftBtnTxt:  'Up' 
      rgtBtnTxt:  'Down' 
      twoBtnClk:  'twoBtnClk'
    
