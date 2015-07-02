
Vue = require 'vue'
log = require('debug') 'tv:wchcmp'

{render, tag, div, img, video} = require 'teacup'

require './watch-info'
require './tv-ctrls'
require './scrub'

(document.head.appendChild document.createElement('style')).textContent = """
  .no-episode {
    margin-top: 10rem;
    font-size:1.6rem;
    text-align: center;
  }
  .no-episode .msgTitle {
    font-weight:bold;
    font-size:2rem;
    margin-bottom: 2rem;
  }
  .have-episode {
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
    show:      null
    episode:   null
    playPos:   0
    watchMode: 'none'

  template: render ->
    div ->
      div '.no-episode', vIf:'episode == null', ->
        div '.msgTitle', 'No show is playing.'
        div 'Make sure Roku is running Plex and'
        div 'press show or episode Play button.'

      div '.have-episode', vIf:'episode != null', ->
        div '.watch-info-ctrl', ->
          tag 'watch-info-comp',
            show:       '{{show}}'
            episode:    '{{episode}}'
            videoFile:  '{{videoFile}}'
            playPos:    '{{playPos}}'
            watchMode:  '{{watchMode}}'
              
          tag 'watch-ctrl-comp',
            episode:   '{{episode}}'
            watchMode: '{{watchMode}}'
            
        tag 'scrub-comp',
          episode: '{{episode}}'
  
  watch:
    playPos: ->
      if @watchMode in ['paused', 'playing']
        @$broadcast 'setScrubPos', @playPos
            
  events:
    scrubPosMoused: (playPos) ->
      if @episode 
        if @watchMode is 'tracking' then @watchMode = 'paused'
        @playPos = playPos
  
  attached: ->
    if not @chkSessionIntrvl
      @chkSessionIntrvl = setInterval =>
        tvGlobal.ajaxCmd 'getPlayStatus', (err, status) =>
          if status.data
            {id, @videoFile, @playPos, playState} = status.data
            if @watchMode is 'none' then @watchMode = 'tracking'
            if id isnt @id
              @episode = null
              @id = id
              for show in @allShows
                for episode in show.episodes
                  if episode.id is id
                    @show    = show
                    @episode = episode
                    break
                if @episode then break
            if @episode and @watchMode is 'tracking'
              @$broadcast 'setPlayPos', @playPos
          else
            @watchMode = 'none'
            @episode = null
      , 2000
