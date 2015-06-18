
Vue     = require 'vue'
log     = require('debug') 'tv:shwrgt'

{render, tag, div} = require 'teacup'

require './show-list'
require './tag-list'
require '../two-btns'

Vue.component 'show-right', 
  props: ['page-mode', 'all-shows', 'cur-show-idx', 'cur-show', 'two-btn-clk']
  
  template: render ->
    tag 'show-list', '.show-list-comp', 
      allShows:   '{{allShows}}'
      curShowIdx: '{{curShowIdx}}'
      vShow:      'pageMode == "select"'
      
    tag 'tag-list', '.tag-list-comp', 
      pageMode: '{{pageMode}}'
      curShow:  '{{curShow}}'
      vShow: 'pageMode == "tags"'
      
    tag 'two-btns', '.two-btns',  
      lftBtnTxt:  '{{lftBtnTxt}}' 
      rgtBtnTxt:  '{{rgtBtnTxt}}' 
      twoBtnClk:  '{{twoBtnClk}}'
    
  computed:
    lftBtnTxt: -> 
      switch @pageMode
        when 'select' then 'Filter' 
        when 'tags'   then 'Done' 
        when 'filter' then 'Done'
    rgtBtnTxt: ->
      switch @pageMode
        when 'select' then 'Select' 
        when 'tags'   then '---' 
        when 'filter' then '---'
        
        