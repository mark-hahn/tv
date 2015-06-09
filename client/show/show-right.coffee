
Vue     = require 'vue'
log     = require('debug') 'tv:slf'

{render, div} = require 'teacup'

require './show-list'
require '../two-btns'

Vue.component 'show-right', 
  paramAttributes: ['cur-showkey']
  
  template: render ->
    div '.show-list-comp', vComponent: 'show-list'
    div '.two-btns-comp',  vComponent: 'two-btns' 
    
  data: ->
    twoBtnClk: (e) -> 
      switch e.target.innerText
        when 'Filter' then ->
        when 'Select' then ->
        when 'Done'   then ->
        when 'Reset'  then ->

  computed:
    lftBtnTxt: -> 
      switch @showMode
        when 'select' then 'Filter' 
        when 'filter' then 'Done'
    rgtBtnTxt: ->
      switch @showMode
        when 'select' then 'Select' 
        when 'filter' then 'Reset'
        
        