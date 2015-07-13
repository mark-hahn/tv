
Vue     = require 'vue'
log     = require('debug') 'tv:taglst'

{render, div} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
  .tag-list-comp {
    width: 100%;
    height: 35.5rem;
    position: relative;
    overflow: hidden;
  }
  .tag-hdr {
    margin: 2rem 0 1rem; 0;
    text-align: center;
    font-size: 1.2rem;
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
  props: ['pageMode', 'curShow', 'filterTags', 'curTags']
  
  template: render ->
    div '.tag-list-comp', ->
      div '.tag-hdr', vShow:'pageMode == "tags"',   'Tags For: {{curShow.title}}'
      div '.tag-hdr', vShow:'pageMode == "filter"', 'Filter Show List'
      div '.tag', 
        vRepeat: 'tags'
        vOn:     'click: onClick'
        vText:   '$value'
        vShow:   'pageMode == "filter" || $value != "New" && $value != "Watched" && $value != "LessThan3"' 
        vClass:  'checked:checked($value), always:always($value), never:never($value)'
  
  methods:      
    checked: (tag) -> @pageMode is 'tags'   and    @curTags?[tag] ? no
    always:  (tag) -> @pageMode is 'filter' and @filterTags?[tag] is 'always'
    never:   (tag) -> @pageMode is 'filter' and @filterTags?[tag] is 'never'
      
    onClick: (e) ->
      `var tag;`
      tag = e.target.textContent
      if @pageMode is 'tags'
        @$set 'curTags.' + tag, not @curTags[tag]
        tvGlobal.ajaxCmd 'setDBField', @curShow.id, 'tags.'+tag, @curTags[tag]
      if @pageMode is 'filter'
        @$set 'filterTags.' + tag, 
          switch @filterTags[tag]
            when 'always' then 'never'
            when 'never'  then 'ignore'
            else               'always' 
        setTimeout (=> @$dispatch 'chooseShow'), 300
        
  data: ->
    tags: tvGlobal.tagList
    
