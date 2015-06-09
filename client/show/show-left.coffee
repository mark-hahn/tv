
Vue     = require 'vue'
log     = require('debug') 'tv:shwlft'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-info-comp {
    width: 100%;
    height: 35.5rem;
  }
"""

require './show-info'
require '../two-btns'

Vue.component 'show-left', 
  paramAttributes: ['show-mode', 'cur-showkey']
  
  template: render ->
    div '.show-info-comp', 
      vComponent: 'show-info'
      
    div '.two-btns-comp',  
      vComponent: 'two-btns'
      lftBtnTxt: '{{lftBtnTxt}}'
      rgtBtnTxt: '{{rgtBtnTxt}}'
    
  data: ->
    twoBtnClk: (e) -> 
      switch e.target.innerText
        when 'Play' then ->
        when 'Tags' then ->
        when 'Prev' then ->
        when 'Next' then ->

  computed:
    lftBtnTxt: -> 
      switch @showMode
        when 'select' then 'Play' 
        when 'tags'   then 'Prev'
    rgtBtnTxt: ->
      switch  @showMode
        when 'select' then 'Tags' 
        when 'tags'   then 'Next'
        
        