
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:snf'

{render, div, img} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-list {
    width: 100%;
    height: 35.5rem;
    position: relative;
    overflow: auto;
  }
  .show-list-inner {
    width: 100%;
  }
  .show {
    border: 1px solid gray;
    border-bottom: none;
    padding: 0.1em;
  }
  .show.selected {
      background-color: yellow;
  }
"""

Vue.component 'show-list', 
  paramAttributes: ['cur-showkey']
  
  template: render ->
    div '.show-list', ->
      div '.show-list-inner', ->
        div '.show', 
          vRepeat:'show:shows'
          vText:'show.title'
          vClass:'selected: show.ratingKey == cur-showkey'
            
  data: ->
    shows: []
    