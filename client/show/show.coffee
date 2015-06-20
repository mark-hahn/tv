
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

getDefaultFilters = ->
  filters = new Object
  for tag in tvGlobal.tagList
    filters[tag] = 'ignore'
  filters.Watched = 'never'
  filters.Archive = 'never'
  filters.Deleted = 'never'
  filters

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
        showInList: '{{showInList}}'
        twoBtnClk:  '{{twoBtnClk}}'
        curTags:    '{{curTags}}'
  
  data: ->
    pageMode:  'select'
    curTags:    {}
    filterTags: getDefaultFilters()

  watch: 
    curShow:  -> @curTags = @curShow?.tags ? {}

  created: ->     
    @$on 'clrPageMode', -> @pageMode = 'select'
    @$on 'twoBtnClk',  (btnName) -> 
      switch btnName
        when 'Play'   then @$dispatch 'playShow'
        when 'Prev'   then @$dispatch 'chgShowIdx', @curShowIdx-1
        when 'Next'   then @$dispatch 'chgShowIdx', @curShowIdx+1
        when 'Filter' then @pageMode = 'filter'
        when 'Reset'  then @filterTags = getDefaultFilters()
        when 'Alpha'  then @$broadcast 'alpha'
        when 'Done'   then @pageMode = 'select'
              
  methods:      
    showInList: (show) ->
      if not show then return no
      tags = show.tags
      for filterTag, filterVal of @filterTags
        if filterVal is 'never'  and     tags[filterTag] or
           filterVal is 'always' and not tags[filterTag]
          return no
      return yes
      
    chooseShow: ->
      if @allShows.length is 0 then return no
      curShowId = localStorage.getItem('vueCurShowId') ? @allShows[0]?.id
      for show, idx in @allShows
        if show.id is curShowId then break
      while show and not @showInList show
        show = @allShows[++idx]
      if not show then idx = 0
      if @allShows[idx]?.id? then @$dispatch 'chgShowIdx', idx
      @$emit 'ensureShowVisible'
      yes
  
  attached: -> 
    @$on 'chooseShow', @chooseShow
    @$on 'ensureShowVisible', -> 
      tvGlobal.ensureVisible '.show-list', '.show.selected'

    do trySetVisShow = =>
      if not @chooseShow()
        setTimeout trySetVisShow, 300
