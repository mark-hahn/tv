
Vue = require 'vue'
log = require('debug') 'tv:slr'


return

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
"""

Vue.component 'show-left', 
  inherit: true
  
  template: render ->
    div '.show-info-comp', vStyle: 'midRowStyle', vComponent: 'show-info'
    div '.two-btns-comp',  vComponent: 'two-btns' 
    
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
      switch @showMode
        when 'select' then 'Tags' 
        when 'tags'   then 'Next'
        
        