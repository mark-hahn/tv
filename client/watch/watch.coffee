
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
 .noEpisdeMsg {
   margin-top: 10rem;
   font-size:1.6rem;
   font-style:bold;
   text-align: center;
 }
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
  props: ['all-shows']
  
  data: ->
    show:        null
    episode:     null
    episodeLen:  0
    playPos:     0
    file:        ''
    state:       ''

  template: render ->
    div '.noEpisdeMsg', vIf:'episode == null', ->
      div 'No show episode is playing.'
      div 'Make sure Roku is running Plex'
      div 'and episode play has been started.'

    tag 'watch-info-comp', vIf:'episode!= null',
      show:    '{{show}}'
      episode: '{{episode}}'
      playPos: '{{playPos}}'
        
    tag 'scrub-comp', vIf:'episode != null',
      episodeLen: '{{episodeLen}}'
      playPos:    '{{playPos}}'
      
  attached: ->
    @chkSessionIntrvl = setInterval =>
      tvGlobal.ajaxCmd 'getPlayStatus', (err, status) =>
        @episode = null
        if status.data
          {id, @file, @state, viewOffset} = status.data
          if id isnt @id
            @id = id
            for show in @allShows
              for episode in show.episodes
                if episode.id is id
                  @show    = show
                  @episode = episode
                  @episodeLen = episode.duration / 60e3
                  break
              if @episode then break
        if not @episode
          @episodeLen = 0
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
