
Vue     = require 'vue'
log     = require('debug') 'slf'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-info-comp {
    width: 50%;
    height: 34rem;
  }
"""

Vue.component 'show-left', 
  template: render ->
    div '.show-info-comp', vComponent: 'show-info', vWith: 'showMode: showMode'
    # div vComponent: '{{curPage}}', keepAlive: ''
            
