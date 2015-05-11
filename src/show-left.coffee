
Vue     = require 'vue'
log     = require('debug') 'slf'

{render, div} = require 'teacup'

# (document.head.appendChild document.createElement('style')).textContent = """
#   .show-info-comp {
#     width: 100%;
#     height: 34rem;
#   }
# """

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
        
        