
Vue     = require 'vue'
log     = require('debug') 'tv:shwpag'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-left-comp, .show-right-comp {
    display: inline-block;
    width: 49%;
  }
  .show-left-comp {
    margin-right:2%;
  }
"""

require './show-left'
require './show-right'

Vue.component 'show-comp', 
  props: ['all-shows', 'cur-show-idx', 'cur-show']
  
  template: render ->
    div '.show-comp', ->
      
      tag 'show-left', '.show-left-comp',  
        pageMode:   '{{pageMode}}'
        curShow:    '{{curShow}}'
        twoBtnClk:  '{{twoBtnClk}}'

      tag 'show-right', '.show-right-comp', 
        pageMode:   '{{pageMode}}'
        allShows:   '{{allShows}}'
        curShowIdx: '{{curShowIdx}}'
        twoBtnClk:  '{{twoBtnClk}}'
      
  data: ->
    pageMode: 'select'
    
    twoBtnClk: (e) -> 
      log 'Clicked bottom button: ' + e.target.innerText
      # switch e.target.innerText
      #   when 'Play'   then ->
      #   when 'Tags'   then ->
      #   when 'Prev'   then ->
      #   when 'Next'   then ->
      #   when 'Filter' then ->
      #   when 'Select' then ->
      #   when 'Done'   then ->
      #   when 'Reset'  then ->
