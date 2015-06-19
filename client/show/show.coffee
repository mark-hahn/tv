
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
        filterTags: '{{filterTags}}'
        curShow:    '{{curShow}}'
        twoBtnClk:  '{{twoBtnClk}}'

      tag 'show-right', '.show-right-comp', 
        pageMode:   '{{pageMode}}'
        filterTags: '{{filterTags}}'
        allShows:   '{{allShows}}'
        curShowIdx: '{{curShowIdx}}'
        curShow:    '{{curShow}}'
        twoBtnClk:  '{{twoBtnClk}}'
  
  data: ->
    pageMode: 'select'
    filterTags: Watched: 'never', Archive: 'never', Deleted: 'never'

  created: ->     
    @$on 'clrPageMode', -> @pageMode = 'select'
    @$on 'twoBtnClk',  (btnName) -> 
      if btnName not in ['Tags', 'Filter', 'Prev', 'Next']
        @pageMode = 'select'
      switch btnName
        when 'Tags'   then @pageMode = 'tags'
        when 'Filter' then @pageMode = 'filter'
        when 'Prev'   then @$dispatch 'chgShowIdx', @curShowIdx-1
        when 'Next'   then @$dispatch 'chgShowIdx', @curShowIdx+1
              
        # when 'Play'   then ->
      #   when 'Filter' then ->
      #   when 'Select' then ->
      #   when 'Reset'  then ->
