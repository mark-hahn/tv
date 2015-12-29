
Vue     = require 'vue'
log     = require('../debug') 'shwpag'

{render, tag, div} = require 'teacup'

require './show-left'
require './show-right'

getDefaultFilters = ->
  filters = new Object
  for tag in tvGlobal.tagList
    filters[tag] = 'ignore'
  filters.Kids    = 'never'
  filters.Watched = 'never'
  filters.Archive = 'never'
  filters.Deleted = 'never'
  filters

Vue.component 'show-comp', 
  props: ['allShows', 'curShowIdx', 'curShow']
  
  template: render ->
    div '.show-comp', ->
      
      tag 'show-left',
        pageMode:   '{{pageMode}}'
        filterTags: '{{filterTags}}'
        curShow:    '{{curShow}}'

      tag 'show-right',
        pageMode:   '{{pageMode}}'
        filterTags: '{{filterTags}}'
        allShows:   '{{allShows}}'
        curShowIdx: '{{curShowIdx}}'
        curShow:    '{{curShow}}'
        showInList: '{{showInList}}'
        curTags:    '{{curTags}}'
  
  data: ->
    pageMode:  'select'
    curTags:    {}
    filterTags: getDefaultFilters()

  watch: 
    curShow: -> @curTags = @curShow?.tags ? {}

  created: ->     
    @$on 'clrPageMode', -> @pageMode = 'select'
    @$on 'twoBtnClk',  (btnName) -> 
      switch btnName
        when 'Play'   then @$emit      'playShow'
        when 'Tags'   then @pageMode = 'tags'
        when 'Filter' then @pageMode = 'filter'
        when 'Alpha'  then @$broadcast 'alpha'
        when 'Prev'   then @$dispatch  'chgShowIdx', @curShowIdx-1
        when 'Next'   then @$dispatch  'chgShowIdx', @curShowIdx+1
        when 'Done'   then @pageMode = 'select'
        when 'Reset'  then @filterTags = getDefaultFilters()
        
  events:
    playShow: ->
      @$dispatch 'videoEnable'
       
      process.nextTick =>
        haveWatchable = null
        for episode, epiIdx in @curShow.episodes
          if episode.watched
            if haveWatchable 
              @$dispatch 'popup', 'Old episode not watched.'
              return
            continue
          else if not haveWatchable
            if not episode.noFile
              haveWatchable = episode
              firstEpiIdx = epiIdx
            else
              @$dispatch 'popup', 'Old/next episode not downloaded.'
              return
        if haveWatchable 
          @$dispatch 'chgEpisodeIdx', firstEpiIdx
          @$dispatch 'startWatch', haveWatchable
          return
        @$dispatch 'popup', 'All downloaded episodes watched.'
            
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
