
Vue = require 'vue'
log = require('debug') 'tv:wchcmp'

{render, tag, div, img, video} = require 'teacup'

require './watch-info'
require './watch-ctrl'
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
  .noEpisdeMsg .msgTitle {
    font-size:2rem;
    margin-bottom: 2rem;
  }
  .watch-column {
    display: flex;
    flex-direction: row;
  }
  .watch-info-ctrl {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    width: 85%;
    height: 35.5rem;
  }
    watch-info-comp {
      display: block;
    }
    watch-ctrl-comp {
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
    watchMode:   'playing'
    webVidMode:  'playing'

  template: render ->
    div '.watch-column', ->
      div '.noEpisdeMsg', vIf:'episode == null', ->
        div '.msgTitle', 'No show is playing.'
        div 'Make sure Roku is running Plex and'
        div 'press show or episode Play button.'

      div '.watch-info-ctrl', ->
        tag 'watch-info-comp',
          show:      '{{show}}'
          episode:   '{{episode}}'
          videoKey:  '{{videoKey}}'
          playPos:   '{{playPos}}'
          playState: '{{playState}}'
            
        tag 'watch-ctrl-comp',
          episode:   '{{episode}}'
          watchMode: '{{watchMode}}'
          
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
    , 4000
    
  events:
    watchCtrlClk: (btn) -> log btn

  detached: ->
    if @chkSessionIntrvl 
      log 'stopping getPlayStatus'
      clearInterval @chkSessionIntrvl
      @chkSessionIntrvl = null
