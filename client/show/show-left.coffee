
Vue     = require 'vue'
log     = require('../debug') 'shwlft'

{render, tag, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .show-left-comp {
    display: inline-block;
    width: 49%;
    margin-right:2%;
  }
  .show-info {
    width: 100%;
    height: 35.5rem;
  }
"""

require './show-info'
require '../two-btns'

Vue.component 'show-left', 
  props: 
    pageMode:   String
    curShow:    Object
    filterTags: Object
  
  template: render ->
    div '.show-left-comp',  ->
      tag 'show-info',
        pageMode:    '{{pageMode}}'
        curShow:     '{{curShow}}'
        numEpisodes: '{{numEpisodes}}'
        numWatched:  '{{numWatched}}'
        vShow: 'pageMode != "filter"'
        
      tag 'tag-list',
        pageMode:   '{{pageMode}}'
        curShow:    '{{curShow}}'
        filterTags: '{{filterTags}}'
        vShow:      'pageMode == "filter"'
        
      tag 'two-btns',
        lftBtnTxt: '{{lftBtnTxt}}'
        rgtBtnTxt: '{{rgtBtnTxt}}'
    
  computed:
    numEpisodes: -> 
      @curShow.episodes?.length ? 0
    numWatched: ->
      count = 0
      for episode in @curShow.episodes ? []
        if episode.watched then count++
      count
      
    lftBtnTxt: -> 
      switch @pageMode
        when 'select' then 'Play' 
        when 'tags'   then 'Prev'
        when 'filter' then 'Reset'
    rgtBtnTxt: ->
      switch  @pageMode
        when 'select' then 'Tags' 
        when 'tags'   then 'Next'
        when 'filter' then 'Tags'
        
        