
Vue = require 'vue'
teacup = require 'teacup'

{render, div} = teacup

(document.head.appendChild document.createElement('style')).textContent = """
  .header-outer {
    position:relative;
    width: 100%;
    height: 3rem;
    margin-bottom: 1rem;
  }
  .hdr-btn {
    display: inline-block;
    width: 25%;
    height: 100%;
    border: 2px solid #ddd; 
    background-color: #eee;
    padding-top:0.5rem;
    overflow:hidden;
    text-align: center;
    font-size: 1.5rem;
    cursor: pointer;
  }
  .hdr-btn.selected {
    background-color: #eec; 
  }
"""

Vue.component 'header-comp', 
  inherit: true
  template: render ->
    div '.header-outer', vOn: 'click: click', ->
      div '.hdr-btn', vClass: 'selected: curPage == "show"',    'Show'
      div '.hdr-btn', vClass: 'selected: curPage == "episode"', 'Episode'
      div '.hdr-btn', vClass: 'selected: curPage == "watch"',   'Watch'
      div '.hdr-btn', vClass: 'selected: curPage == "lights"',  'Lights'
  methods:
    click: (e) ->
      @curPage = e.target.innerText.toLowerCase()
      
    
  
  