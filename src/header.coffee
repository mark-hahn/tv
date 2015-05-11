
Vue = require 'vue'
log = require('debug') 'hdr'
{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .header {
    position:relative;
    height: 2.6rem;
  }
  .header .btn {
    width: 25%;
  }
"""

Vue.component 'left-select-btns',
  template: render ->
    

Vue.component 'header', 
  template: render ->
    div '.header', vOn: 'click: click', ->
      div '.btn', vClass: 'selected: curPage == "show"',    'Show'
      div '.btn', vClass: 'selected: curPage == "episode"', 'Episode'
      div '.btn', vClass: 'selected: curPage == "watch"',   'Watch'
      div '.btn', vClass: 'selected: curPage == "lights"',  'Lights'
  methods:
    click: (e) ->
      @curPage = e.target.innerText.toLowerCase()
      
    
  
  