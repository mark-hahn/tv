
Vue     = require 'vue'
log     = require('debug') 'shw'

ajaxPfx = 'http://192.168.1.103:1344/'
plexPfx = 'http://192.168.1.103:32400'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-left-comp {
    width: 50%;
  }
"""

Vue.component 'show-page', 
  template: render ->
    div '.show-page', ->
      div '.show-left-comp',  vComponent: 'show-left',  vWith: 'showMode: showMode'
      # div '#show-right-comp', vComponent: 'show-right', vWith: 'showMode'
      
  data: ->
    showMode: 'select'
      
