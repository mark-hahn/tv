
Vue     = require 'vue'
log     = require('debug') 'tv:shwrgt'

{render, tag, div} = require 'teacup'

require './show-list'
require './tag-list'
require '../two-btns'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-right-comp {
    display: inline-block;
    width: 49%;
  }
"""

Vue.component 'show-right', 
  props: [
    'pageMode'
    'allShows'
    'curShowIdx'
    'curShow'
    'filterTags'
    'showInList'
    'curTags'
  ]
  
  template: render ->
    div '.show-right-comp', ->
      tag 'show-list',
        pageMode:   '{{pageMode}}'
        allShows:   '{{allShows}}'
        curShowIdx: '{{curShowIdx}}'
        filterTags: '{{filterTags}}'
        showInList: '{{showInList}}'
        vShow:      'pageMode != "tags"'
        
      tag 'tag-list',
        pageMode: '{{pageMode}}'
        curShow:  '{{curShow}}'
        vShow:    'pageMode == "tags"'
        curTags:  '{{curTags}}'
        
      tag 'two-btns',
        lftBtnTxt:  '{{lftBtnTxt}}' 
        rgtBtnTxt:  '{{rgtBtnTxt}}' 
      
  computed:
    lftBtnTxt: -> 
      switch @pageMode
        when 'select' then 'Filter' 
        when 'tags'   then 'Filter' 
        when 'filter' then '---'
    rgtBtnTxt: ->
      switch @pageMode
        when 'select' then 'Alpha' 
        when 'tags'   then 'Done' 
        when 'filter' then 'Done'
        
        