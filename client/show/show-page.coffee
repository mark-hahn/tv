
Vue     = require 'vue'
log     = require('debug') 'tv:shw'

ajaxPfx = "http://192.168.1.103:#{tvGlobal.ajaxPort}/"
plexPfx = 'http://192.168.1.103:32400'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-left-comp {
    width: 50%;
  }
"""

Vue.component 'show-page', 
  inherit: true
  
  template: render ->
    div '.show-page', ->
      div '.show-left-comp', vComponent: 'show-left' 
          
      # div '#show-right-comp', vComponent: 'show-right', vWith: 'showMode'
      
  data: ->
    showMode: 'select'
