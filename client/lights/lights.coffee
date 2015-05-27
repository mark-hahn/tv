
Vue = require 'vue'
log = require('debug') 'tv:lts'

{render, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .sw-row {
    position:relative;
    width:100%;
    height:20%;
  }
  .switch-comp {
    padding-top: 3%;
    width:23%;
    height:100%;
    display: inline-block;
  }
  .switch {
    display: inline-block;
  }
  .switch img {
    width:100%;
  }
  .master {
    position:relative;
    left:30%;
    top:5rem;
  }
"""

Vue.component 'light-sw-comp', 
  template: render ->
    div '.switch', vClass:'master:!switchIdx', ->
      img src:'server/images/switch.png'
  
Vue.component 'lights-comp', 
  template: render ->
    div '.sw-row', 
      vRepeat:'switchRow:switches'
    , ->
      div '.switch-comp', 
        vComponent:'light-sw-comp'
        vRepeat:'switchIdx:switchRow'
        
  data: ->
    switches: [
      [1,2,3,0]
      [4,5,6]
    ]
