
Vue = require 'vue'
log = require('../debug') 'rec'
{render, tag, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .sw-row {
    position:relative;
    width:100%;
    height:20%;
  }
"""

Vue.component 'record-comp', 
  name: 'record-comp'
  template: render ->
    div '.record-comp', ->
      div 'hello'
        
  data: ->

  methods:
    x: ->
      
