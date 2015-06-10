
Vue     = require 'vue'
log     = require('debug') 'tv:slf'

{render, tag, div} = require 'teacup'

require './show-list'
require '../two-btns'

Vue.component 'show-right', 
  props: ['page-mode', 'all-shows', 'cur-show-idx', 'two-btn-clk']
  
  template: render ->
    tag 'show-list', '.show-list-comp', 
      allShows:   '{{allShows}}'
      curShowIdx: '{{curShowIdx}}'
      
    tag 'two-btns', '.two-btns',  
      lftBtnTxt:  '{{lftBtnTxt}}' 
      rgtBtnTxt:  '{{rgtBtnTxt}}' 
      twoBtnClk:  '{{twoBtnClk}}'
    
  computed:
    lftBtnTxt: -> 
      switch @pageMode
        when 'select' then 'Filter' 
        when 'filter' then 'Done'
    rgtBtnTxt: ->
      switch @pageMode
        when 'select' then 'Select' 
        when 'filter' then 'Reset'
        
        