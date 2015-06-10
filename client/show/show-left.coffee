
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
  props: ['page-mode', 'cur-show-idx', 'all-shows', 'two-btn-clk']
  
  template: render ->
    tag 'show-info', '.show-info', curShow: '{{curShow}}'
      
    tag 'two-btns', '.two-btns',  
      lftBtnTxt: '{{lftBtnTxt}}'
      rgtBtnTxt: '{{rgtBtnTxt}}'
      twoBtnClk: '{{twoBtnClk}}'
    
  data: ->
    twoBtnClk: (e) -> 
      switch e.target.innerText
        when 'Play' then ->
        when 'Tags' then ->
        when 'Prev' then ->
        when 'Next' then ->

  computed:
    curShow: -> @allShows[@curShowIdx] ? {}
      
    lftBtnTxt: -> 
      switch @pageMode
        when 'select' then 'Play' 
        when 'tags'   then 'Prev'
    rgtBtnTxt: ->
      switch  @pageMode
        when 'select' then 'Tags' 
        when 'tags'   then 'Next'
        
        