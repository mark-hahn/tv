
Vue     = require 'vue'
request = require 'superagent'
log     = require('debug') 'tv:taglst'

{render, tag, div, img} = require 'teacup'

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
    font-size: 2.1rem;
  }
  .tag.checked {
    background-color: yellow;
  }
"""

Vue.component 'tag-list',
  props: ['page-mode', 'cur-show']
  template: render ->
    div '.tag-list', ->
      div '.tag-hdr', 'Select Show Tags'
      div '.tag', 
        vRepeat: 'tags'
        vOn:     'click: onClick'
        vText:   '$value'
        vShow:   'pageMode == "filter" || $value != "New" && $value != "AllWatched"' 
        vClass:  'checked: curShow.tags[$value]'
  
  data: ->
    tags: [
      'Foreign'   
      'Comedy'    
      'Drama'     
      'Crime'     
      'Mark'      
      'Linda'     
      'Favorite'  
      'OnTheFence'
      'Old'       
      'New'       
      'AllWatched'      
      'Deleted' 
    ]      
  methods:      
    onClick: (e) ->
      tag = e.target.textContent
      @curShow.tags[tag] = not @curShow.tags[tag]
      tvGlobal.ajaxCmd 'setDBField', @curShow.id, 'tags.'+tag, @curShow.tags[tag]
      log 'onclick', tag, @curShow.tags[tag]
      
  attached: -> 
    setTimeout (=> log @curShow.tags), 1000
      
