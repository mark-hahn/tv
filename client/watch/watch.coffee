
Vue = require 'vue'
log = require('debug') 'tv:wchcmp'

{render, tag, div, img, video} = require 'teacup'

require './watch-info'
require './watch-controls'
require './scrub'

  # .watch-comp {
  #   position:relative;
  #   width:100%;
  #   height: 35.5rem;
  # }

(document.head.appendChild document.createElement('style')).textContent = """
 watch-info-comp {
    width: 85%;
    height: 35.5rem;
    display: inline-block;
    overflow: hidden;
 }
 scrub-comp {
    display: inline-block;
    position:relative;
    width: 15%;
    height: 35.5rem;
 }
"""

Vue.component 'watch-comp', 
  props: ['all-shows', 'cur-show', 'cur-episode', 'all-episodes']
  
  data: ->
    file:       ''
    state:      ''
    playPos:    0
    episodeLen: 42

  template: render ->
    tag 'watch-info-comp',
      show:    '{{show}}'
      episode: '{{episode}}'
      playPos: '{{playPos}}'
        
    tag 'scrub-comp',
      episodeLen: '{{episodeLen}}'
      playPos:    '{{playPos}}'
      
  attached: ->
    @chkSessionIntrvl = setInterval =>
      tvGlobal.ajaxCmd 'getPlayStatus', (err, status) =>
        {id, @file, @state, viewOffset} = status.data
        if id isnt @id
          @id = id
          @episode = null
          for show in @allShows
            for episode in show.episodes
              if episode.id is id
                @show    = show
                @episode = episode
                @episodeLen = episode.duration / 60e3
                break
            if @episode then break
        if not @episode
          log 'unable to find episode playing', status.data
          clearInterval @chkSessionIntrvl
          return
        @playPos = viewOffset / 60e3
        log 'getPlayStatus', {@file, @state, @playPos, \
                              @episodeLen, title: @episode.title}
    , 2000
    
  detached: ->
    if @chkSessionIntrvl 
      log 'stopping getPlayStatus'
      clearInterval @chkSessionIntrvl
      @chkSessionIntrvl = null
