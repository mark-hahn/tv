
Vue     = require 'vue'
log     = require('debug') 'tv:shwrgt'

{render, tag, div} = require 'teacup'

require './show-list'
require './tag-list'
require '../two-btns'

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
    tag 'show-list', '.show-list-comp', 
      pageMode:   '{{pageMode}}'
      allShows:   '{{allShows}}'
      curShowIdx: '{{curShowIdx}}'
      curShow:    '{{curShow}}'
      filterTags: '{{filterTags}}'
      showInList: '{{showInList}}'
      vShow:      'pageMode != "tags"'
      
    tag 'tag-list', '.tag-list-comp', 
      pageMode: '{{pageMode}}'
      curShow:  '{{curShow}}'
      vShow:    'pageMode == "tags"'
      curTags:  '{{curTags}}'
      
    tag 'two-btns', '.two-btns',  
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
        
        