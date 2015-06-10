
Vue     = require 'vue'
log     = require('debug') 'tv:slf'

{render, div} = require 'teacup'

require './show-list'
require '../two-btns'

Vue.component 'show-right', 
  paramAttributes: ['page-mode', 'all-shows', 'cur-show-idx', 'two-btn-clk']
  
  template: render ->
    div '.show-list-comp', 
      vComponent: 'show-list'
      allShows:   '{{allShows}}'
      curShowIdx: '{{curShowIdx}}'
      
    div '.two-btns-comp',  
      vComponent: 'two-btns'
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
        
        