
Vue = require 'vue'
log = require('debug') 'tv:wchnfo'

{render, tag, div, img, video} = require 'teacup'

(document.head.appendChild document.createElement('style')).textContent = """
 .watch-info {
   width:100%;
 }
.show-banner {
   width:98%
 }
 .watch-episode-title {
  text-align: center;
  font-size: 1.4rem; 
  max-width: 98%;
  margin-top:0.5rem;
 }
 .watch-info .web-video-blk {
   background-color: #eec;
   border-left:   1px solid gray;
   border-top:    1px solid gray;
   border-bottom: 1px solid gray;
   margin-top:0.5rem;
   padding-bottom:4px;
   width:100%;
 }
 .watch-info video {
   width:98%;
   margin:1%
 }
 .watch-info .ctrl-row {
   margin-top: 2%;
   display: block;
   height: 33%;
 }
 .watch-info .ctrl-row .btn {
   font-size:2rem;
   width: 33%;
   height: 3rem;
 }
 btn.playCtl {
   font-weight: bold;
 }
"""

Vue.component 'watch-info-comp', 
  props: ['show', 'episode', 'video-file', 'play-pos', 'watch-mode', 
          'tv-started-play', 'tv-playing']
  
  template: render ->
    div '.watch-info', ->
      img '.show-banner', vAttr: 'src: bannerUrl'
      div '.watch-episode-title', 
            '{{episode.episodeNumber + ": " + episode.title}}'
      div '.web-video-blk', ->
        video '.video', 
          vAttr:'src: videoUrl'
          autoplay:yes
          preload:'auto'
          vOn:'click:onClick'
        div '.web-video-ctrls', ->
          div '.ctrl-row.web-video-ctrls', ->
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '<<'
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '{{vidPlayPauseTxt}}'
            div '.btn.playCtl', vOn: 'click: vidCtrlClk', '>>'
          div '.ctrl-row.web-video.bookmarks', ->
            div '.btn', vOn: 'click: vidCtrlClk', 'Prev'
            div '.btn', vOn: 'click: vidCtrlClk', 'Mark'
            div '.btn', vOn: 'click: vidCtrlClk', 'Next'

  computed:
    bannerUrl: -> tvGlobal.plexPfx + @show.banner
    videoUrl:  -> tvGlobal.tvSrvrPfx + '/' + @videoFile + '.mp4'
    vidPlayPauseTxt: ->
      switch @watchMode
        when 'paused' then '>'
        else '||'

  methods:
    vidCtrlClk: ->
      
    playing: -> @videoEle?.paused ? no
      
    onClick: ->
      # log 'onClick'
      # tvGlobal.ajaxCmd 'playPauseVideo'
      # if @playState is 'playing'
      #   @videoEle?.play()
      # else 
      #   @videoEle?.pause()
      #   tvGlobal.ajaxCmd 'startVideo', @videoEle.currentTime
  
  created: -> @tvPlaying = yes
          
  watch:
    tvPlaying: (newV, old) -> 
      log 'watch tvPlaying', {newV, old}
    
    watchMode: (__, old) -> 
      log 'watchMode', old, '->', @watchMode
      switch @watchMode
        when 'tracking'
          if old isnt 'tracking'
            if @episode.key and not @tvPlaying
              log 'starting tv play',  @tvPlaying, @playPos, @episode.key
              tvGlobal.ajaxCmd 'startVideo', @episode.key, @playPos
              @tvPlaying = yes
              @tvStartedPlay = Date.now()
            @videoEle?.currentTime = @playPos
            @videoEle?.play()
        when 'playing'
          @videoEle?.play()
          if old is 'tracking' 
            @videoEle?.pause()
            if @tvPlaying 
              log 'pausing tv - was playing now paused',  @playPos
              tvGlobal.ajaxCmd 'pauseTv'
              @tvPlaying = no
        when 'paused'
          @videoEle?.pause()
          if old is 'tracking' 
            log 'pausing tv - was tracking now paused',  @playPos
            if @tvPlaying
              tvGlobal.ajaxCmd 'pauseTv'
              @tvPlaying = no
            
  events:
    checkPlaying: ->
      
    setPlayPos: (@playPos) -> 
      if Math.abs(@videoEle?.currentTime - @playPos) > 2
        log 'adjusting playpos', @videoEle?.currentTime, @playPos
        @videoEle?.currentTime = @playPos

  attached: -> 
    @videoEle = @$el.querySelector 'video'
    setInterval ->
      if @watchMode is 'tracking'
        if @tvPlayMode is 'playing' then @videoEle.play()
        else @videoEle.pause()
    , 2000
    
    
