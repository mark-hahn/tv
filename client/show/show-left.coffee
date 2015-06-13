
Vue     = require 'vue'
log     = require('debug') 'tv:shwlft'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-info {
    width: 100%;
    height: 35.5rem;
  }
"""

require './show-info'
require '../two-btns'

Vue.component 'show-left', 
  props: ['page-mode', 'cur-show', 'two-btn-clk']
  
  template: render ->
    tag 'show-info', '.show-info', 
      curShow:     '{{curShow}}'
      numEpisodes: '{{numEpisodes}}'
      numWatched:  '{{numWatched}}'
      
    tag 'two-btns', '.two-btns',  
      lftBtnTxt: '{{lftBtnTxt}}'
      rgtBtnTxt: '{{rgtBtnTxt}}'
      twoBtnClk: '{{twoBtnClk}}'
    
  computed:
    numEpisodes: -> 
      @curShow.episodes.length
    numWatched: ->
      count = 0
      for episode in @curShow.episodes
        if episode.watched then count++
      count
      
    lftBtnTxt: -> 
      switch @pageMode
        when 'select' then 'Play' 
        when 'tags'   then 'Prev'
    rgtBtnTxt: ->
      switch  @pageMode
        when 'select' then 'Tags' 
        when 'tags'   then 'Next'
        
        