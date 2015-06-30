
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
 .msgTitle {
   font-size:2rem;
   margin-bottom: 2rem;
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
    episodeLen:  null
    videoKey:    ''
    playPos:     0
    playState:   'paused'

  template: render ->
    div ->
      div '.noEpisdeMsg', vIf:'episode == null', ->
        div '.msgTitle', 'No show is playing.'
        div 'Make sure Roku is running Plex and'
        div 'press show or episode Play button.'

      tag 'watch-info-comp',
        show:      '{{show}}'
        episode:   '{{episode}}'
        videoKey:  '{{videoKey}}'
        playPos:   '{{playPos}}'
        playState: '{{playState}}'
          
      tag 'scrub-comp',
        episodeLen: '{{episodeLen}}'
        playPos:    '{{playPos}}'
      
  attached: ->
    @chkSessionIntrvl = setInterval =>
      tvGlobal.ajaxCmd 'getPlayStatus', (err, status) =>
        if status.data
          {id, @videoKey, @playPos, @playState} = status.data
          # log 'getPlayStatus status.data',status.data
          if id isnt @id
            @episode = null
            @id = id
            for show in @allShows
              for episode in show.episodes
                if episode.id is id
                  @show    = show
                  @episode = episode
                  @episodeLen = episode.episodeLen
                  break
              if @episode then break
        else
          @episode = null
        if not @episode
          @episodeLen = null
          @playState = 'paused'
          return
    , 2000

  detached: ->
    if @chkSessionIntrvl 
      log 'stopping getPlayStatus'
      clearInterval @chkSessionIntrvl
      @chkSessionIntrvl = null
