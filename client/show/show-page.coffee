
Vue     = require 'vue'
log     = require('debug') 'tv:shwpag'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-left-comp, .show-right-comp {
    display: inline-block;
    margin-right:1.5%;
    width: 48.5%;
  }
"""

require './show-left'
require './show-right'

Vue.component 'show-page', 
  paramAttributes: ['cur-showkey']
  
  template: render ->
    div '.show-page', ->
      div '.show-left-comp',  vComponent: 'show-left' , showMode: '{{showMode}}'
      div '.show-right-comp', vComponent: 'show-right', showMode: '{{showMode}}'
      
  data: ->
    showMode: 'select'
