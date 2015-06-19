
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:taglst'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .tag-list {
    width: 100%;
    height: 35.5rem;
    position: relative;
    overflow: hidden;
  }
  .tag-hdr {
    margin: 2rem 0 1rem; 0;
    text-align: center;
    font-size: 1.5rem;
    background-color:#eee;
  }
  .tag {
    border-top: 1px solid gray;
    padding: 0.1em;
    cursor: pointer;
    font-size: 1.7rem;
  }
  .tag.checked {
    background-color: yellow;
  }
  .tag.always {
    background-color: #afa;
  }
  .tag.never {
    background-color: #faa;
  }
"""

Vue.component 'tag-list',
  props: ['page-mode', 'cur-show', 'filter-tags']
  template: render ->
    div '.tag-list', ->
      div '.tag-hdr', vShow:'pageMode == "tags"',   'Tags For Show'
      div '.tag-hdr', vShow:'pageMode == "filter"', 'Filter Show List'
      div '.tag', 
        vRepeat: 'tags'
        vOn:     'click: onClick'
        vText:   '$value'
        vShow:   'pageMode == "filter" || $value != "New" && $value != "Watched"' 
        vClass:  'checked: pageMode == "tags"   && curShow.tags[$value],'           +
                 'always:  pageMode == "filter" && filterTags[$value] == "always",' +
                 'never:   pageMode == "filter" && filterTags[$value] == "never"'
  
  data: ->
    tags: [
      'Foreign'   
      'Comedy'    
      'Drama'     
      'Crime'     
      'MarkOnly'      
      'LindaOnly'     
      'Favorite'  
      'OnTheFence'
      'New'       
      'Watched'      
      'Archive'       
      'Deleted' 
    ]      
    
  methods:      
    onClick: (e) ->
      `var tag;`
      tag = e.target.textContent
      if @pageMode is 'tags'
        @$set 'curShow.tags.'+tag, not @curShow.tags[tag]
        tvGlobal.ajaxCmd 'setDBField', @curShow.id, 'tags.'+tag, @curShow.tags[tag]
      if @pageMode is 'filter'
        @$set 'filterTags.'+tag, 
          switch @filterTags[tag]
            when 'always' then 'never'
            when 'never'  then 'ignore'
            else               'always' 
        
