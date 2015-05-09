
Vue = require 'vue'
{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .header {
    position:relative;
    width: 100%;
    height: 3rem;
    margin-bottom: 1rem;
  }
  .header .btn {
    display: inline-block;
    width: 25%;
    height: 100%;
    border: 2px solid #ddd; 
    background-color: #ccc;
    padding-top:0.4rem;
    text-align: center;
    font-size: 1.4rem;
    cursor: pointer;
    border-radius: 0.6rem;
  }
  .header .btn.selected {
    background-color: #ee8; 
  }
"""

Vue.component 'header-comp', 
  inherit: true
  template: render ->
    div '.header', vOn: 'click: click', ->
      div '.btn', vClass: 'selected: curPage == "show"',    'Show'
      div '.btn', vClass: 'selected: curPage == "episode"', 'Episode'
      div '.btn', vClass: 'selected: curPage == "watch"',   'Watch'
      div '.btn', vClass: 'selected: curPage == "lights"',  'Lights'
  methods:
    click: (e) ->
      @curPage = e.target.innerText.toLowerCase()
      
    
  
  